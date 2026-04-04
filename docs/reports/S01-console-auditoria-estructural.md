# AUDITORIA ESTRUCTURAL — `src/modules/console`

## Alcance
- Fecha: 2026-04-04
- Modulo auditado: `src/modules/console`
- Objetivo: evaluar la segunda pasada de simplificacion estructural del modulo `console`, enfocada en deuda legacy, ownership de settings, rutas residuales, archivos faltantes y complejidad de mantenimiento.

## Resumen ejecutivo
`console` mejoro de forma importante en la primera limpieza funcional, pero todavia conserva deuda estructural visible. El modulo ya no esta dominado por controles muertos, pero sigue teniendo:
- naming mixto entre `contacts` y `users`,
- ownership ambiguo de algunos settings activos,
- restos legacy en i18n y metadata,
- archivos demasiado grandes para su nivel de responsabilidad,
- y documentacion local incompleta.

La conclusion de esta auditoria es que la siguiente reduccion fuerte de complejidad ya no pasa por quitar toggles muertos, sino por:
1. consolidar ownership de settings,
2. cerrar la migracion `users -> contacts`,
3. partir `templates-sections.ts` y simplificar el router interno de `server.ts`,
4. y crear la documentacion operativa faltante del modulo.

## Hallazgos

### P1 — `PIPELINE_MAX_TOOL_CALLS_PER_TURN` sigue duplicado en dos superficies de UI
- Estado: activo
- Severidad: alta
- Evidencia:
  - `Agente > Avanzado`: [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L897)
  - `Herramientas > Tools`: [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L1431)
- Riesgo:
  el setting ya no esta muerto, pero hoy tiene dos dueños visuales distintos. Eso vuelve a introducir ambiguedad operativa: no esta claro si pertenece al agente o al sistema de tools.
- Recomendacion:
  elegir una sola superficie de edicion. Mi recomendacion es dejarlo en `Agente > Avanzado` y eliminarlo del panel global de `tools`.

### P1 — La migracion `users -> contacts` sigue incompleta
- Estado: compatibilidad viva
- Severidad: alta
- Evidencia:
  - redirects y compatibilidad: [server.ts](C:/Users/miged/Git/LUNA/src/modules/console/server.ts#L1298)
  - POSTs legacy aun vivos: [server.ts](C:/Users/miged/Git/LUNA/src/modules/console/server.ts#L1002), [server.ts](C:/Users/miged/Git/LUNA/src/modules/console/server.ts#L1026), [server.ts](C:/Users/miged/Git/LUNA/src/modules/console/server.ts#L1052), [server.ts](C:/Users/miged/Git/LUNA/src/modules/console/server.ts#L1191)
  - forms legacy en templates: [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L2992), [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L3133), [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L3465), [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L3492), [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L3546), [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L3930), [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L4201)
- Riesgo:
  el producto ya habla de `contacts`, pero el backend y los forms siguen cargando semantica `users`. Eso aumenta ruido cognitivo, dificulta onboarding y mantiene acoplamiento a contratos viejos.
- Recomendacion:
  segunda pasada dedicada a migrar acciones/formularios a `/console/contacts/*` o, si se quiere conservar compatibilidad, encapsular `/console/users/*` como adapter legacy explicito y documentado.

### P1 — Quedaron residuos legacy en metadata e i18n aunque la UI ya no los use
- Estado: residual
- Severidad: alta
- Evidencia:
  - `pipeline` sigue en `FIXED_IDS`: [templates.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates.ts#L63)
  - `ICONS.pipeline` sigue definido: [templates.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates.ts#L37)
  - claves `sec_pipeline_unified*` siguen en i18n: [templates-i18n.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-i18n.ts#L279), [templates-i18n.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-i18n.ts#L622)
  - comentarios legacy en router de secciones: [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L2804)
- Riesgo:
  no rompe runtime, pero mantiene la falsa impresion de que `pipeline` sigue siendo una pagina viva del producto.
- Recomendacion:
  hacer una pasada de “metadata purge” para sacar ids, iconos, labels y comentarios que ya no representan una pagina real.

### P2 — `SECTION_REDIRECTS` vacio sigue vivo en `templates-sections.ts`
- Estado: muerto
- Severidad: media
- Evidencia:
  [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L1363)
- Riesgo:
  es codigo residual puro. Ya no participa en el flujo real porque `server.ts` usa redirects explicitos.
- Recomendacion:
  eliminarlo en la siguiente pasada.

### P2 — Falta `src/modules/console/AGENTS.md`
- Estado: faltante
- Severidad: media
- Evidencia:
  [src/modules/console](C:/Users/miged/Git/LUNA/src/modules/console)
- Riesgo:
  el modulo mas denso del panel no tiene su guia operativa local, aunque el repo la exige por convencion. Eso perjudica consistencia entre sesiones y facilita que vuelvan residuos.
- Recomendacion:
  crear `src/modules/console/AGENTS.md` con:
  - mapa de rutas reales,
  - ownership de archivos,
  - reglas de naming (`contacts`, `agente`, `herramientas`),
  - deuda intencional (`/console/users/*` si sigue viva),
  - y criterio para ubicar settings nuevos.

### P2 — `templates-sections.ts` y `server.ts` siguen demasiado grandes
- Estado: estructural
- Severidad: media
- Evidencia:
  - [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts) ≈ 4058 lineas
  - [server.ts](C:/Users/miged/Git/LUNA/src/modules/console/server.ts) ≈ 2300 lineas
  - [templates.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates.ts) ≈ 727 lineas
- Riesgo:
  la complejidad ya no esta en un bug puntual sino en la forma del modulo:
  - muchas responsabilidades por archivo,
  - rutas, UI y compatibilidad mezcladas,
  - alto costo de cambio,
  - mayor probabilidad de duplicacion.
- Recomendacion:
  partir por dominio:
  - `templates-agente.ts`
  - `templates-contacts.ts`
  - `templates-herramientas.ts`
  - `templates-metrics.ts`
  - y en `server.ts`, extraer routers por seccion o por grupo funcional.

### P2 — El router de `console` sigue mezclando navegacion, compatibilidad y carga de contenido
- Estado: estructural
- Severidad: media
- Evidencia:
  - nested routes `contacts`: [server.ts](C:/Users/miged/Git/LUNA/src/modules/console/server.ts#L1227)
  - nested routes `agente`: [server.ts](C:/Users/miged/Git/LUNA/src/modules/console/server.ts#L1239)
  - nested routes `herramientas`: [server.ts](C:/Users/miged/Git/LUNA/src/modules/console/server.ts#L1269)
  - render por subpage: [server.ts](C:/Users/miged/Git/LUNA/src/modules/console/server.ts#L1442), [server.ts](C:/Users/miged/Git/LUNA/src/modules/console/server.ts#L1499)
- Riesgo:
  `server.ts` ya funciona como router, adapter de compatibilidad, orchestrator SSR y gateway de API. Eso complica auditar flujo real y hace mas dificil ubicar ownership.
- Recomendacion:
  separar:
  - normalizacion de URL,
  - redirects legacy,
  - resolucion de subpage,
  - render SSR,
  - y API routes.

### P3 — Quedan restos de narrativa legacy fuera del engine central
- Estado: menor
- Severidad: baja
- Evidencia:
  - comentario del save bar usando “Phase 1 / Phase 2”: [templates.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates.ts#L742)
  - comentario de persona preview ligado a “legacy response”: [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts#L1637)
- Riesgo:
  no afecta comportamiento, pero conserva ruido historico en comentarios y nombres.
- Recomendacion:
  limpiar comments internos cuando se haga la particion de archivos.

## Cosas que ya no veo como problema principal
- `LLM_CRITICIZER_MODE` duplicado: resuelto.
- `engine-metrics` huérfano de navegación: resuelto.
- UI agentic completamente muerta: mayormente resuelta.
- `pipeline` como pagina funcional: desactivada del flujo real, aunque todavia queda metadata legacy residual.

## Recomendacion de segunda pasada
Orden sugerido:

1. Crear [src/modules/console/AGENTS.md](C:/Users/miged/Git/LUNA/src/modules/console/AGENTS.md)
2. Resolver ownership unico de `PIPELINE_MAX_TOOL_CALLS_PER_TURN`
3. Migrar o encapsular definitivamente `/console/users/*`
4. Eliminar metadata residual de `pipeline`
5. Partir [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts)
6. Extraer subrouters de [server.ts](C:/Users/miged/Git/LUNA/src/modules/console/server.ts)

## Verificacion usada para esta auditoria
- lectura cruzada de:
  - [server.ts](C:/Users/miged/Git/LUNA/src/modules/console/server.ts)
  - [templates.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates.ts)
  - [templates-sections.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-sections.ts)
  - [templates-i18n.ts](C:/Users/miged/Git/LUNA/src/modules/console/templates-i18n.ts)
- revision de rutas legacy activas
- conteo de tamano de archivos
- busqueda de residuos `pipeline`, `users`, `engine-metrics` y claves legacy

## Conclusión
La primera pasada limpio incoherencias funcionales. La segunda pasada deberia atacar ya la forma del modulo. Hoy el principal costo de `console` no es un bug aislado, sino una arquitectura SSR demasiado concentrada, con naming mixto y ownership parcial de settings.

Si el objetivo es hacer el codigo mas liviano, mas maduro y mas unificado, el mejor siguiente corte no es seguir quitando toggles: es consolidar contratos (`contacts`), ownership de settings y dividir los archivos grandes del modulo.
