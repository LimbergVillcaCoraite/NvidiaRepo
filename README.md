# NvidiaRepo — Modo God

Este repositorio contiene la aplicación completa para visualizar los resultados
del pipeline NVDA Medallion (Databricks) y desplegarla en producción con HTTPS
automático mediante `Caddy`.

Lectura rápida (si tienes prisa):

- Ramas: `main` = producción. `feature/*` = trabajo en curso.
- Deploy automático: GitHub Actions dispara un deploy sobre push a `main`.
- Dominio de producción: `https://statusnvidia.duckdns.org` (Caddy gestiona TLS).

----

## Arquitectura (resumen)

- Backend: `FastAPI` (Uvicorn). Expone endpoints `GET` para salud, jobs y forecasts.
- Frontend: `React` (Vite) compilado y servido por `nginx` en producción.
- Reverse proxy público: `Caddy` (ACME: Let's Encrypt/DNS automatico).
- Orquestación local/servidor: `docker compose` (servicios: backend, frontend, caddy).

Datos y flujo:

1. El pipeline Databricks (NVDA Medallion) escribe en tablas Delta bajo `workspace.serving.*`.
2. El backend consulta esas tablas mediante la Databricks SQL Statements API.
3. El frontend consume la API y presenta forecast, histórico, métricas y estado del job.

----

## Cómo uso rápido (desarrollo)

- Backend (Windows/PowerShell):

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

- Frontend:

```bash
cd frontend
npm install
npm run dev
```

URLs de desarrollo:

- Frontend: http://localhost:5173
- Backend: http://localhost:8000
- Health: http://localhost:8000/api/health

----

## Despliegue con Docker (producción)

Se asume que el servidor tiene Docker y Docker Compose instalados y el usuario SSH
puede ejecutar `docker compose` sin pedir TTY interactivo.

1. En el servidor clona o sitúa el repo en `~/NvidiaRepo`.
2. Crea un archivo `.env` en la raíz con al menos:

```text
DATABRICKS_HOST=https://<your-databricks-host>
DATABRICKS_TOKEN=dapi<...>
DATABRICKS_WAREHOUSE_ID=<warehouse-id>
ALLOWED_HOSTS=localhost,127.0.0.1,statusnvidia.duckdns.org
FRONTEND_ORIGINS=https://statusnvidia.duckdns.org
```

3. Inicia:

```bash
docker compose up -d --build
```

Notas:
- Mantén los volúmenes de Caddy (`caddy_data`, `caddy_config`) para conservar certificados.
- Si necesitas editar `.env` en el servidor, usa `scp` para evitar problemas de comillas/escape.

----

## Deploy automático (GitHub Actions)

Se ha añadido un workflow en `.github/workflows/auto-deploy.yml` que ejecuta un
SSH al servidor y realiza `git pull` + `docker compose up -d --build` cuando hay
un `push` a `main`.

Configura estos Secrets en GitHub (Repo → Settings → Secrets → Actions):

- `SSH_PRIVATE_KEY` — clave privada que GitHub Actions usará para SSH (sin passphrase).
- `SSH_HOST` — `146.181.36.103`
- `SSH_USER` — `ubuntu` (u otro usuario con permisos Docker).
- `REMOTE_REPO_PATH` — ruta al repo en el servidor, e.g. `~/NvidiaRepo`.

Cómo funciona el workflow:

1. Checkout del repo.
2. `ssh-agent` añade la clave privada provista via secret.
3. Se hace `ssh $SSH_USER@$SSH_HOST "cd $REMOTE_REPO_PATH && git fetch && git checkout main && git pull origin main && docker compose up -d --build --force-recreate"`.

Recomendación de seguridad: añade la clave pública de `SSH_PRIVATE_KEY` a
`~/.ssh/authorized_keys` del usuario remoto y restringe su uso (por IP o comandos
si lo deseas).

----

## Verificaciones y rollback

- Verificar después del deploy:
	- `docker compose ps` → todos los servicios `Up`.
	- `curl -I https://statusnvidia.duckdns.org` → `HTTP/2 200` y header `server: Caddy`.
	- `curl http://127.0.0.1:8000/api/health` → `{"status":"ok"}`.

- Rollback rápido:

```bash
cd ~/NvidiaRepo
git checkout main
git log --oneline          # identifica el commit previo
git reset --hard <commit>  # fuerza el rollback
docker compose up -d --build --force-recreate
```

----

## Problemas comunes

- HTTP 502 al backend: normalmente archivo `.env` con credenciales inválidas. Reemplazar `.env` por SCP evita errores de comillas.
- Puertos ocupados al iniciar Docker Compose: procesos `docker-proxy` zombificados. Solución:

```bash
sudo ss -ltnp | grep 127.0.0.1:8000
sudo kill -9 <pid>
```

- GitHub Actions: si falla la conexión SSH verifica `SSH_PRIVATE_KEY`/`authorized_keys` y `known_hosts`.

----

## Endpoints principales

- `GET /api/health`
- `GET /api/databricks/jobs/search?name=NVDA medallion`
- `GET /api/databricks/jobs/{job_id}`
- `GET /api/databricks/jobs/{job_id}/runs?limit=20`
- `GET /api/databricks/forecast/latest?symbol=NVDA`

----

## Notes operativas Databricks

- Perfil usado desde CLI: `DatabricksMain` (si aplica).
- Job principal: NVDA Medallion Pipeline (job_id: 411768046518265).
- Para actualizar job settings preferir scripts Python o archivos JSON en lugar de heredocs en PowerShell (evita problemas de escaping).

----

## Si quieres

Si quieres, puedo:

- añadir un `scripts/deploy.sh` remoto y que el workflow lo invoque (recomendado),
- añadir pasos de smoke tests en el workflow (curl a health + forecast), o
- automatizar rollback en caso de fallo del smoke test.

Fin.