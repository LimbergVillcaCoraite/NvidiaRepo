# Databricks notebook source
"""
=== 03_GOLD_YAHOO_NVDA.PY - Ingeniería de Features ===
Propósito: Transformar Silver en features ML-ready; incremental con lineage.
"""

from pyspark.sql import functions as F
from pyspark.sql.window import Window
from datetime import timedelta

# COMMAND ----------

# Cargar helpers centralizados
%run /Workspace/Repos/limbervillcacoraite@gmail.com/NVDA_Medallion/00_Common_Helpers

# COMMAND ----------

dbutils.widgets.text("catalog", "workspace")
dbutils.widgets.text("silver_schema", "silver")
dbutils.widgets.text("gold_schema", "gold")

catalog = dbutils.widgets.get("catalog")
silver_schema = dbutils.widgets.get("silver_schema")
gold_schema = dbutils.widgets.get("gold_schema")

silver_table = f"{catalog}.{silver_schema}.equity_prices_daily"
gold_daily_table = f"{catalog}.{gold_schema}.equity_prices_daily_features"
gold_monthly_table = f"{catalog}.{gold_schema}.equity_prices_monthly"

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog}.{gold_schema}")

pipeline_run_id = "interactive"
try:
    pipeline_run_id = str(dbutils.notebook.entry_point.getDbutils().notebook().getContext().jobRunId().get())
except Exception:
    pass
logger = setup_pipeline_logger("03_Gold", pipeline_run_id)

# COMMAND ----------

silver_df = spark.table(silver_table)
if silver_df.isEmpty():
    raise ValueError(f"Silver vacia: {silver_table}")

add_missing_columns(spark, gold_daily_table, ["gold_refresh_ts TIMESTAMP"])
add_missing_columns(spark, gold_monthly_table, ["gold_refresh_ts TIMESTAMP"])

last_gold_date = get_latest_value(spark, gold_daily_table, "date", logger=logger)

if last_gold_date is not None:
    lookback_days = 60
    start_date = (last_gold_date - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    compute_df = silver_df.filter(F.col("date") >= F.lit(start_date))
    log_step(logger, "incremental_filter", {"last_gold_date": str(last_gold_date), "start_date": start_date})
else:
    compute_df = silver_df
    log_step(logger, "full_load", {"reason": "no_existing_gold_data"})

w_symbol_date = Window.partitionBy("symbol").orderBy("date")
w_20 = w_symbol_date.rowsBetween(-19, 0)
w_50 = w_symbol_date.rowsBetween(-49, 0)

gold_daily_df = (
    compute_df
    .withColumn("daily_return_pct", (F.col("close") / F.lag("close", 1).over(w_symbol_date) - 1.0) * 100.0)
    .withColumn("sma_20", F.avg("close").over(w_20))
    .withColumn("sma_50", F.avg("close").over(w_50))
    .withColumn("avg_volume_20", F.avg("volume").over(w_20))
    .withColumn("volatility_20d_pct", F.stddev("daily_return_pct").over(w_20))
    .withColumn("year", F.year("date"))
    .withColumn("month", F.month("date"))
    .withColumn("gold_refresh_ts", F.current_timestamp())
)

from delta.tables import DeltaTable

if spark.catalog.tableExists(gold_daily_table):
    target = DeltaTable.forName(spark, gold_daily_table)
    (
        target.alias("t")
        .merge(
            gold_daily_df.alias("s"),
            "t.symbol = s.symbol AND t.date = s.date",
        )
        .whenMatchedUpdateAll()
        .whenNotMatchedInsertAll()
        .execute()
    )
else:
    gold_daily_df.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(gold_daily_table)

w_month_asc = Window.partitionBy("symbol", F.date_trunc("month", F.col("date"))).orderBy("date")
w_month_full = Window.partitionBy("symbol", F.date_trunc("month", F.col("date"))).orderBy("date").rowsBetween(Window.unboundedPreceding, Window.unboundedFollowing)

monthly_df = (
    compute_df
    .withColumn("month_start", F.date_trunc("month", F.col("date")))
    .withColumn("_month_open", F.first("open", ignorenulls=True).over(w_month_asc))
    .withColumn("_month_close", F.last("close", ignorenulls=True).over(w_month_full))
    .groupBy("symbol", "month_start")
    .agg(
        F.max("_month_open").alias("month_open"),
        F.max("high").alias("month_high"),
        F.min("low").alias("month_low"),
        F.max("_month_close").alias("month_close"),
        F.sum("volume").alias("month_volume")
    )
    .withColumn("month_return_pct", (F.col("month_close") / F.col("month_open") - 1.0) * 100.0)
    .withColumn("gold_refresh_ts", F.current_timestamp())
)

if spark.catalog.tableExists(gold_monthly_table):
    monthly_target = DeltaTable.forName(spark, gold_monthly_table)
    (
        monthly_target.alias("t")
        .merge(
            monthly_df.alias("s"),
            "t.symbol = s.symbol AND t.month_start = s.month_start",
        )
        .whenMatchedUpdateAll()
        .whenNotMatchedInsertAll()
        .execute()
    )
else:
    monthly_df.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(gold_monthly_table)

optimize_table(spark, gold_daily_table, zorder_columns=["symbol", "date"], logger=logger)
optimize_table(spark, gold_monthly_table, zorder_columns=["symbol", "month_start"], logger=logger)

set_table_properties(spark, gold_daily_table, {
    "layer": "gold",
    "sla": "daily",
    "lineage": "silver->gold",
    "delta.autoOptimize.optimizeWrite": "true",
    "delta.autoOptimize.autoCompact": "true"
}, logger=logger)

set_table_properties(spark, gold_monthly_table, {
    "layer": "gold",
    "sla": "daily",
    "lineage": "silver->gold",
    "delta.autoOptimize.optimizeWrite": "true",
    "delta.autoOptimize.autoCompact": "true"
}, logger=logger)

log_step(logger, "gold_complete", {"daily_table": gold_daily_table, "monthly_table": gold_monthly_table})

print(f"✓ Gold tables optimized: daily + monthly")
print(f"  {gold_daily_table}")
print(f"  {gold_monthly_table}")
display(spark.table(gold_daily_table).orderBy(F.col("date").desc()).limit(20))