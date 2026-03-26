# Freight — Estimación de flete internacional

Tool `estimate-freight`: estima costos de flete dado origen, destino y carga. Carriers V1: SeaRates + DHL Express.

## Archivos
- `freight-tool.ts` — tool principal: validación Zod, orquestación, registro con tools:registry
- `freight-router.ts` — selección de carriers según ruta, servicio y config (código puro, cero LLM)
- `types.ts` — interfaces: FreightEstimateInput/Result, CarrierEstimate, FreightConfig, FreightSecrets
- `adapters/base-freight-adapter.ts` — clase abstracta con helpers de peso/volumen/fecha
- `adapters/searates-adapter.ts` — SeaRates Logistics Explorer API (GraphQL): ocean FCL/LCL, air, ground
- `adapters/dhl-express-adapter.ts` — MyDHL API Rating (REST): express internacional
- `.env.example` — variables de entorno requeridas

## Config
- Tenant: `instance/tools/freight.json` — carriers activos, buffer, known_origins, disclaimers
- Secrets via env: SEARATES_API_KEY, DHL_EXPRESS_USERNAME/PASSWORD/ACCOUNT_NUMBER, DHL_EXPRESS_TEST_MODE
- Lectura de env usa `getEnv()` de kernel/config.ts (no lee process.env directamente)

## Registro
`registerFreightTool(registry)` obtiene `tools:registry` y registra la tool. Llamar desde init de un módulo que dependa de `tools`.

## Flujo
1. Validar input (Zod) → 2. Router selecciona carriers → 3. Promise.allSettled consulta en paralelo → 4. Buffer configurable (+15%) → 5. Retorna FreightEstimateResult

## Patrones
- SeaRates requiere coordenadas: resuelve de known_origins o falla gracefully
- Container auto-select por volumen CBM: <15→ST20, 15-30→ST40, >30→HC40
- DHL: consolidado de paquetes, peso máximo 70kg/pieza
- Timeout por adapter: 10s (AbortSignal.timeout)

## Tests
- `tests/freight/freight-router.test.ts` — routing por ruta/servicio/peso
- `tests/freight/searates-adapter.test.ts` — mock de GraphQL API, normalización
- `tests/freight/dhl-express-adapter.test.ts` — mock de REST API, auth, URL params
- `tests/freight/freight-tool.test.ts` — integración: validación, buffer, partial failures

## Trampas
- SeaRates es GraphQL, NO usar librería GraphQL — query strings manuales con fetch
- DHL usa Basic Auth (base64 de user:pass)
- Buffer se aplica sobre price_usd; price_original_usd es sin buffer
- Si ambos carriers fallan, success=false y el compositor informa que no pudo cotizar
- Conversión de moneda: NO se hace. Se incluye currency_original para referencia
