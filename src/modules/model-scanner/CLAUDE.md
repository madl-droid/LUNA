# Model Scanner — Escáner de modelos LLM

Escanea APIs de Anthropic y Google AI para descubrir modelos disponibles, detectar deprecados y auto-reemplazar.

## Archivos
- `manifest.ts` — lifecycle, configSchema, scan periódico
- `scanner.ts` — lógica de scan: fetch de APIs, detección de familias, reemplazo automático

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- configSchema: ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY, MODEL_SCAN_INTERVAL_MS (default: 21600000 = 6h)

## API routes (montadas en /oficina/api/model-scanner/)
- `GET /status` — último resultado de scan (modelos por provider, fecha, reemplazos)
- `POST /scan` — disparar scan manual
- `GET /scan` — obtener resultado del último scan

## Patrones
- Scan periódico configurable (default cada 6 horas)
- Detecta modelos deprecados por familia (haiku, sonnet, opus, flash, pro)
- Si un modelo configurado ya no existe, auto-reemplaza por el más reciente de su familia
- Guarda modelos disponibles en instance/config.json para display en oficina
- Scan al iniciar + intervalo periódico

## Trampas
- Requiere API keys válidas (ANTHROPIC_API_KEY y/o GOOGLE_AI_API_KEY). Sin keys, scan falla silenciosamente.
- El auto-replace modifica el .env directamente — los cambios persisten
- Si ambos providers fallan, el scan retorna resultado parcial (no error)
