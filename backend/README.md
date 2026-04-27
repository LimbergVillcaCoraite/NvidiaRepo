# Backend (FastAPI)

## Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

## Endpoints

- `GET /api/health`
- `GET /api/databricks/jobs`
- `GET /api/databricks/jobs/search?name=NVDA medallion`
- `GET /api/databricks/jobs/{job_id}`
- `GET /api/databricks/jobs/{job_id}/runs?limit=20`
- `GET /api/databricks/forecast/latest?symbol=NVDA`
- `GET /api/databricks/forecast/history?symbol=NVDA&limit=60`
- `GET /api/databricks/forecast/metrics?symbol=NVDA&limit=20`

Variables necesarias en `.env`:

- `DATABRICKS_HOST=https://dbc-xxxx.cloud.databricks.com`
- `DATABRICKS_TOKEN=dapi...`
- `DATABRICKS_WAREHOUSE_ID=c1790544d31644c6`

Optional:

- `DATABRICKS_PROFILE=DatabricksMain`

Variables recomendadas de seguridad:

- `FRONTEND_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080`
- `ALLOWED_HOSTS=localhost,127.0.0.1`
