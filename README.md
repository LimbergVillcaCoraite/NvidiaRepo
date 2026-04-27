# NvidiaRepo

Full-stack application for viewing the NVDA Medallion pipeline results from Databricks.

## Architecture

- Backend: FastAPI with Databricks job and SQL API access
- Frontend: React (Vite) with Nginx in production
- Data source: Unity Catalog tables in `workspace.serving`

Data flow:

1. The NVDA Medallion pipeline writes results into `workspace.serving.*`.
2. The backend queries those tables through the Databricks SQL Statements API.
3. The frontend renders the latest forecast, history, metrics, job status, and the inline analysis view.

## Project Structure

- `backend`: FastAPI API, Databricks client, and security configuration
- `frontend`: responsive React dashboard and inline analysis view
- `docker-compose.yml`: local production-style orchestration

## Environment Variables

Configure these backend variables:

- `DATABRICKS_HOST`
- `DATABRICKS_TOKEN`
- `DATABRICKS_WAREHOUSE_ID`

Optional:

- `DATABRICKS_PROFILE`
- `FRONTEND_ORIGINS`
- `ALLOWED_HOSTS`

See `backend/.env.example` for a quick reference.

## Local Development

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```

Development URLs:

- Frontend: http://localhost:5173
- Backend: http://localhost:8000
- Health check: http://localhost:8000/api/health

## Docker Deployment

The solution is split into two services so they can scale independently:

- backend (FastAPI)
- frontend (Nginx + static React build)

### Start the stack

In PowerShell:

```bash
$env:DATABRICKS_HOST='https://dbc-xxxx.cloud.databricks.com'
$env:DATABRICKS_TOKEN='dapi...'
$env:DATABRICKS_WAREHOUSE_ID='c1790544d31644c6'
docker compose up -d --build
```

Docker URLs:

- UI: http://localhost:8080
- API: http://localhost:8000
- Health check: http://localhost:8000/api/health

## Main Endpoints

- GET /api/health
- GET /api/databricks/jobs/search?name=NVDA medallion
- GET /api/databricks/jobs/{job_id}
- GET /api/databricks/jobs/{job_id}/runs?limit=20
- GET /api/databricks/forecast/latest?symbol=NVDA
- GET /api/databricks/forecast/history?symbol=NVDA&limit=60
- GET /api/databricks/forecast/metrics?symbol=NVDA&limit=20

## Security Notes

- Strict validation for the `symbol` parameter in the backend
- Configurable CORS allowlist
- TrustedHost middleware
- Security headers in both the backend and Nginx
- GET-only API surface for lower risk

## Operational Notes

- The warehouse must be available to execute SQL Statements.
- If `DATABRICKS_PROFILE` is not used, authentication comes from `DATABRICKS_HOST` and `DATABRICKS_TOKEN`.
- If the UI does not show results, check `/api/health` first, then the forecast and jobs endpoints.