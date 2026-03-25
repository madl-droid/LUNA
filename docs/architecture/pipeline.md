# Pipeline y Modelos LLM

## Pipeline (5 pasos, solo 2 usan LLM)
1. **Preprocess** (código): normalizar, identificar contacto, cargar contexto
2. **Classify** (LLM barato): intención, tools necesarias, sentiment
2.5. **Complexity Route** (código): decide si escalar modelo
3. **Execute Tools** (código): ejecutar tools, armar contexto resuelto
4. **Respond** (LLM potente): generar respuesta conversacional
5. **Postprocess** (código): validar, formatear, enviar, guardar, loguear

## Tabla de modelos

### TIEMPO REAL — EL CONTACTO ESTÁ ESPERANDO
| Tarea | Modelo principal | Provider | Fallback |
|-------|-----------------|----------|----------|
| Clasificar intención | Claude Haiku 4.5 | Anthropic | Gemini 2.5 Flash |
| Ejecutar tools / resolver | Claude Haiku 4.5 | Anthropic | Gemini 2.5 Flash |
| Generar respuesta conversacional | Claude Sonnet 4.5 | Anthropic | Gemini 2.5 Flash |
| Tareas complejas | Claude Opus 4.5 | Anthropic | Gemini 2.5 Pro |
| Mensajes proactivos / follow-ups | Claude Sonnet 4.5 | Anthropic | Gemini 2.5 Flash |
| Comprimir sesión (en vivo) | Claude Haiku 4.5 | Anthropic | Gemini 2.5 Flash |

### BATCH NOCTURNO — NADIE ESPERA, 50% DESCUENTO
| Tarea | Modelo principal | Provider | Fallback |
|-------|-----------------|----------|----------|
| Scoring de leads fríos | Claude Haiku 4.5 batch | Anthropic | — |
| Clasificar objeciones acumuladas | Claude Sonnet 4.5 batch | Anthropic | — |
| Comprimir memoria masiva | Gemini 2.5 Flash batch | Google | Claude Haiku 4.5 |
| Reporte diario al Sheet | Gemini 2.5 Flash batch | Google | — |

### VOZ, BÚSQUEDA Y MEDIA
| Tarea | Modelo principal | Provider | Fallback |
|-------|-----------------|----------|----------|
| Búsqueda web | Gemini 2.5 Flash + Grounding | Google | Anthropic web_search |
| Script para audio / llamadas | Claude Sonnet 4.5 | Anthropic | Gemini 2.5 Flash |
| TTS / síntesis de voz | Gemini TTS | Google | — |
| Llamadas en vivo (V2) | Gemini Live | Google | — |

## Fallback chain
Anthropic → Google.
Si un provider falla 5x en 10 min → marcarlo DOWN por 5 min (circuit breaker).
