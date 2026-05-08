# Databricks notebook source
"""
=============================================================================
02_SILVER_YAHOO_NVDA.PY - Validación y Limpieza de Datos
=============================================================================
Propósito:
  - Validar datos Bronze contra reglas de calidad
  - Separar registros válidos de rechazados
  - Aplicar transformaciones de normalización
  - Mantener audit trail de rejects con motivos específicos

Arquitectura:
  - Incremental: procesar solo Bronze nuevo desde último silver_refresh_ts
  - Validaciones: NULL checks, range checks, relaciones lógicas
  - Rejects: tabla particionada con deduplicación y razones de rechazo
  - Partición: por symbol para pruning
  - ZORDER: por date para análisis temporal

Flujo:
  1. Leer Bronze incremental desde watermark
  2. Normalizar tipos y esquema
  3. Validar contra reglas de calidad
  4. Separar valid -> Silver, invalid -> Rejects
  5. MERGE (upsert) en ambas tablas
  6. OPTIMIZE ZORDER para queries
"""

from pyspark.sql import functions as F
from pyspark.sql.window import Window
from pyspark.sql.types import BooleanType, StringType
from typing import Optional, Callable
import logging

# COMMAND ----------

# Cargar helpers centralizados
%run /Workspace/Repos/limbervillcacoraite@gmail.com/NVDA_Medallion/00_Common_Helpers

# COMMAND ----------

# ===== CONFIGURACIÓN =====

dbutils.widgets.text("catalog", "workspace")
dbutils.widgets.text("bronze_schema", "bronze")
dbutils.widgets.text("silver_schema", "silver")

catalog = dbutils.widgets.get("catalog")
bronze_schema = dbutils.widgets.get("bronze_schema")
silver_schema = dbutils.widgets.get("silver_schema")

bronze_table = f"{catalog}.{bronze_schema}.yahoo_finance_prices_raw"
silver_table = f"{catalog}.{silver_schema}.equity_prices_daily"
rejects_table = f"{catalog}.{silver_schema}.equity_prices_daily_rejects"

# Logger centralizado
pipeline_run_id = "interactive"
try:
    pipeline_run_id = str(dbutils.notebook.entry_point.getDbutils().notebook().getContext().jobRunId().get())
except:
    pass
logger = setup_pipeline_logger("02_Silver", pipeline_run_id)

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog}.{silver_schema}")
log_step(logger, "schema_created", {"catalog": catalog, "schema": silver_schema})


def ensure_silver_tables() -> None:
    """
    Crea tablas Silver y Rejects con esquema completo y particionamiento.
    
    Propósito:
      - Garantizar esquema consistente desde primer run
      - Incluir todas las columnas futuras (evolución)
      - Aplicar particionamiento óptimo
    """
    spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {silver_table} (
        symbol STRING,
        date DATE,
        open DOUBLE,
        high DOUBLE,
        low DOUBLE,
        close DOUBLE,
        adj_close DOUBLE,
        volume BIGINT,
        source_system STRING,
        source_interval STRING,
        ingestion_ts TIMESTAMP,
        ingestion_date DATE,
        ingestion_run_id STRING,
        silver_refresh_ts TIMESTAMP
    )
    USING DELTA
    PARTITIONED BY (symbol)
    TBLPROPERTIES (
        'layer'='silver',
        'sla'='daily',
        'delta.autoOptimize.optimizeWrite'='true',
        'delta.autoOptimize.autoCompact'='true'
    )
    """)

    spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {rejects_table} (
        symbol STRING,
        date DATE,
        open DOUBLE,
        high DOUBLE,
        low DOUBLE,
        close DOUBLE,
        adj_close DOUBLE,
        volume BIGINT,
        source_system STRING,
        source_interval STRING,
        ingestion_ts TIMESTAMP,
        ingestion_date DATE,
        ingestion_run_id STRING,
        quality_issue STRING,
        is_valid BOOLEAN,
        silver_refresh_ts TIMESTAMP
    )
    USING DELTA
    PARTITIONED BY (symbol)
    TBLPROPERTIES (
        'layer'='silver',
        'table_type'='rejects',
        'delta.autoOptimize.optimizeWrite'='true',
        'delta.autoOptimize.autoCompact'='true'
    )
    """)
    
    log_step(logger, "tables_created", {
        "silver": silver_table,
        "rejects": rejects_table
    })


# COMMAND ----------

# ===== LECTURA INCREMENTAL DE BRONZE =====

bronze_df = spark.table(bronze_table)

# Procesar solo Bronze nuevo desde último silver_refresh_ts
try:
    if spark.catalog.tableExists(silver_table):
        last_silver = spark.table(silver_table).select(
            F.max(F.col("ingestion_ts")).alias("last_ingestion_ts")
        ).collect()
        last_ingestion_ts = last_silver[0]["last_ingestion_ts"] if last_silver and last_silver[0]["last_ingestion_ts"] else None
    else:
        last_ingestion_ts = None
except Exception as e:
    logger.error(f"Failed to read last ingestion timestamp: {str(e)}")
    last_ingestion_ts = None

if last_ingestion_ts is not None:
    bronze_df = bronze_df.filter(F.col("ingestion_ts") > F.lit(last_ingestion_ts))
    if bronze_df.limit(1).count() == 0:
        logger.info(f"No new rows in Bronze since {last_ingestion_ts} — exiting")
        dbutils.notebook.exit("no_new_silver")
    log_step(logger, "incremental_filter", {"last_ingestion_ts": str(last_ingestion_ts)})

# ===== NORMALIZACIÓN DE TIPOS Y ESQUEMA =====

bronze_cols = set(bronze_df.columns)

def pick_col(candidates: list[str]) -> any:
    """Selecciona primera columna que existe (case-insensitive)."""
    for name in candidates:
        if name in bronze_cols:
            return F.col(f"`{name}`")
    return F.lit(None)

base_df = (
    bronze_df.select(
        pick_col(["source_symbol"]).cast("string").alias("symbol"),
        F.to_date(pick_col(["Date", "date"]).cast("timestamp")).alias("date"),
        pick_col(["Open", "open"]).cast("double").alias("open"),
        pick_col(["High", "high"]).cast("double").alias("high"),
        pick_col(["Low", "low"]).cast("double").alias("low"),
        pick_col(["Close", "close"]).cast("double").alias("close"),
        pick_col(["Adj Close", "adj_close", "adj close"]).cast("double").alias("adj_close"),
        pick_col(["Volume", "volume"]).cast("bigint").alias("volume"),
        pick_col(["source_system"]).cast("string").alias("source_system"),
        pick_col(["source_interval"]).cast("string").alias("source_interval"),
        pick_col(["ingestion_ts"]).cast("timestamp").alias("ingestion_ts"),
        pick_col(["ingestion_date"]).cast("date").alias("ingestion_date"),
        pick_col(["ingestion_run_id"]).cast("string").alias("ingestion_run_id")
    )
)

log_step(logger, "schema_normalized", {"columns": len(base_df.columns)})

# ===== CREAR TABLAS Y EVOLUCIONAR ESQUEMA =====

ensure_silver_tables()
add_missing_columns(spark, silver_table, ["silver_refresh_ts TIMESTAMP"], logger=logger)
add_missing_columns(spark, rejects_table, ["is_valid BOOLEAN", "silver_refresh_ts TIMESTAMP"], logger=logger)

# ===== VALIDACIÓN DE CALIDAD =====

validated_df = (
    base_df.withColumn(
        "quality_issue",
        F.when(F.col("symbol").isNull(), F.lit("symbol_null"))
         .when(F.col("date").isNull(), F.lit("date_null"))
         .when(F.col("open").isNull(), F.lit("open_null"))
         .when(F.col("high").isNull(), F.lit("high_null"))
         .when(F.col("low").isNull(), F.lit("low_null"))
         .when(F.col("close").isNull(), F.lit("close_null"))
         .when(F.col("volume").isNull(), F.lit("volume_null"))
         .when(F.col("high") < F.col("low"), F.lit("high_lt_low"))
         .when(F.col("volume") < 0, F.lit("volume_negative"))
         .otherwise(F.lit(None))
    )
    .withColumn("is_valid", F.col("quality_issue").isNull())
)

valid_df = validated_df.filter(F.col("is_valid") == True).drop("quality_issue", "is_valid")
rejects_df = validated_df.filter(F.col("is_valid") == False)

# Log quality metrics
valid_count = valid_df.count()
reject_count = rejects_df.count()

log_step(logger, "data_quality", {
    "total": base_df.count(),
    "valid": valid_count,
    "rejected": reject_count,
    "reject_rate": f"{100*reject_count/(valid_count+reject_count):.2f}%" if (valid_count+reject_count) > 0 else "0%"
})

# ===== DEDUPLICACIÓN Y MERGE PREP =====

w = Window.partitionBy("symbol", "date").orderBy(F.col("ingestion_ts").desc_nulls_last())
latest_valid_df = (
    valid_df
    .withColumn("silver_refresh_ts", F.current_timestamp())
    .withColumn("rn", F.row_number().over(w))
    .filter(F.col("rn") == 1)
    .drop("rn")
)

rejects_df = rejects_df.withColumn("silver_refresh_ts", F.current_timestamp())
rejects_dedup_df = rejects_df.dropDuplicates(["symbol", "date", "quality_issue", "ingestion_run_id"])

# COMMAND ----------

# ===== MERGE A TABLAS SILVER =====

from delta.tables import DeltaTable

try:
    latest_valid_df.createOrReplaceTempView("silver_upsert_source")
    
    spark.sql(f"""
    MERGE INTO {silver_table} t
    USING silver_upsert_source s
    ON t.symbol = s.symbol AND t.date = s.date
    WHEN MATCHED AND s.ingestion_ts >= t.ingestion_ts THEN UPDATE SET *
    WHEN NOT MATCHED THEN INSERT *
    """)
    
    log_step(logger, "merge_complete", {
        "table": silver_table,
        "rows_processed": valid_count,
        "mode": "upsert"
    })
except Exception as e:
    logger.error(f"MERGE into {silver_table} failed: {str(e)}")
    raise

# ===== MERGE A TABLA DE REJECTS =====

try:
    rejects_dedup_df.createOrReplaceTempView("silver_rejects_source")
    
    spark.sql(f"""
    MERGE INTO {rejects_table} t
    USING silver_rejects_source s
    ON t.symbol = s.symbol AND t.date = s.date AND t.quality_issue = s.quality_issue
    WHEN MATCHED AND s.ingestion_ts >= t.ingestion_ts THEN UPDATE SET *
    WHEN NOT MATCHED THEN INSERT *
    """)
    
    log_step(logger, "rejects_merge_complete", {
        "table": rejects_table,
        "rows_processed": reject_count
    })
except Exception as e:
    logger.error(f"MERGE into {rejects_table} failed: {str(e)}")
    raise

# ===== OPTIMIZACIÓN =====

optimize_table(spark, silver_table, zorder_columns=["symbol", "date"], logger=logger)
optimize_table(spark, rejects_table, zorder_columns=["symbol", "ingestion_date"], logger=logger)

log_step(logger, "silver_complete", {
    "valid_rows": valid_count,
    "rejected_rows": reject_count,
    "silver_table": silver_table,
    "rejects_table": rejects_table
})

print(f"✓ Silver tables updated")
print(f"  Valid: {valid_count:,} → {silver_table}")
print(f"  Rejected: {reject_count:,} → {rejects_table}")
print(f"  Total processed: {base_df.count():,}")

display(spark.table(silver_table).orderBy(F.col("date").desc()).limit(20))