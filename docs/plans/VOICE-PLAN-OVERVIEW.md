# Plan Maestro: Mejora de Capacidades de Llamada Twilio Voice

## Contexto
Comparativo entre Valeria (prototipo anterior) y LUNA reveló gaps críticos en el manejo de llamadas de voz. Gemini 3.1 Flash Live Preview (marzo 2026) ofrece mejoras significativas de latencia y calidad nativa audio-to-audio.

## Fases

```
FASE 0: Migración Gemini 3.1          ← Base para todo lo demás
   │
   ├── FASE 1: Experiencia de llamada  ← Greeting gate, freeze, filler, tool cancel
   │      (depende de Fase 0)
   │
   ├── FASE 2: Silence detector        ← Post-greeting timeout, debounce, reset
   │      (depende de Fase 0 + Fase 1.greeting_gate)
   │
   ├── FASE 3: Outbound mejorado       ← Business hours, rate limit, call reason
   │      (independiente de Fases 1-2)
   │
   └── FASE 4: Memoria de llamadas     ← Integrar voice al pipeline de compresión
          (independiente de Fases 1-3)
```

## Dependencias entre fases

| Fase | Depende de | Puede ejecutarse en paralelo con |
|------|-----------|----------------------------------|
| 0    | nada      | nada (es prerequisito)           |
| 1    | Fase 0    | —                                |
| 2    | Fase 0 + `greetingDone` de Fase 1A | —                    |
| 3    | Fase 0    | Fases 1, 2, 4                   |
| 4    | Fase 0    | Fases 1, 2, 3                   |

## Ejecución recomendada

```
Secuencial obligatorio:  Fase 0 → Fase 1 → Fase 2
Paralelo tras Fase 0:   Fase 3 (independiente)
Paralelo tras Fase 0:   Fase 4 (independiente)
```

Es decir: después de completar Fase 0, se pueden lanzar 3 tracks en paralelo:
- **Track A**: Fase 1 → Fase 2 (secuencial entre sí)
- **Track B**: Fase 3 (independiente)
- **Track C**: Fase 4 (independiente)

## Archivos principales impactados

| Archivo | F0 | F1 | F2 | F3 | F4 |
|---------|----|----|----|----|-----|
| `gemini-live.ts` | X | X | | | |
| `types.ts` | X | X | | X | |
| `call-manager.ts` | | X | X | X | X |
| `silence-detector.ts` | | | X | | |
| `voice-engine.ts` | | | | X | X |
| `manifest.ts` | X | X | X | X | |
| `audio-converter.ts` | | | | | |
| `pg-store.ts` | | | | X | |
| `twilio-adapter.ts` | | | | X | |

## Modelo objetivo
- **Primario**: `gemini-3.1-flash-live-preview`
- **Fallback**: `gemini-2.5-flash-live-preview` (configurable)
- **Pricing**: $0.75/1M input, $4.50/1M output, $3.00/1M audio input
