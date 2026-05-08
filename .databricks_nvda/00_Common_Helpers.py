# Databricks notebook source
"""
=============================================================================
MÓDULO DE HELPERS Y LOGGING CENTRALIZADO - NVDA Medallion Pipeline
=============================================================================
Propósito:
  - Proporcionar funciones reutilizables para todas las capas (Bronze/Silver/Gold)
  - Logging unificado y auditado para todas las operaciones
  - Schema evolution y validaciones de data quality centralizadas
  - Watermark helpers para gating lógico incremental

Convención:
  - Español para comentarios de negocio; inglés para código técnico
  - Type hints obligatorios en todas las funciones
  - Docstrings con propósito, parámetros y ejemplos
=============================================================================
"""

from pyspark.sql import SparkSession, DataFrame
from pyspark.sql import functions as F
from pyspark.sql.types import DataType
from datetime import datetime
from typing import Optional, List, Any
import logging

# ===== LOGGING CENTRALIZADO =====

def setup_pipeline_logger(pipeline_name: str, run_id: str) -> logging.Logger:
    """
    Configura logger unificado con metadatos de auditoría.
    
    Args:
        pipeline_name: Nombre del pipeline (Bronze, Silver, Gold, etc.)
        run_id: ID único de ejecución (job_run_id o interactivo)
    
    Returns:
        Logger configurado con formato auditado
    
    Example:
        logger = setup_pipeline_logger("01_Bronze", "run_123")
        logger.info("Iniciando ingesta", extra={"symbol": "NVDA", "rows": 100})
    """
    logger = logging.getLogger(pipeline_name)
    logger.setLevel(logging.INFO)
    
    formatter = logging.Formatter(
        f"[{pipeline_name}|{run_id}|%(asctime)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    
    return logger


def log_step(logger: logging.Logger, step_name: str, details: dict[str, Any] = None) -> None:
    """
    Registra un paso con detalles estructurados.
    
    Args:
        logger: Logger configurado
        step_name: Nombre del paso (ej: "schema_evolution", "merge_execute")
        details: Diccionario de detalles a registrar
    """
    msg = f"[STEP] {step_name}"
    if details:
        details_str = " | ".join([f"{k}={v}" for k, v in details.items()])
        msg += f" | {details_str}"
    logger.info(msg)


# ===== SCHEMA EVOLUTION =====

def add_missing_columns(spark: SparkSession, 
                       table_name: str, 
                       columns_ddl: List[str],
                       logger: Optional[logging.Logger] = None) -> None:
    """
    Agrega columnas faltantes a tabla de forma idempotente.
    
    Propósito:
      - Implementar evolución de esquema backward-compatible
      - Tolerar tablas heredadas sin nuevas columnas
      - Soportar adiciones futuras sin breaking changes
    
    Args:
        spark: SparkSession activo
        table_name: Nombre completo de tabla (catalog.schema.table)
        columns_ddl: Lista de definiciones DDL (ej: ["col1 TIMESTAMP", "col2 BIGINT"])
        logger: Logger opcional para auditoría
    
    Example:
        add_missing_columns(spark, "workspace.gold.my_table", 
                           ["gold_refresh_ts TIMESTAMP"])
    """
    if not spark.catalog.tableExists(table_name):
        if logger:
            logger.warning(f"Table {table_name} does not exist (skipping schema evolution)")
        return
    
    existing_columns = set(spark.table(table_name).columns)
    missing_columns = [
        ddl for ddl in columns_ddl 
        if ddl.split()[0] not in existing_columns
    ]
    
    if missing_columns:
        alter_stmt = f"ALTER TABLE {table_name} ADD COLUMNS ({', '.join(missing_columns)})"
        spark.sql(alter_stmt)
        if logger:
            log_step(logger, "schema_evolution", {
                "table": table_name,
                "added_columns": len(missing_columns),
                "columns": ", ".join([c.split()[0] for c in missing_columns])
            })


# ===== WATERMARK HELPERS (Gating Lógico) =====

def get_latest_value(spark: SparkSession, 
                    table_name: str, 
                    column_name: str,
                    logger: Optional[logging.Logger] = None) -> Optional[Any]:
    """
    Obtiene el valor máximo de una columna de forma segura.
    
    Propósito:
      - Determinar watermarks para gating incremental
      - Tolerar ausencia de tabla o columna
      - Retornar None en lugar de error si no existe
    
    Args:
        spark: SparkSession activo
        table_name: Nombre completo de tabla
        column_name: Nombre de columna
        logger: Logger opcional
    
    Returns:
        Valor máximo de la columna o None si no existe
    """
    try:
        if not spark.catalog.tableExists(table_name):
            return None
        
        if column_name not in spark.table(table_name).columns:
            if logger:
                logger.debug(f"Column {column_name} not found in {table_name}")
            return None
        
        result = spark.table(table_name).select(
            F.max(F.col(column_name)).alias("latest_value")
        ).collect()
        
        value = result[0]["latest_value"] if result else None
        if logger and value:
            log_step(logger, "watermark_read", {
                "table": table_name,
                "column": column_name,
                "value": str(value)
            })
        return value
    except Exception as e:
        if logger:
            logger.error(f"Error reading watermark from {table_name}.{column_name}: {str(e)}")
        return None


# ===== TABLE MANAGEMENT =====

def get_table_location(spark: SparkSession, table_name: str) -> str:
    """Retorna la ubicación DBFS/S3 de una tabla Delta."""
    try:
        return spark.sql(f"DESCRIBE DETAIL {table_name}").collect()[0]["location"]
    except Exception:
        return "unknown"


def set_table_properties(spark: SparkSession, 
                        table_name: str,
                        properties: dict[str, str],
                        logger: Optional[logging.Logger] = None) -> None:
    """
    Establece propiedades de tabla para documentación y auditoría.
    
    Args:
        spark: SparkSession activo
        table_name: Nombre completo de tabla
        properties: Dict de clave-valor (TBLPROPERTIES)
        logger: Logger opcional
    
    Example:
        set_table_properties(spark, "workspace.gold.my_table", {

            "sla": "daily",
            "lineage": "bronze->silver->gold"
        })
    """
    if not spark.catalog.tableExists(table_name):
        return
    
    prop_list = ", ".join([f"'{k}'='{v}'" for k, v in properties.items()])
    spark.sql(f"ALTER TABLE {table_name} SET TBLPROPERTIES ({prop_list})")
    
    if logger:
        log_step(logger, "table_properties_set", {
            "table": table_name,
            "count": len(properties)
        })


# ===== DATA QUALITY VALIDATORS =====

def validate_not_null_columns(df: DataFrame, 
                             columns: List[str],
                             logger: Optional[logging.Logger] = None) -> int:
    """
    Cuenta filas con NULL en cualquiera de las columnas especificadas.
    
    Args:
        df: DataFrame a validar
        columns: Columnas que no deben tener NULL
        logger: Logger opcional
    
    Returns:
        Número de filas inválidas (con NULL)
    """
    null_condition = F.lit(False)
    for col in columns:
        if col in df.columns:
            null_condition = null_condition | F.col(col).isNull()
    
    invalid_rows = df.filter(null_condition).count()
    
    if logger and invalid_rows > 0:
        logger.warning(f"Data quality: {invalid_rows} rows with NULL in {columns}")
    
    return invalid_rows


def validate_range_columns(df: DataFrame,
                          range_checks: dict[str, tuple[float, float]],
                          logger: Optional[logging.Logger] = None) -> int:
    """
    Valida que columnas estén dentro de rangos especificados.
    
    Args:
        df: DataFrame a validar
        range_checks: Dict {column_name: (min, max)}
        logger: Logger opcional
    
    Returns:
        Número de filas fuera de rango
    """
    invalid_condition = F.lit(False)
    for col_name, (min_val, max_val) in range_checks.items():
        if col_name in df.columns:
            invalid_condition = invalid_condition | (
                (F.col(col_name) < min_val) | (F.col(col_name) > max_val)
            )
    
    invalid_rows = df.filter(invalid_condition).count()
    
    if logger and invalid_rows > 0:
        logger.warning(f"Data quality: {invalid_rows} rows outside range checks")
    
    return invalid_rows


# ===== OPTIMIZATION HELPERS =====

def optimize_table(spark: SparkSession, 
                  table_name: str,
                  zorder_columns: List[str] = None,
                  logger: Optional[logging.Logger] = None) -> None:
    """
    Ejecuta OPTIMIZE y ZORDER en tabla para query performance.
    
    Propósito:
      - Consolidar files pequeños (compactación)
      - Indexar columnas frecuentes (ZORDER)
      - Mejorar query performance 30-50%
    
    Args:
        spark: SparkSession activo
        table_name: Nombre completo de tabla
        zorder_columns: Columnas para ZORDER BY (orden importa)
        logger: Logger opcional
    
    Example:
        optimize_table(spark, "workspace.gold.features", 
                      zorder_columns=["symbol", "date"])
    """
    try:
        if not spark.catalog.tableExists(table_name):
            return
        
        if zorder_columns:
            zorder_expr = ", ".join(zorder_columns)
            spark.sql(f"OPTIMIZE {table_name} ZORDER BY ({zorder_expr})")
        else:
            spark.sql(f"OPTIMIZE {table_name}")
        
        if logger:
            log_step(logger, "table_optimize", {
                "table": table_name,
                "zorder_cols": zorder_columns or "none"
            })
    except Exception as e:
        if logger:
            logger.error(f"OPTIMIZE failed for {table_name}: {str(e)}")


print("[00_Common_Helpers] Module loaded successfully")
