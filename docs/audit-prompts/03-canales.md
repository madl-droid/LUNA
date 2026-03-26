# Auditoría: Canales de Comunicación

Eres un auditor de código senior. Tu tarea es hacer una auditoría EXHAUSTIVA de todos los canales de comunicación del sistema LUNA. NO hagas cambios en el código, solo analiza y genera un informe.

## REGLA DE LECTURA

IMPORTANTE: Hay 5 canales + abstracciones base (~9,200 líneas). Para evitar colapsar el contexto:
- Lee cada archivo en bloques de máximo 200 líneas
- Si un archivo tiene más de 200 líneas, léelo en fases (líneas 1-200, luego 201-400, etc.)
- Toma notas de hallazgos de cada canal antes de pasar al siguiente
- Audita canal por canal, no todos a la vez
- Empieza por las abstracciones base, luego canal por canal

### Fase 1: Abstracciones base (lee primero)
- src/channels/types.ts
- src/channels/channel-adapter.ts
- src/channels/message-batcher.ts
- src/channels/typing-delay.ts

### Fase 2: WhatsApp
- Lee todos los archivos .ts en src/modules/whatsapp/
- Lee archivos en src/channels/whatsapp/ (si existe)

### Fase 3: Gmail
- Lee todos los archivos .ts en src/modules/gmail/

### Fase 4: Google Chat
- Lee todos los archivos .ts en src/modules/google-chat/

### Fase 5: Twilio Voice
- Lee todos los archivos .ts en src/modules/twilio-voice/

### Fase 6: TTS
- Lee todos los archivos .ts en src/modules/tts/

### Fase 7: Docs de referencia (secciones relevantes)
- docs/architecture/channel-guide.md
- docs/architecture/voice-channel-guide.md

## Qué auditar por cada canal:

### General (aplica a todos)
- ¿Implementa correctamente la interfaz base de channel-adapter?
- ¿Manifiesto completo: type, depends, configSchema, hooks?
- ¿Maneja reconexión/retry ante caídas del proveedor?
- ¿Normalización de mensajes entrantes es correcta y completa?
- ¿Manejo de rate limits del proveedor?
- ¿Mensajes salientes: encoding, truncamiento, splitting?
- ¿Logging adecuado para debugging?
- ¿Usa registry.getConfig() y NO process.env?
- ¿Obtiene nombre del agente de prompts:service.getAgentName()?

### WhatsApp específico
- ¿Baileys session management es estable?
- ¿Manejo de QR code refresh?
- ¿Grupos vs mensajes directos?
- ¿Media handling (imágenes, audio, docs)?
- ¿Manejo de desconexión y reconnect de WebSocket?
- ¿Qué pasa si Baileys crashea?

### Gmail específico
- ¿OAuth2 token refresh es correcto?
- ¿Manejo de threads/conversaciones?
- ¿Attachments?
- ¿Rate limits de Gmail API (250 quota units)?
- ¿Polling vs push notifications?
- ¿HTML sanitization en emails entrantes?

### Google Chat específico
- ¿Webhook validation es segura?
- ¿Service Account auth es correcta?
- ¿Spaces/rooms vs DMs?
- ¿Card/rich message formatting?

### Twilio Voice específico
- ¿WebSocket streaming es estable?
- ¿Gemini Live integration: latencia, buffering?
- ¿Call state machine es correcta?
- ¿Timeout de llamadas?
- ¿Manejo de DTMF?
- ¿Grabación/transcripción?
- ¿Twilio webhook signature validation?

### TTS específico
- ¿Google Cloud TTS configuración?
- ¿Audio format (OGG_OPUS)?
- ¿Caching de audio generado?
- ¿Manejo de textos largos?
- ¿Fallback si TTS falla?

### Cross-channel
- ¿Contact unification funciona correctamente entre canales?
- ¿Un mensaje del mismo contacto por 2 canales simultáneos genera race condition?
- ¿Los canales instant vs async se comportan correctamente según su tipo?

## Formato del informe

Genera el archivo: docs/reports/audit/03-canales.md

```markdown
# Auditoría: Canales de Comunicación
Fecha: [fecha de ejecución]
Auditor: Claude (sesión automatizada)

## Resumen ejecutivo
(3-5 líneas del estado general)

## Inventario
| Canal | Archivos | LOC | channelType | Estado |
|-------|----------|-----|-------------|--------|

## Abstracciones base
### Fortalezas
### Problemas encontrados
### Madurez: X/5

## WhatsApp (Baileys)
### Fortalezas
### Problemas encontrados
(cada uno con: severidad [CRÍTICO/ALTO/MEDIO/BAJO], descripción, archivo:línea, impacto, recomendación)
### Madurez: X/5

## Gmail
### Fortalezas
### Problemas encontrados
### Madurez: X/5

## Google Chat
### Fortalezas
### Problemas encontrados
### Madurez: X/5

## Twilio Voice
### Fortalezas
### Problemas encontrados
### Madurez: X/5

## TTS
### Fortalezas
### Problemas encontrados
### Madurez: X/5

## Análisis cross-channel
### Contact unification
### Concurrencia entre canales
### Consistencia de normalización

## Bugs encontrados
| # | Severidad | Canal | Archivo:Línea | Descripción | Impacto |
|---|-----------|-------|---------------|-------------|---------|

## Riesgos de seguridad
| # | Severidad | Canal | Descripción | Vector de ataque | Mitigación |
|---|-----------|-------|-------------|-------------------|------------|

## Deuda técnica
| # | Prioridad | Canal | Descripción | Esfuerzo estimado |
|---|-----------|-------|-------------|-------------------|

## Comparación channel-guide.md vs implementación real
| Requisito del guide | WhatsApp | Gmail | Google Chat | Twilio | TTS |
|---------------------|----------|-------|-------------|--------|-----|
| (cada requisito)    | ✅/❌    | ✅/❌ | ✅/❌       | ✅/❌  | ✅/❌|

## Madurez general canales: X/5

## Top 10 recomendaciones (ordenadas por impacto)
1. ...
```

IMPORTANTE: Lee CADA archivo completo de CADA canal (en bloques si es necesario). Compara lo que dice channel-guide.md con lo que realmente implementa cada canal.
