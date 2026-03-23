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
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist/
ENV BUILD_VERSION=${BUILD_VERSION}
COPY src/modules/console/ui/styles/ ./dist/console/styles/
COPY src/modules/console/ui/js/ ./dist/console/js/
COPY src/modules/lead-scoring/ui/ ./dist/modules/lead-scoring/ui/

COPY .env.example ./.env.example
COPY .env.schema ./.env.schema
COPY instance/config.json ./instance/config.json
COPY instance/config.schema.json ./instance/config.schema.json
EXPOSE 3000
CMD ["node", "dist/index.js"]
