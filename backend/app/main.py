import os
import re
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.databricks_client import (
    DatabricksCLIError,
    execute_sql_statement,
    find_jobs_by_name,
    get_job,
    list_jobs,
    list_runs,
)


load_dotenv()

app = FastAPI(title="NvidiaRepo Databricks API", version="1.0.0")

frontend_origins = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins + ["http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)

allowed_hosts = [host.strip() for host in os.getenv("ALLOWED_HOSTS", "*").split(",") if host.strip()]
app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)


@app.middleware("http")
async def set_security_headers(request: Request, call_next) -> Response:
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    # API-only CSP to reduce abuse surface.
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    return response


def _default_profile() -> str:
    return os.getenv("DATABRICKS_PROFILE", "")


def _default_warehouse_id() -> str:
    # Preconfigured warehouse used in this workspace.
    return os.getenv("DATABRICKS_WAREHOUSE_ID", "c1790544d31644c6")


def _ms_to_iso(value: Any) -> str | None:
    if value in (None, 0):
        return None
    try:
        return datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def _normalize_symbol(raw_symbol: str) -> str:
    symbol = raw_symbol.strip().upper()
    if not re.fullmatch(r"[A-Z0-9._-]{1,10}", symbol):
        raise HTTPException(status_code=422, detail="Invalid symbol format")
    return symbol


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/databricks/jobs")
def api_list_jobs(profile: str = Query(default_factory=_default_profile)) -> dict[str, Any]:
    try:
        jobs = list_jobs(profile)
        return {"count": len(jobs), "jobs": jobs, "profile": profile}
    except DatabricksCLIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/databricks/jobs/search")
def api_search_jobs(
    name: str,
    profile: str = Query(default_factory=_default_profile),
) -> dict[str, Any]:
    try:
        jobs = find_jobs_by_name(name, profile)
        return {"count": len(jobs), "jobs": jobs, "profile": profile, "query": name}
    except DatabricksCLIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/databricks/jobs/{job_id}")
def api_get_job(job_id: int, profile: str = Query(default_factory=_default_profile)) -> dict[str, Any]:
    try:
        job = get_job(job_id, profile)
        return {"job": job, "profile": profile}
    except DatabricksCLIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/databricks/jobs/{job_id}/runs")
def api_list_runs(
    job_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    profile: str = Query(default_factory=_default_profile),
) -> dict[str, Any]:
    try:
        runs = list_runs(job_id, profile)
        normalized = [
            {
                **run,
                "start_time_iso": _ms_to_iso(run.get("start_time")),
                "end_time_iso": _ms_to_iso(run.get("end_time")),
            }
            for run in runs[:limit]
        ]
        return {"count": len(normalized), "runs": normalized, "profile": profile, "job_id": job_id}
    except DatabricksCLIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/databricks/forecast/latest")
def api_forecast_latest(
    symbol: str = Query(default="NVDA"),
    profile: str = Query(default_factory=_default_profile),
    warehouse_id: str = Query(default_factory=_default_warehouse_id),
) -> dict[str, Any]:
    normalized_symbol = _normalize_symbol(symbol)
    sql = (
        "SELECT symbol, next_trading_day, predicted_close, predicted_low_80, predicted_high_80, "
        "model_name, cv_mae, exposed_ts "
        "FROM workspace.serving.nvda_forecast_latest "
        f"WHERE symbol = '{normalized_symbol}' "
        "LIMIT 1"
    )
    try:
        rows = execute_sql_statement(sql, profile=profile, warehouse_id=warehouse_id)
        return {
            "symbol": normalized_symbol,
            "profile": profile,
            "warehouse_id": warehouse_id,
            "row": rows[0] if rows else None,
        }
    except DatabricksCLIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/databricks/bronze/status")
def api_bronze_status(
    symbol: str = Query(default="NVDA"),
    profile: str = Query(default_factory=_default_profile),
    warehouse_id: str = Query(default_factory=_default_warehouse_id),
) -> dict[str, Any]:
    normalized_symbol = _normalize_symbol(symbol)
    sql = (
        "SELECT source_symbol, MAX(date) AS last_price_date, "
        "MAX(ingestion_ts) AS last_ingestion_ts, "
        "COUNT(DISTINCT date) AS unique_trading_days "
        "FROM workspace.bronze.yahoo_finance_prices_raw "
        f"WHERE source_symbol = '{normalized_symbol}' "
        "GROUP BY source_symbol LIMIT 1"
    )
    try:
        rows = execute_sql_statement(sql, profile=profile, warehouse_id=warehouse_id)
        return {
            "symbol": normalized_symbol,
            "profile": profile,
            "warehouse_id": warehouse_id,
            "row": rows[0] if rows else None,
        }
    except DatabricksCLIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/databricks/forecast/history")
def api_forecast_history(
    symbol: str = Query(default="NVDA"),
    limit: int = Query(default=60, ge=1, le=500),
    profile: str = Query(default_factory=_default_profile),
    warehouse_id: str = Query(default_factory=_default_warehouse_id),
) -> dict[str, Any]:
    normalized_symbol = _normalize_symbol(symbol)
    sql = (
        "SELECT symbol, forecast_date, horizon_day, pred_close, pred_low_80, pred_high_80, "
        "model_name, cv_mae, forecast_ts "
        "FROM workspace.serving.nvda_forecast_history "
        f"WHERE symbol = '{normalized_symbol}' "
        "ORDER BY forecast_ts DESC, horizon_day ASC "
        f"LIMIT {limit}"
    )
    try:
        rows = execute_sql_statement(sql, profile=profile, warehouse_id=warehouse_id)
        return {
            "symbol": normalized_symbol,
            "count": len(rows),
            "profile": profile,
            "warehouse_id": warehouse_id,
            "rows": rows,
        }
    except DatabricksCLIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/databricks/forecast/metrics")
def api_forecast_metrics(
    symbol: str = Query(default="NVDA"),
    limit: int = Query(default=20, ge=1, le=200),
    profile: str = Query(default_factory=_default_profile),
    warehouse_id: str = Query(default_factory=_default_warehouse_id),
) -> dict[str, Any]:
    normalized_symbol = _normalize_symbol(symbol)
    sql = (
        "SELECT symbol, selected_model, best_cv_mae, pred_std, train_rows, pipeline_run_id, loaded_ts "
        "FROM workspace.serving.nvda_forecast_metrics "
        f"WHERE symbol = '{normalized_symbol}' "
        "ORDER BY loaded_ts DESC "
        f"LIMIT {limit}"
    )
    try:
        rows = execute_sql_statement(sql, profile=profile, warehouse_id=warehouse_id)
        return {
            "symbol": normalized_symbol,
            "count": len(rows),
            "profile": profile,
            "warehouse_id": warehouse_id,
            "rows": rows,
        }
    except DatabricksCLIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
