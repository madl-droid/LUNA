# Deploy — Infraestructura y despliegue

## Ramas
- `main` = producción. Push a main → build + deploy automático.
- `pruebas` = staging. Push a pruebas → build + deploy automático.
- `claude` = desarrollo con Claude Code. Merge a pruebas o main cuando esté listo.

## Flujo de deploy
1. Push a rama (`main` o `pruebas`)
2. GitHub Actions (`.github/workflows/deploy.yml`) construye imagen Docker → sube a GHCR
3. SSH al servidor → `docker compose pull && docker compose up -d`
4. Traefik detecta el container → HTTPS automático con Let's Encrypt

## Imágenes Docker
- `ghcr.io/madl-droid/luna:latest` — producción (rama main)
- `ghcr.io/madl-droid/luna:staging` — staging (rama pruebas)

## Layout del servidor
```
/docker/
  traefik/          — reverse proxy + Let's Encrypt (NO TOCAR)
  luna-production/  — docker-compose.yml + .env (container: LUNA)
  luna-staging/     — docker-compose.yml + .env (container: LUNA-S)
```

## URLs
- Producción: `luna.madl98.cloud`
- Staging: `luna-s.madl98.cloud`

## Docker compose
- `.env` montado como volumen (persiste edits desde oficina entre deploys)
- `instance/` montado como volumen (wa-auth + config operacional)
- PostgreSQL 16 + Redis 7 como servicios con health checks
- Traefik labels para routing y SSL automático
- `BUILD_VERSION` como build arg (mostrado en oficina)

## Portabilidad — nuevo servidor
1. Instalar Docker y Traefik
2. Copiar `deploy/production/docker-compose.yml` a `/docker/luna-production/`
3. Copiar `deploy/.env.example` a `.env` y llenar: DOMAIN, DB_PASSWORD, API keys
4. `docker login ghcr.io` con PAT (scope `read:packages`)
5. `docker compose up -d`

## Variables de entorno clave
- `DOMAIN` — dominio para Traefik routing + SSL (requerido)
- `APP_PORT` — puerto app (default: 3000 prod, 3001 staging)
- `DB_PASSWORD` — password PostgreSQL (requerido, sin default)
- `NODE_ENV` — development | staging | production | test
- `BUILD_VERSION` — inyectado en build de Docker
- Ver `deploy/.env.example` para lista completa

## Secrets de GitHub Actions
- `SSH_HOST` — IP o dominio del servidor
- `SSH_USER` — usuario SSH
- `SSH_KEY` — clave privada SSH
- `SSH_PORT` — puerto SSH (default 22)
