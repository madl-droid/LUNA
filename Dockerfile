FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine
ARG BUILD_VERSION=dev
WORKDIR /app
RUN apk add --no-cache ffmpeg libreoffice-writer libreoffice-impress libreoffice-calc yt-dlp
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist/
ENV BUILD_VERSION=${BUILD_VERSION}
COPY src/modules/console/ui/styles/ ./dist/console/styles/
COPY src/modules/console/ui/js/ ./dist/console/js/
COPY src/modules/lead-scoring/ui/ ./dist/modules/lead-scoring/ui/

COPY .env.example ./.env.example
COPY .env.schema ./.env.schema
COPY src/migrations/ ./dist/migrations/
COPY instance/ ./instance/
# Bundled defaults: entrypoint copies missing files into the mounted volume
COPY instance/ ./instance-defaults/
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
