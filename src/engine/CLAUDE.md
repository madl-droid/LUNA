# Engine — Pipeline de procesamiento

Pipeline de procesamiento de mensajes entrantes. Actualmente stub, destinado a crecer con el pipeline completo.

## Archivos
- `responder.ts` — stub temporal: recibe mensaje WhatsApp → envía a Claude → retorna respuesta

## Estado actual
**Temporal.** responder.ts es un proof-of-concept que:
- Escucha mensajes de WhatsApp via hook `message:incoming`
- Envía a Anthropic Claude (hardcodeado)
- Retorna respuesta al usuario via hook `message:send`
- Usa ALLOWED_NUMBERS hardcodeado (no DB-driven)
- NO está completamente integrado con el sistema de hooks del kernel

## Pipeline futuro (5 pasos)
Cuando se implemente completamente, usará hooks del kernel para cada paso:
1. Preprocess → `message:incoming` hook
2. Classify → `message:classified` hook
3. Execute Tools → tools via registry services
4. Respond → `llm:chat` hook (filter)
5. Postprocess → `message:send` hook

Ver `docs/architecture/pipeline.md` para detalle completo y tabla de modelos.

## Trampas
- responder.ts NO es el diseño final — no agregar lógica compleja aquí
- ALLOWED_NUMBERS se eliminará cuando haya sistema de contactos en DB
- El circuit breaker y fallback chain deben implementarse como módulos LLM provider, no en el engine
