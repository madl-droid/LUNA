# Lead Status — Máquina de estados

## qualification_status — valores y transiciones

```
unknown → new → qualifying → qualified → scheduled → attended → converted
                    │
                    ├→ out_of_zone
                    ├→ not_interested
                    └→ cold (3 follow-ups sin respuesta)
scheduled → cold (no asiste, no responde)
ANY → blocked (lead pide no ser contactado)
```

## Triggers (código en postprocessor, NO en LLM)

| Transición | Trigger |
|-----------|---------|
| unknown → new | Primer mensaje recibido |
| new → qualifying | Agente inicia preguntas de calificación |
| qualifying → qualified | Cumple TODOS los criterios de qualifying.json |
| qualifying → out_of_zone | Ubicación fuera de cobertura |
| qualifying → not_interested | Lead dice que no le interesa |
| qualifying → cold | 3 follow-ups sin respuesta |
| qualified → scheduled | Cita/demo agendada exitosamente |
| scheduled → attended | Confirmación de asistencia (manual o callback) |
| scheduled → cold | No asiste y no responde |
| attended → converted | Cierre de venta (manual) |
| ANY → blocked | /stop, "no me escriban", "dejen de molestar" |

## contact_type (campo APARTE, no confundir con qualification_status)

Valores: `unknown` | `lead` | `client_active` | `client_former` | `team_internal` | `provider` | `blocked`
