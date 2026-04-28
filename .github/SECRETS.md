# GitHub Actions Secrets Configuration

Para que el workflow de auto-deploy funcione, configura estos secrets en GitHub:

**Repo → Settings → Secrets and variables → Actions → New repository secret**

## Required Secrets

### `SSH_PRIVATE_KEY`
- **Value**: La clave privada SSH sin passphrase (contenido completo de `~/.ssh/id_rsa`).
- **Cómo obtenerla localmente**:
  ```powershell
  Get-Content $HOME\.ssh\id_rsa
  ```
- **Nota**: Se recomienda usar una clave dedicada sin passphrase para CI/CD.

### `SSH_HOST`
- **Value**: `146.181.36.103`

### `SSH_USER`
- **Value**: `ubuntu`

### `REMOTE_REPO_PATH`
- **Value**: `~/NvidiaRepo` (o ruta absoluta en el servidor, e.g., `/home/ubuntu/NvidiaRepo`)

## Verificación

1. La clave pública ha sido instalada en `~/.ssh/authorized_keys` del servidor.
2. Puedes verificar que el deploy manual funciona:
   ```bash
   ssh -i ~/.ssh/id_rsa ubuntu@146.181.36.103 "bash ~/NvidiaRepo/scripts/deploy.sh ~/NvidiaRepo main"
   ```

## Workflow Behavior

- **On trigger**: Push a `main` branch.
- **Steps**:
  1. Checkout del repo.
  2. Preparación de SSH (ssh-agent + known_hosts).
  3. Guardado del commit previo (para rollback).
  4. Ejecución del script de deploy remoto.
  5. Smoke tests (10 intentos, 3 segundos entre intentos).
  6. **Si falla**: Rollback automático al commit previo y reinicio de containers.
  7. Reporte de estado.

## Rollback Manual

Si necesitas hacer rollback sin volver a hacer push:

```bash
ssh -i ~/.ssh/id_rsa ubuntu@146.181.36.103 "cd ~/NvidiaRepo && git reset --hard <commit-hash> && docker compose down && docker compose up -d --build"
```

## Troubleshooting

- **SSH connection refused**: verifica que `SSH_PRIVATE_KEY` y `authorized_keys` coinciden.
- **Health check timeout**: verifica que Caddy está ejecutándose (`docker compose ps`).
- **Deploy script permission denied**: asegúrate de que `scripts/deploy.sh` tiene permisos `755` o es ejecutado con `bash`.
