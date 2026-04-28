# NvidiaRepo

Production-oriented full-stack application for visualizing NVDA Medallion pipeline outputs from Databricks, with containerized deployment and CI/CD automation.

## Table of Contents

1. Overview
2. Architecture
3. Repository Structure
4. Full Technology Stack
5. Environment Variables
6. Local Development
7. Docker Deployment
8. CI/CD Auto-Deploy
9. Operations and Verification
10. Troubleshooting
11. Security Notes

## Overview

This project provides an end-to-end flow from market-data processing in Databricks to a web application for operational and analytical visibility.

High-level data flow:

1. Databricks notebooks process raw NVDA data through a Medallion pipeline.
2. Forecast and serving tables are published in Unity Catalog.
3. FastAPI queries Databricks SQL Statements API.
4. React frontend consumes API endpoints and renders dashboards.
5. Caddy serves the app over HTTPS and proxies requests.

## Architecture

- Backend: FastAPI service exposing health, jobs, and forecast endpoints.
- Frontend: React + Vite app served by Nginx in production.
- Reverse proxy: Caddy with automatic TLS certificates.
- Data platform: Databricks (Unity Catalog + Delta tables + Jobs).
- Orchestration: Docker Compose.
- Automation: GitHub Actions auto-deploy on `main`.

## Repository Structure

- `backend/`: API service, Databricks client integration, app configuration.
- `frontend/`: UI application and static serving config.
- `.databricks_nvda/`: exported notebook sources and Databricks pipeline assets.
- `.github/workflows/auto-deploy.yml`: CI/CD deployment workflow.
- `scripts/deploy.sh`: remote deployment script used by CI.
- `docker-compose.yml`: multi-service container orchestration.
- `Caddyfile`: reverse proxy and HTTPS config.

## Full Technology Stack

This section inventories all major technologies used across notebooks, jobs, pipelines, deployment, and application runtime.

### Data Platform and Notebook Runtime

- Databricks Workspace
- Databricks Jobs (task orchestration)
- Databricks SQL Warehouse
- Databricks SQL Statements REST API
- Unity Catalog (catalog/schema governance)
- Delta Lake (transactional table storage)
- Apache Spark / PySpark
- Python notebooks
- SQL notebooks
- MLflow (experiment tracking in forecast workflow)

### Data and Modeling Libraries (Notebook Layer)

- Python 3.x (Databricks runtime)
- `pyspark`
- `pandas`
- `numpy`
- `yfinance` (market data ingestion)
- DeltaTable APIs (`delta.tables`) for idempotent merge patterns

### Databricks Operational Tooling

- Databricks CLI
- Notebook export/import workflows
- Job run automation (`run-now`)
- Workspace file synchronization patterns

### Backend Application Stack

From `backend/requirements.txt`:

- `fastapi==0.115.6`
- `uvicorn[standard]==0.32.1`
- `python-dotenv==1.0.1`
- `requests==2.32.3`

Related backend capabilities:

- CORS middleware
- Trusted host validation
- Security headers
- HTTP integration with Databricks APIs

### Frontend Application Stack

From `frontend/package.json`:

- React 18
- React DOM 18
- Vite 5
- `@vitejs/plugin-react`

Production serving:

- Nginx (containerized static hosting)

### Infrastructure and Deployment

- Docker
- Docker Compose v2
- Caddy 2 (automatic HTTPS/TLS)
- Nginx (frontend serving)
- Linux host deployment model

### CI/CD and Source Control

- Git
- GitHub
- GitHub Actions
- SSH-based remote deployment
- Health-check smoke testing
- Rollback workflow logic (CI failure path)

## Environment Variables

Required in root `.env` for backend runtime:

- `DATABRICKS_HOST`
- `DATABRICKS_TOKEN`
- `DATABRICKS_WAREHOUSE_ID`

Common optional settings:

- `ALLOWED_HOSTS`
- `FRONTEND_ORIGINS`
- `DATABRICKS_PROFILE`

Example values should use placeholders and never include real secrets.

## Local Development

### Backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Default local URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- Health: `http://localhost:8000/api/health`

## Docker Deployment

Build and run all services:

```bash
docker compose up -d --build
```

Check status:

```bash
docker compose ps
docker compose logs --tail 100 backend
docker compose logs --tail 100 frontend
docker compose logs --tail 100 caddy
```

## CI/CD Auto-Deploy

Auto-deploy is triggered on push to `main` via `.github/workflows/auto-deploy.yml`.

Required GitHub repository secrets:

- `SSH_PRIVATE_KEY`
- `SSH_HOST`
- `SSH_USER`
- `REMOTE_REPO_PATH`

Workflow summary:

1. Validate required secrets.
2. Configure SSH and known hosts.
3. Save pre-deployment Git state.
4. Execute remote `scripts/deploy.sh`.
5. Run health smoke tests.
6. Trigger rollback if deployment validation fails.

## Operations and Verification

Post-deploy checks:

```bash
curl -I https://<your-domain>
curl https://<your-domain>/api/health
```

Server-side checks:

```bash
docker compose ps
docker compose logs --tail 100 backend
```

## Troubleshooting

Common issues:

- 502/Bad Gateway:
  - Verify backend container is healthy.
  - Validate Databricks credentials and warehouse ID.
- CI deploy failures:
  - Confirm all required GitHub secrets exist.
  - Confirm SSH key pair is correctly configured on target host.
- TLS issues:
  - Confirm domain DNS points to deployment host.
  - Confirm inbound ports 80 and 443 are open.

## Security Notes

- Do not commit real credentials, host IPs, usernames, or private infrastructure identifiers.
- Use placeholders in docs and examples.
- Keep `.env` out of version control.
- Restrict CORS and host allowlists in production.
- Rotate Databricks tokens and SSH keys periodically.
