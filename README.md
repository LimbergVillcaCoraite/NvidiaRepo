# NvidiaRepo

Production-oriented full-stack application for visualizing NVDA Medallion pipeline outputs from Databricks, with containerized deployment and CI/CD automation.

![Python](https://img.shields.io/badge/Python-3.x-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115.6-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Caddy](https://img.shields.io/badge/Caddy-2.8-1F88C0?logo=caddy&logoColor=white)
![Nginx](https://img.shields.io/badge/Nginx-1.27-009639?logo=nginx&logoColor=white)
![Databricks](https://img.shields.io/badge/Databricks-Platform-FF3621?logo=databricks&logoColor=white)
![Delta Lake](https://img.shields.io/badge/Delta-Lake-0A5A9C?logo=databricks&logoColor=white)
![Apache Spark](https://img.shields.io/badge/Apache-Spark-E25A1C?logo=apachespark&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub-Actions-2088FF?logo=githubactions&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-2ea44f)

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

### Platform Badges

![Databricks](https://img.shields.io/badge/Databricks-Workspace%20%26%20Jobs-FF3621?logo=databricks&logoColor=white)
![Unity Catalog](https://img.shields.io/badge/Unity-Catalog-FF6F00)
![Delta Lake](https://img.shields.io/badge/Delta-Lake-0A5A9C)
![Spark](https://img.shields.io/badge/Apache-Spark-E25A1C?logo=apachespark&logoColor=white)
![MLflow](https://img.shields.io/badge/MLflow-Tracking-0194E2?logo=mlflow&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub-Actions-2088FF?logo=githubactions&logoColor=white)

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

![PySpark](https://img.shields.io/badge/PySpark-Distributed%20Compute-E25A1C?logo=apachespark&logoColor=white)
![Pandas](https://img.shields.io/badge/Pandas-DataFrame-150458?logo=pandas&logoColor=white)
![NumPy](https://img.shields.io/badge/NumPy-Numerical-013243?logo=numpy&logoColor=white)
![yfinance](https://img.shields.io/badge/yfinance-Market%20Data-2E7D32)

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

![FastAPI](https://img.shields.io/badge/FastAPI-API-009688?logo=fastapi&logoColor=white)
![Uvicorn](https://img.shields.io/badge/Uvicorn-ASGI-4051B5)
![Requests](https://img.shields.io/badge/Requests-HTTP-4A4A55)
![dotenv](https://img.shields.io/badge/python--dotenv-Config-ECD53F?logo=python&logoColor=black)

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

![React](https://img.shields.io/badge/React-UI-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-Bundler-646CFF?logo=vite&logoColor=white)
![Nginx](https://img.shields.io/badge/Nginx-Static%20Serving-009639?logo=nginx&logoColor=white)

- React 18
- React DOM 18
- Vite 5
- `@vitejs/plugin-react`

Production serving:

- Nginx (containerized static hosting)

### Infrastructure and Deployment

![Docker](https://img.shields.io/badge/Docker-Containers-2496ED?logo=docker&logoColor=white)
![Compose](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Caddy](https://img.shields.io/badge/Caddy-Reverse%20Proxy-1F88C0?logo=caddy&logoColor=white)

- Docker
- Docker Compose v2
- Caddy 2 (automatic HTTPS/TLS)
- Nginx (frontend serving)
- Linux host deployment model

### CI/CD and Source Control

![Git](https://img.shields.io/badge/Git-Version%20Control-F05032?logo=git&logoColor=white)
![GitHub](https://img.shields.io/badge/GitHub-Repository-181717?logo=github&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub-Actions-2088FF?logo=githubactions&logoColor=white)
![SSH](https://img.shields.io/badge/SSH-Remote%20Deploy-4D4D4D?logo=gnubash&logoColor=white)

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
