# LUNA

## Qué es LUNA

LUNA es un agente de IA que atiende leads 24/7. Recibe mensajes de potenciales clientes por cualquier canal (WhatsApp, email, redes, llamadas telefónicas), los atiende, califica, agenda reuniones y hace seguimiento automático.

LUNA es un repo replicable. Cada empresa que lo usa tiene su propia instancia corriendo en su propio server con su propia configuración. No es multi-tenant — es un producto que se clona y se configura. Piensa en ello como un framework: el código es el mismo, lo que cambia es la carpeta `instance/` que define quién es el agente, qué sabe, qué tools tiene y cómo se comporta.

## Principios de diseño

### El LLM no tiene que hacerlo todo
Si algo se puede resolver con un regex, un lookup, una condición, o cualquier código determinístico, NO uses el LLM. El LLM solo entra cuando se necesita razonamiento o generación de lenguaje natural.

### La configuración manda, el código obedece
Desplegar LUNA en una empresa nueva = clonar el repo + llenar la carpeta `instance/`. Cero cambios en código. La identidad, el knowledge base, las reglas de calificación, los tools habilitados — todo vive en la config de la instancia.

### Los canales son intercambiables
WhatsApp, email, redes — no importa por dónde llegó el mensaje. Cada canal es un adapter que cumple una interfaz. Agregar un canal nuevo = un archivo nuevo, cero cambios en el engine.

### Los tools son plugins
El engine dice "necesito agendar" y el tool registry sabe que para esta instancia eso significa Google Calendar, Medilink, Calendly, o lo que sea. Cada tool tiene retry, fallback y circuit breaker. Si un tool falla, el agente no se muere — responde con un fallback y sigue.

### Un humano puede escribir por varios canales
La misma persona puede escribir por WhatsApp y después por email. LUNA la reconoce como la misma persona y mantiene un historial unificado.

## El engine: un loop, no una línea

El engine NO es un pipeline lineal de 5 pasos. Es un loop que decide, actúa, evalúa y repite hasta que puede dar una respuesta completa.

```
Mensaje entra
    ↓
[Preprocess] → identificar contacto, cargar contexto, detectar quick actions
    ↓
[Decide] → ¿qué necesito para responder? ←───────────┐
    ↓                                                  │
    ├─ Tengo todo → [Respond] → respuesta final        │
    ├─ Necesito datos → [Execute Tool] → resultado ────┘
    ├─ Necesito info del lead → [Ask] → esperar resp ──┘
    └─ Necesito un humano → [Escalate] → pausar sesión
    ↓
[Postprocess] → validar, formatear, enviar, guardar
```

Reglas del loop:
- Máximo N iteraciones (configurable). Si no resolvió, responde con lo que tiene o escala.
- Solo "Decide" y "Respond" usan LLM. Todo lo demás es código.
- Cuando el agente necesita info del lead (ej: "¿para qué fecha quieres agendar?"), responde con la pregunta y el loop continúa cuando llega el siguiente mensaje.
- Cuando escala a humano, la sesión se pausa. El humano responde y el loop se retoma.

## Canales soportados

- **WhatsApp** (Baileys, migración a Meta Cloud API planeada)
- **Email** (Gmail API con OAuth2)
- **Llamadas telefónicas** (Twilio Voice)

Todos cumplen la misma interfaz de adapter. El engine no los distingue.

## Stack

- Runtime: Node.js + TypeScript
- DB: PostgreSQL
- Queue/Cache: Redis + BullMQ
- LLM principal: Anthropic (Claude)
- Validación: Zod
- Logs: Pino

## Qué NO hacer

- No meter lógica de negocio específica de una instancia en el código del engine
- No usar el LLM para cosas que se resuelven con código
- No hardcodear credenciales, URLs de API, o nombres de modelos
- No acoplar el engine a un canal específico
- No acoplar el engine a un tool específico
- No crear abstracciones prematuras — si solo hay 1 implementación, no necesita interfaz
- No optimizar antes de que funcione
- No resolver edge cases del día 100 en el día 1
- No definir estructura de proyecto por adelantado — se construye orgánicamente

## Convenciones

- Archivos y carpetas en kebab-case
- Tipos e interfaces en PascalCase
- Funciones y variables en camelCase
- Un archivo = una responsabilidad
- Tests al lado del código que prueban (archivo.test.ts)
- Errores con mensajes claros que digan qué pasó Y qué hacer
- Logs estructurados JSON con pino, siempre con contexto (instanceId, contactId, sessionId)