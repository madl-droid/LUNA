# =============================================================================
# LUNA - Dockerfile generico
# Funciona en cualquier servidor: clonar repo → docker compose up
# =============================================================================

FROM node:22-alpine AS builder

WORKDIR /app

# Instalar dependencias primero (cache de layers)
COPY package.json package-lock.json ./
RUN npm ci

# Copiar codigo fuente y compilar
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# --- Imagen final (sin devDependencies ni src) ---
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copiar el build compilado
COPY --from=builder /app/dist ./dist

# Copiar la carpeta instance (config por instancia)
COPY instance/ ./instance/

# Varlock necesita el schema para validar env vars al arrancar
COPY .env.schema ./

EXPOSE 3001

CMD ["node", "dist/index.js"]
