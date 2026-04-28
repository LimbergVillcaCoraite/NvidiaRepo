# NvidiaRepo — Guía Completa (Modo Dios)

**Status Prod:** 🟢 https://statusnvidia.duckdns.org (HTTPS auto + Caddy ACME)

Aplicación full-stack para visualizar resultados del **pipeline NVDA Medallion** (Databricks) con
despliegue automático en producción, monitoreo, y rollback inteligente.

---

## 📋 Tabla de Contenidos

1. [Lectura Rápida](#lectura-rápida)
2. [Arquitectura](#arquitectura)
3. [Setup Inicial](#setup-inicial)
4. [Desarrollo Local](#desarrollo-local)
5. [Docker & Producción](#docker--producción)
6. [GitHub Actions & Deploy Automático](#github-actions--deploy-automático)
7. [Monitoreo & Verificación](#monitoreo--verificación)
8. [Rollback & Recuperación](#rollback--recuperación)
9. [Troubleshooting](#troubleshooting)
10. [Seguridad](#seguridad)
11. [Operaciones Databricks](#operaciones-databricks)
12. [Comandos Útiles](#comandos-útiles)
13. [FAQ](#faq)

---

## 🚀 Lectura Rápida

- **Ramas**: `main` = producción lissta + auto-deploy. `feature/*` = WIP.
- **Deploy**: Push a `main` → GitHub Actions → SSH → `docker compose up -d` en servidor.
- **URL Prod**: https://statusnvidia.duckdns.org (Caddy gestiona HTTPS + Let's Encrypt).
- **Servidor**: ubuntu@146.181.36.103, repo en `~/NvidiaRepo`.
- **Databricks**: Perfil `DatabricksMain`, job NVDA Medallion (ID: 411768046518265).
- **Secrets requeridos**: Ver [GitHub Actions](#github-actions--deploy-automático).

---

## 🏗️ Arquitectura

### Stack (macroscópico)

```
┌─────────────────────────────────────────────────────┐
│                 Databricks Workspace                │
│  - NVDA Medallion Pipeline (Bronze/Silver/Gold)    │
│  - Serving tables (workspace.serving.*)             │
│  - MLflow tracking + Data quality checks            │
└──────────────┬──────────────────────────────────────┘
		 │ SQL Statements API
		 ↓
┌─────────────────────────────────────────────────────┐
│        FastAPI Backend (Port 8000)                  │
│  - Uvicorn + Gunicorn (prod-like)                   │
│  - CORS + TrustedHost middleware                    │
│  - Security headers (CSP, HSTS, etc.)               │
└──────────────┬──────────────────────────────────────┘
		 │ HTTP
		 ↓
┌─────────────────────────────────────────────────────┐
│   Caddy Reverse Proxy (Port 80/443)                 │
│  - Auto HTTPS (Let's Encrypt ACME)                  │
│  - HTTP → HTTPS redirect                            │
│  - Public IP 0.0.0.0:80/443                         │
└──────────────┬──────────────────────────────────────┘
		 │ HTTPS
		 ↓
	 statusnvidia.duckdns.org
		 │
		 ↓
┌─────────────────────────────────────────────────────┐
│        React + Vite Frontend (Port 8080)            │
│  - Nginx static serving                             │
│  - UX: Forecast, histórico, comparador, favoritos   │
│  - Local binding 127.0.0.1:8080                     │
└─────────────────────────────────────────────────────┘
```

### Stack técnico

| Componente     | Tech Stack                      | Versión    | Puerto         |
|---|---|---|---|
| Backend        | FastAPI + Uvicorn               | 0.115.6    | 127.0.0.1:8000 |
| Frontend       | React + Vite + Nginx            | v5.4.21    | 127.0.0.1:8080 |
| Reverse Proxy  | Caddy + ACME                    | 2.8-alpine | 0.0.0.0:80/443 |
| DB Client      | Databricks SQL API (REST)       | -          | -              |
| Orquestación   | Docker Compose                  | v2+        | -              |
| CI/CD          | GitHub Actions                  | -          | SSH → Server   |

### Flujo de datos

1. **Pipeline Databricks** ejecuta NVDA Medallion (Bronze → Silver → Gold → Forecast → Expose).
2. **Resultados** se escriben en Delta tables bajo `workspace.serving.*`.
3. **Backend** consulta esas tablas vía Databricks SQL Statements API (cada endpoint es una query).
4. **Frontend** consume endpoints REST del backend y renderiza en React.
5. **Caddy** actúa de proxy público, gestiona TLS, y redirige HTTP → HTTPS.
6. **GitHub Actions** dispara deploy automático en push a `main`.

---

## 🛠️ Setup Inicial

### Requisitos previos

- **Local**: Python 3.11+, Node.js 20+, Git, Docker (si prefieres Docker local).
- **Servidor**: Ubuntu 20.04+, Docker + Docker Compose, 2+ GB RAM, puertos 80/443 abiertos (UFW).
- **Databricks**: Workspace activo, job NVDA Medallion, credenciales válidas (token + host + warehouse).
- **DNS**: `statusnvidia.duckdns.org` apuntando a IP pública del servidor.

### Clonar y preparar repo

```bash
git clone https://github.com/LimbergVillcaCoraite/NvidiaRepo.git
cd NvidiaRepo
git checkout main
```

---

## 💻 Desarrollo Local

### Backend (FastAPI)

**Windows PowerShell:**

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# Edita .env con tus credenciales Databricks
uvicorn app.main:app --reload --port 8000
```

**Linux/Mac:**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edita .env
uvicorn app.main:app --reload --port 8000
```

URLs de desarrollo:
- Backend: http://localhost:8000
- Health: http://localhost:8000/api/health
- Docs interactivos: http://localhost:8000/docs

### Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

URLs de desarrollo:
- Frontend: http://localhost:5173 (Vite hot reload)
- API target (en dev): http://localhost:8000 (configurable en App.jsx)

### Verificación local

```bash
# Terminal 1: Backend
cd backend && uvicorn app.main:app --reload

# Terminal 2: Frontend
cd frontend && npm run dev

# Terminal 3: Test
curl http://localhost:8000/api/health
# Esperado: {"status":"ok"}
```

---

## 🐳 Docker & Producción

### Build local (para probar)

```bash
docker compose build
docker compose up -d
```

URLs Docker local:
- UI: http://localhost:8080
- API: http://localhost:8000
- Health: http://localhost:8000/api/health

### Deploy en servidor (manual)

1. **SSH al servidor:**

```bash
ssh -i ~/.ssh/id_rsa ubuntu@146.181.36.103
```

2. **Clonar/sincronizar repo:**

```bash
cd ~/NvidiaRepo
git fetch origin
git checkout main
git pull origin main
```

3. **Configurar `.env`:**

```bash
# Si no existe
cp .env.example .env
nano .env  # edita, o usa scp para copiar desde local
```

Variables requeridas:

```text
DATABRICKS_HOST=https://dbc-xxxxx.cloud.databricks.com
DATABRICKS_TOKEN=dapi<...>
DATABRICKS_WAREHOUSE_ID=<warehouse-id>
ALLOWED_HOSTS=localhost,127.0.0.1,statusnvidia.duckdns.org
FRONTEND_ORIGINS=https://statusnvidia.duckdns.org
```

4. **Iniciar stack:**

```bash
docker compose up -d --build --force-recreate
docker compose ps  # verifica que todos están Up
```

5. **Verificación:**

```bash
# Interna
curl -s http://127.0.0.1:8000/api/health | jq .

# Externa (después de 30-60s para Caddy ACME)
curl -I https://statusnvidia.duckdns.org
# Esperado: HTTP/2 200 (Caddy)
```

---

## ⚙️ GitHub Actions & Deploy Automático

### Setup de Secrets (IMPORTANTE)

**GitHub → Repo → Settings → Secrets and variables → Actions → New repository secret**

Añade 4 secrets:

| Secret            | Valor                                   | Ejemplo |
|---|---|---|
| `SSH_PRIVATE_KEY` | Contenido completo de `~/.ssh/id_rsa`  | `-----BEGIN RSA PRIVATE KEY-----...-----END...` |
| `SSH_HOST`        | IP pública servidor                     | `146.181.36.103` |
| `SSH_USER`        | Usuario SSH con permisos Docker        | `ubuntu` |
| `REMOTE_REPO_PATH`| Ruta repo en servidor                  | `~/NvidiaRepo` o `/home/ubuntu/NvidiaRepo` |

**Cómo obtener `SSH_PRIVATE_KEY`:**

```powershell
# Windows
Get-Content $HOME\.ssh\id_rsa

# Linux/Mac
cat ~/.ssh/id_rsa
```

Copias **TODO** (líneas `-----BEGIN` a `-----END` inclusive) y lo pegas en el campo del secret.

### Workflow (`.github/workflows/auto-deploy.yml`)

**Trigger:** Push a rama `main`.

**Pasos:**

1. ✅ **Checkout** → descarga código del repo.
2. ✅ **SSH Agent** → carga clave privada en GitHub Runner.
3. ✅ **Known Hosts** → añade servidor a `~/.ssh/known_hosts`.
4. ✅ **Save state** → captura commit actual para rollback.
5. 🚀 **Deploy** → ejecuta `bash scripts/deploy.sh` en servidor remoto.
6. 🧪 **Smoke tests** → 10 intentos de health check (3s entre intentos).
7. 🔄 **Rollback** (si falla) → revierte al commit previo + reinicia Docker.
8. 📊 **Status** → reporte de éxito/fallo.

### Cómo ver el workflow

1. GitHub → Repo → **Actions** (pestaña).
2. Selecciona **Auto Deploy to Server** en la izquierda.
3. Haz un push a `main` (e.g., `git push origin main`).
4. Verás la ejecución en tiempo real (click en el run).
5. Logs completos en cada step.

---

## ✅ Monitoreo & Verificación

### Verificaciones post-deploy (desde servidor)

```bash
# Estado de contenedores
docker compose -f ~/NvidiaRepo/docker-compose.yml ps

# Logs en vivo
docker compose -f ~/NvidiaRepo/docker-compose.yml logs -f backend

# Health endpoint (interno)
curl -s http://127.0.0.1:8000/api/health | jq .

# HTTPS endpoint (externo)
curl -I https://statusnvidia.duckdns.org

# Certificado SSL
echo | openssl s_client -connect statusnvidia.duckdns.org:443 2>/dev/null | openssl x509 -noout -dates
```

### Verificaciones desde local

```bash
# Desde tu PC
curl -I https://statusnvidia.duckdns.org
curl http://statusnvidia.duckdns.org/api/health
```

### Métricas útiles

- **Uptime**: `docker compose ps` → `STATUS` debe ser `Up X minutes`.
- **Logs**: `docker compose logs --tail 50 backend`.
- **Recursos**: `docker stats` (CPU/RAM en vivo).
- **Certificado**: Valida con `openssl s_client`.

---

## 🔄 Rollback & Recuperación

### Rollback automático (triggered por CI/CD)

Si el smoke test falla, el workflow ejecuta automáticamente:

```bash
git reset --hard <PREVIOUS_COMMIT>
docker compose down
docker compose up -d --build
```

### Rollback manual (si necesitas)

```bash
ssh ubuntu@146.181.36.103
cd ~/NvidiaRepo

# Ver histórico
git log --oneline | head -10

# Revert a commit específico
git reset --hard <COMMIT_HASH>

# Reinicia stack
docker compose down
docker compose up -d --build --force-recreate

# Verifica
curl -s http://127.0.0.1:8000/api/health
```

### Recuperación de volúmenes Caddy

**Importante**: Los volúmenes `caddy_data` y `caddy_config` contienen certificados. No los borres:

```bash
# ✅ SEGURO: Preserve volúmenes
docker compose up -d --build

# ❌ NO RECOMENDADO: Borra certificados
docker compose down -v  # -v borra volúmenes
```

---

## 🔧 Troubleshooting

### HTTP 502 en https://statusnvidia.duckdns.org

**Causas comunes:**
- Credenciales Databricks inválidas en `.env`.
- Backend no corriendo (`docker compose ps` → backend: Dead/Exit).
- Puerto 8000 ocupado.

**Soluciones:**

```bash
# 1. Verifica backend
docker compose logs backend | tail -50

# 2. Verifica .env
grep DATABRICKS ~/.env  # asegúrate de que no esté vacío/placeholder

# 3. Reemplaza .env por SCP (evita problemas de comillas)
scp -i ~/.ssh/id_rsa ~/local/.env ubuntu@146.181.36.103:~/NvidiaRepo/.env

# 4. Reinicia containers
docker compose down && docker compose up -d --build
```

### Puertos ocupados (EADDRINUSE)

```bash
# Identifica procesos
sudo ss -ltnp | grep -E ':8000|:8080|:80|:443'

# Mata docker-proxy zombificados
sudo kill -9 <PID>

# Limpia Docker
docker system prune -f

# Reinicia
docker compose up -d --build
```

### GitHub Actions: SSH connection refused

**Causas:**
- `SSH_PRIVATE_KEY` secret mal copiado (falta `-----BEGIN/END`).
- `authorized_keys` no contiene clave pública correspondiente.
- `SSH_HOST` o `SSH_USER` incorrectos.

**Soluciones:**

```bash
# En servidor: verifica authorized_keys
cat ~/.ssh/authorized_keys | wc -l  # debe tener claves

# En local: extrae clave pública
ssh-keygen -y -f ~/.ssh/id_rsa

# Copia pública a servidor
ssh-copy-id -i ~/.ssh/id_rsa ubuntu@146.181.36.103
```

### GitHub Actions: Health check timeout

**Cause:** Caddy tardó más de lo esperado en obtener certificado.

**Solución:** Aumenta retries en el workflow (`.github/workflows/auto-deploy.yml`, step `Run smoke tests`).

### Caddy no obtiene certificado (HTTP 404)

**Cause:** DuckDNS no resuelve a la IP pública del servidor.

**Soluciones:**

```bash
# Verifica DNS
nslookup statusnvidia.duckdns.org

# Verifica que UFW permite puertos 80/443
sudo ufw status
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Revisa logs de Caddy
docker compose logs caddy | grep -i "acme\|challenge\|certificate"
```

---

## 🔒 Seguridad

### Headers de seguridad (Backend + Nginx)

Implementados en backend/app/main.py y frontend/nginx.conf:

```
Content-Security-Policy: default-src 'self'; connect-src 'self'; img-src 'self' data:; ...
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=()
Referrer-Policy: strict-origin-when-cross-origin
```

### Validación de entrada

- **Symbol parameter**: Whitelist estricto (NVDA, etc.) en backend.
- **CORS**: Solo orígenes en `FRONTEND_ORIGINS`.
- **TrustedHost**: Solo `ALLOWED_HOSTS` aceptados.
- **GET-only API**: Sin POST/PUT/DELETE (menor riesgo).

### Secrets & Credenciales

- ✅ **No commitar `.env`** (está en `.gitignore`).
- ✅ **GitHub Secrets**: Usa variables de entorno desde Actions.
- ✅ **SSH Keys**: Sin passphrase para CI/CD; con passphrase en local.
- ✅ **Databricks Token**: Usa scope limited (si posible).

### Certificados SSL

- 🔐 **Let's Encrypt**: Renovación automática por Caddy.
- 📅 **Check expiry**: `echo | openssl s_client -connect statusnvidia.duckdns.org:443 2>/dev/null | openssl x509 -noout -dates`.
- 🔄 **Renovación**: Automática (Caddy renueva ~30 días antes).

---

## 📊 Operaciones Databricks

### Job principal

- **ID**: 411768046518265
- **Name**: NVDA Medallion Pipeline
- **Tasks**: Bronze → Silver → Gold → Forecast (30d) → Expose → Quality Report
- **Output**: Delta tables en `workspace.serving.*`
- **CLI Profile**: `DatabricksMain`

### Comandos útiles (Databricks CLI)

```bash
# Listar jobs
databricks jobs list --profile DatabricksMain

# Obtener detalles del job
databricks jobs get --job-id 411768046518265 --profile DatabricksMain

# Ejecutar job manualmente
databricks jobs run-now --job-id 411768046518265 --profile DatabricksMain

# Ver histórico de runs
databricks jobs list-runs --job-id 411768046518265 --limit 10 --profile DatabricksMain

# Exportar notebooks
databricks workspace export-dir /Repos/... ./local_export --profile DatabricksMain
```

### Notebooks & Tablas

| Notebook          | Propósito                              | Output Table           |
|---|---|---|
| 01_Bronze         | Yahoo Finance ingestion                | `workspace.bronze.*`   |
| 02_Silver         | Limpieza y transformación              | `workspace.silver.*`   |
| 03_Gold           | Agregaciones finales                   | `workspace.gold.*`     |
| 04_Forecast       | Modelo ML + predicciones               | `workspace.forecast.*` |
| 05_Expose         | Serving tables (API-ready)             | `workspace.serving.*`  |
| 06_Serving_SQL    | Queries helper                         | -                      |
| 07_Data_Quality   | Checks post-pipeline                   | `workspace.quality.*`  |

---

## ⚡ Comandos Útiles

### Desarrollo

```bash
# Backend
cd backend && uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm run dev

# Build frontend
cd frontend && npm run build
```

### Docker

```bash
# Build
docker compose build

# Up
docker compose up -d --build

# Down
docker compose down

# Logs
docker compose logs -f backend

# Rebuild específico
docker compose up -d --build --force-recreate backend
```

### Server (SSH)

```bash
# SSH
ssh -i ~/.ssh/id_rsa ubuntu@146.181.36.103

# SCP (copiar .env)
scp -i ~/.ssh/id_rsa .env ubuntu@146.181.36.103:~/NvidiaRepo/

# Deploy manual
ssh ubuntu@146.181.36.103 "bash ~/NvidiaRepo/scripts/deploy.sh ~/NvidiaRepo main"
```

### Git

```bash
# Crear branch
git checkout -b feature/xyz

# Commit y push
git add -A
git commit -m "feat: describe"
git push origin feature/xyz

# Merge a main
git checkout main
git merge --no-ff feature/xyz
git push origin main  # Dispara auto-deploy
```

---

## ❓ FAQ

**P: ¿Cómo actualizo `.env` en el servidor sin problemas?**
A: Usa `scp`: `scp -i ~/.ssh/id_rsa .env ubuntu@146.181.36.103:~/NvidiaRepo/`. Evita heredoc/echo que tiene problemas de escaping.

**P: ¿Cómo hago rollback sin git?**
A: `docker compose down && git reset --hard <hash> && docker compose up -d`.

**P: ¿Qué pasa si falla el deploy?**
A: Rollback automático triggered por GitHub Actions si el health check falla.

**P: ¿Cómo monitoreo certificados SSL?**
A: `echo | openssl s_client -connect statusnvidia.duckdns.org:443 2>/dev/null | openssl x509 -noout -dates`.

**P: ¿Puedo usar otra rama para testing?**
A: Sí, pero solo `main` dispara auto-deploy. Usa `feature/*` para WIP, merge con PR.

**P: ¿Debo reiniciar Caddy después de cambios?**
A: No, `docker compose up -d --build --force-recreate` maneja todo.

**P: ¿Cómo escalo a múltiples servidores?**
A: Copia configuración de uno a otros, o usa Terraform/Ansible (fuera del scope actual).

---

## 🎯 Próximas mejoras

- [ ] Smoke tests extendidos (forecast endpoint).
- [ ] Métricas Prometheus + Grafana.
- [ ] Log aggregation (ELK/Loki).
- [ ] Load testing (k6/locust).
- [ ] Multi-region setup.
- [ ] Blue/Green deployments.

---

**Última actualización**: 2026-04-27  
**Maintainer**: Limberth Villca  
**License**: MIT