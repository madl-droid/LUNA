# Pipeline y Modelos LLM

## Pipeline actual del engine

El engine ya no opera como un pipeline clásico de 5 fases independientes. El flujo oficial es agentic y comparte el mismo núcleo para mensajes reactivos y proactivos:

1. **Intake**: normalización, resolución de contacto, sesión, memoria, knowledge y contexto.
2. **Effort router**: clasificación determinística `low | medium | high` para escoger modelo/costo.
3. **Agentic loop**: el LLM decide, llama tools, recibe resultados y converge en una respuesta final.
4. **Post-process**: criticizer opcional, formateo por canal y TTS si aplica.
5. **Delivery**: sanitización final, envío, persistencia y efectos posteriores.

## Principios operativos

- Reactivo y proactivo usan el mismo runner compartido.
- La sanitización de salida ocurre antes de TTS y otra vez en delivery.
- Si hay leakage en salida de texto, se sanea y continúa con logging.
- Si hay leakage en salida de audio/TTS, se bloquea el audio y se cae a texto saneado.
- La configuración del módulo `engine` se carga desde `registry.getConfig('engine')` para los campos propios del módulo.

## Tabla de modelos

### Tiempo real
| Uso | Modelo principal | Provider | Fallback |
|-----|------------------|----------|----------|
| Mensajes de bajo esfuerzo | Claude Haiku 4.5 | Anthropic | Gemini 2.5 Flash |
| Mensajes de esfuerzo medio | Claude Sonnet 4.6 | Anthropic | Gemini 2.5 Flash |
| Mensajes de alto esfuerzo | Claude Sonnet 4.6 | Anthropic | Gemini 2.5 Pro |
| Mensajes proactivos | Claude Sonnet 4.6 | Anthropic | Gemini 2.5 Flash |
| Post-process con TTS | Gemini TTS | Google | texto sin audio |

### Batch y background
| Uso | Modelo principal | Provider | Fallback |
|-----|------------------|----------|----------|
| Nightly batch liviano | Claude Haiku 4.5 batch | Anthropic | — |
| Nightly batch complejo | Gemini 2.5 Flash batch | Google | Claude Haiku 4.5 |

## Fallback chain

Anthropic → Google.

Si un provider falla 5 veces en 10 minutos, se marca como `DOWN` durante 5 minutos.
