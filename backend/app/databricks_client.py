import os
import time
from typing import Any

import requests


class DatabricksCLIError(Exception):
    pass


def _normalize_host(host: str) -> str:
    normalized = host.strip().rstrip("/")
    if not normalized:
        return normalized
    if not normalized.startswith("http://") and not normalized.startswith("https://"):
        normalized = f"https://{normalized}"
    return normalized


def _databricks_request(
    method: str,
    path: str,
    profile: str,
    payload: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    _ = profile  # Kept for API compatibility; env auth is used in containerized runtime.
    host = _normalize_host(os.getenv("DATABRICKS_HOST", ""))
    token = os.getenv("DATABRICKS_TOKEN", "").strip()

    if not host or not token:
        raise DatabricksCLIError("DATABRICKS_HOST and DATABRICKS_TOKEN are required")

    url = f"{host}{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    try:
        response = requests.request(
            method=method.upper(),
            url=url,
            headers=headers,
            json=payload,
            params=params,
            timeout=60,
        )
    except requests.RequestException as exc:
        raise DatabricksCLIError(f"Databricks request failed: {exc}") from exc

    if response.status_code >= 400:
        detail = response.text.strip()
        try:
            parsed_error = response.json()
            if isinstance(parsed_error, dict):
                detail = (
                    parsed_error.get("message")
                    or parsed_error.get("error")
                    or parsed_error.get("detail")
                    or detail
                )
        except ValueError:
            pass
        raise DatabricksCLIError(f"Databricks API error ({response.status_code}): {detail}")

    try:
        parsed = response.json()
    except ValueError as exc:
        raise DatabricksCLIError("Databricks API did not return valid JSON") from exc

    if not isinstance(parsed, dict):
        raise DatabricksCLIError("Unexpected Databricks API response format")

    return parsed


def list_jobs(profile: str) -> list[dict[str, Any]]:
    data = _databricks_request("get", "/api/2.2/jobs/list", profile, params={"limit": 100})
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and "jobs" in data:
        return data["jobs"]
    return []


def get_job(job_id: int, profile: str) -> dict[str, Any]:
    data = _databricks_request("get", "/api/2.2/jobs/get", profile, params={"job_id": job_id})
    if not isinstance(data, dict):
        raise DatabricksCLIError("Unexpected response for jobs get")
    return data


def list_runs(job_id: int, profile: str) -> list[dict[str, Any]]:
    data = _databricks_request("get", "/api/2.2/jobs/runs/list", profile, params={"job_id": job_id})
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and "runs" in data:
        return data["runs"]
    return []


def find_jobs_by_name(name_query: str, profile: str) -> list[dict[str, Any]]:
    jobs = list_jobs(profile)
    lowered = name_query.lower().strip()
    if not lowered:
        return jobs

    return [
        job
        for job in jobs
        if lowered in str(job.get("settings", {}).get("name", "")).lower()
    ]


def execute_sql_statement(
    statement: str,
    profile: str,
    warehouse_id: str,
    timeout_seconds: int = 45,
) -> list[dict[str, Any]]:
    if not warehouse_id:
        raise DatabricksCLIError("DATABRICKS_WAREHOUSE_ID is required")

    create_payload = {
        "statement": statement,
        "warehouse_id": warehouse_id,
        "wait_timeout": "10s",
    }
    created = _databricks_request("post", "/api/2.0/sql/statements", profile, create_payload)
    statement_id = created.get("statement_id")
    if not statement_id:
        raise DatabricksCLIError("Failed to create SQL statement execution")

    deadline = time.time() + timeout_seconds
    current = created
    while True:
        status = (current.get("status") or {}).get("state", "")
        if status == "SUCCEEDED":
            break
        if status in {"FAILED", "CANCELED", "CLOSED"}:
            msg = (current.get("status") or {}).get("error", {}).get("message")
            raise DatabricksCLIError(msg or f"SQL statement failed with state {status}")
        if time.time() >= deadline:
            raise DatabricksCLIError("Timed out waiting for Databricks SQL statement")

        time.sleep(1)
        current = _databricks_request("get", f"/api/2.0/sql/statements/{statement_id}", profile)

    manifest = current.get("manifest") or {}
    schema = manifest.get("schema") or {}
    columns = [col.get("name") for col in (schema.get("columns") or [])]
    rows = ((current.get("result") or {}).get("data_array")) or []

    output: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, list):
            continue
        output.append({col_name: row[idx] for idx, col_name in enumerate(columns) if col_name})

    return output
