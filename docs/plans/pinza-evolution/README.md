# Pinza Evolution — Multi-Agent Workflow

## Concepto

Evolucionar Pinza-Colombiana de agente OneScreen-specific a plataforma multi-sector.
Usando sesiones de Claude Code como agentes especializados coordinados via git.

## Regla de oro

**Nunca estar a mas de 1 sesion de distancia de un sistema que funciona.**

Cada sesion produce un cambio que compila, pasa tests, y el agente sigue respondiendo.

## Repos fuente

- **Pinza-Colombiana**: Base de codigo funcional (29K LOC). Se migra pieza por pieza.
- **LUNA**: Modulos a portar (output-sanitizer, email-triage, effort-router, knowledge, hitl, lead-scoring, cortex/reflex).
- **OpenClaw**: Patrones a adoptar (Standing Orders, SOUL.md, Dream system, Active Memory).

## Agentes (roles de sesion)

| Rol | Que hace | Que NO hace |
|-----|----------|-------------|
| Explorer | Lee los 3 repos, produce analisis en docs/ | No modifica codigo |
| Planner | Lee analisis, produce planes de sesion atomicos | No escribe codigo |
| Executor | Implementa UNA sesion del plan | No lee otros repos, no re-diseña |
| Auditor | Revisa PRs, escribe tests adversarios, busca bugs | No implementa features |

## Flujo

1. Explorer analiza → push a `docs/analysis/`
2. Planner lee analisis → push a `docs/plans/sessions/`
3. Executor lee UN plan → implementa en `feat/sNN-nombre` → crea PR
4. Auditor revisa PR → aprueba o rechaza
5. User merge a main

## Archivos clave

- `roles/explorer.md` — Instrucciones para sesiones Explorer
- `roles/planner.md` — Instrucciones para sesiones Planner
- `roles/executor.md` — Instrucciones para sesiones Executor
- `roles/auditor.md` — Instrucciones para sesiones Auditor
- `scripts/setup-executor.sh` — Script de setup para entorno de ejecucion
