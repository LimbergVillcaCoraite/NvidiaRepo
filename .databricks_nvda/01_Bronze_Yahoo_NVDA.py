# Databricks notebook source
# MAGIC %pip install yfinance

# COMMAND ----------

"""
=============================================================================
01_BRONZE_YAHOO_NVDA.PY - Ingesta de Datos Raw
=============================================================================
Propósito:
  - Obtener datos históricos de precios desde Yahoo Finance
  - Implementar ingesta incremental con lookback para correcciones tardías
  - Preservar integridad de datos raw (sin transformaciones)
  - Registrar metadatos técnicos de ingesta (timestamps, run_id)

Arquitectura:
  - Fetch incremental: detecta última fecha ingestada, retrocede 7 días
  - Deduplicación: conserva última versión de cada fecha
  - Partición: por ingestion_date para pruning eficiente
  - ZORDER: por source_symbol para queries posteriores

Flujo:
  1. Detectar watermark (última fecha ingestada)
  2. Descargar desde Yahoo Finance (con overlap)
  3. Normalizar schema (MultiIndex -> flat)
  4. Agregar metadatos (ingestion_run_id, ingestion_ts, etc.)
  5. Append a Bronze table (incremental)
  6. OPTIMIZE ZORDER para queries downstream
"""

from pyspark.sql import functions as F
from pyspark.sql.types import DoubleType, LongType, DateType, TimestampType, StringType
from delta.tables import DeltaTable
import yfinance as yf
import uuid
from datetime import timedelta
from typing import Optional
import logging

# COMMAND ----------

# Cargar helpers centralizados
%run /Workspace/Repos/limbervillcacoraite@gmail.com/NVDA_Medallion/00_Common_Helpers

# COMMAND ----------

# ===== CONFIGURACIÓN =====

# Parametros (widgets)
dbutils.widgets.text("catalog", "workspace")
dbutils.widgets.text("bronze_schema", "bronze")
dbutils.widgets.text("symbol", "NVDA")
dbutils.widgets.text("source_interval", "1d")

catalog = dbutils.widgets.get("catalog")
bronze_schema = dbutils.widgets.get("bronze_schema")
symbol = dbutils.widgets.get("symbol")
source_interval = dbutils.widgets.get("source_interval")

source_system = "yahoo_finance"
bronze_table = f"{catalog}.{bronze_schema}.yahoo_finance_prices_raw"

# Logger centralizado
pipeline_run_id = dbutils.notebook.entry_point.getDbutils().notebook().getContext().jobRunId().get() if hasattr(dbutils.notebook.entry_point.getDbutils().notebook().getContext(), 'jobRunId') else "interactive"
logger = setup_pipeline_logger("01_Bronze", str(pipeline_run_id))

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog}.{bronze_schema}")
log_step(logger, "schema_created", {"catalog": catalog, "schema": bronze_schema})


def get_latest_date(table_name: str, column_name: str) -> Optional[any]:
    """
    Obtiene la fecha máxima ingestada (watermark).
    
    Propósito:
      - Determinar punto de inicio para fetch incremental
      - Tolerar tabla no existente (primer run)
    
    Args:
        table_name: Nombre completo de tabla (catalog.schema.table)
        column_name: Columna de fecha (generalmente "date")
    
    Returns:
        Fecha máxima o None si tabla no existe
    """
    if not spark.catalog.tableExists(table_name):
        logger.info(f"Table {table_name} does not exist yet (first run)")
        return None
    
    result = spark.table(table_name).select(F.max(F.col(column_name)).alias("latest_value")).collect()
    latest = result[0]["latest_value"] if result and result[0]["latest_value"] is not None else None
    
    if latest:
        log_step(logger, "watermark_detected", {"table": table_name, "latest_date": str(latest)})
    return latest


def download_prices(symbol_name: str, interval: str, start_date: Optional[str] = None) -> any:
    """
    Descarga datos de precios desde Yahoo Finance.
    
    Propósito:
      - Encapsular lógica de llamada a API externa
      - Implementar retry logic y error handling
    
    Args:
        symbol_name: Ticker symbol (ej: "NVDA")
        interval: Intervalo (ej: "1d", "1h")
        start_date: Fecha inicial opcional (YYYY-MM-DD)
    
    Returns:
        DataFrame de pandas con precios históricos
    
    Raises:
        Exception: Si yfinance falla
    """
    options = {
        "interval": interval,
        "auto_adjust": False,  # Evitar ajustes post-split
        "progress": False,
    }
    if start_date is not None:
        options["start"] = start_date
    else:
        options["period"] = "max"
    
    log_step(logger, "yfinance_download", {"symbol": symbol_name, "options": str(options)})
    return yf.download(symbol_name, **options)


# COMMAND ----------

# ===== FETCH INCREMENTAL =====

last_date = get_latest_date(bronze_table, "date")

if last_date is not None:
    # Lookback de 7 días para capturar correcciones tardías de Yahoo
    fetch_start = (last_date - timedelta(days=7)).strftime("%Y-%m-%d")
    log_step(logger, "incremental_fetch", {
        "last_ingestd_date": str(last_date),
        "fetch_start": fetch_start,
        "lookback_days": 7
    })
    pdf = download_prices(symbol, source_interval, start_date=fetch_start)
else:
    log_step(logger, "initial_fetch", {"symbol": symbol})
    pdf = download_prices(symbol, source_interval)

if pdf.empty:
    logger.info(f"No new data received for {symbol} from Yahoo Finance (last_date={last_date})")
    dbutils.notebook.exit("no_new_data")

# ===== NORMALIZACIÓN DE SCHEMA =====

# Aplanar columnas MultiIndex de yfinance
pdf = pdf.reset_index()
pdf.columns = [c[0] if isinstance(c, tuple) else c for c in pdf.columns]
pdf.columns = [str(c).strip().lower().replace(" ", "_") for c in pdf.columns]

# Deduplicación: conservar última versión de cada fecha
initial_rows = len(pdf)
pdf = pdf.drop_duplicates(subset=["date"], keep="last")
dedup_rows = initial_rows - len(pdf)

if dedup_rows > 0:
    logger.warning(f"Deduplication: removed {dedup_rows} duplicate rows")

# ===== METADATOS DE INGESTA =====

# Run ID único para rastrear este batch de ingesta
run_id = str(uuid.uuid4())
pdf["source_symbol"] = symbol
pdf["source_system"] = source_system
pdf["source_interval"] = source_interval
pdf["ingestion_run_id"] = run_id

log_step(logger, "metadata_added", {
    "ingestion_run_id": run_id,
    "rows": len(pdf),
    "symbol": symbol
})

# Convertir a Spark DataFrame y agregar timestamps
sdf = spark.createDataFrame(pdf)
sdf = sdf.withColumn("ingestion_ts", F.current_timestamp()).withColumn(
    "ingestion_date", F.to_date(F.col("ingestion_ts"))
)

# COMMAND ----------

# ===== MERGE A BRONZE (INCREMENTAL, SIN DUPLICADOS) =====

try:
    rows_written = sdf.count()

    if spark.catalog.tableExists(bronze_table):
        bronze_target = DeltaTable.forName(spark, bronze_table)
        (
            bronze_target.alias("t")
            .merge(
                sdf.alias("s"),
                "t.source_symbol = s.source_symbol AND t.date = s.date"
            )
            .whenMatchedUpdateAll()
            .whenNotMatchedInsertAll()
            .execute()
        )
        write_mode = "merge"
    else:
        sdf.write.format("delta").mode("overwrite").option("overwriteSchema", "true").partitionBy("ingestion_date").saveAsTable(bronze_table)
        write_mode = "overwrite_initial"

    log_step(logger, "table_write", {
        "table": bronze_table,
        "mode": write_mode,
        "rows": rows_written,
    })

except Exception as e:
    logger.error(f"Failed to write Bronze table: {str(e)}")
    raise

# ===== OPTIMIZACIÓN =====

optimize_table(
    spark, 
    bronze_table, 
    zorder_columns=["source_symbol", "ingestion_date"],
    logger=logger
)

# ===== TABLE PROPERTIES (Documentación en Catalog) =====

set_table_properties(spark, bronze_table, {
    "layer": "bronze",
    "source": "yahoo_finance",
    "sla": "daily",
    "lineage": "external->bronze",
    "ingestion_run_id": run_id,
    "delta.autoOptimize.optimizeWrite": "true",
    "delta.autoOptimize.autoCompact": "true"
}, logger=logger)

log_step(logger, "bronze_complete", {
    "table": bronze_table,
    "rows": rows_written,
    "symbol": symbol,
    "run_id": run_id
})

print(f"✓ Bronze table updated: {bronze_table}")
print(f"  Rows: {rows_written:,}")
print(f"  Symbol: {symbol}")
print(f"  Ingestion Run ID: {run_id}")

display(spark.table(bronze_table).orderBy(F.col("ingestion_ts").desc()).limit(20))