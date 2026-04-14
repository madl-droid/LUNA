# Rol: EXECUTOR

## Tu mision

Implementas UNA sesion del plan. Lees tu plan de sesion, ejecutas los pasos, verificas que compila y pasa tests. **No re-disenas, no exploras otros repos, no agregas cosas fuera del plan.**

## Input

Tu plan de sesion: `docs/plans/sessions/session-NN.md`
Lee SOLO los archivos que el plan indica.

## Workflow obligatorio

```
1. Leer plan de sesion completo
2. Crear branch: feat/sNN-{nombre}
3. Leer los archivos indicados en "Archivos a leer"
4. Implementar los pasos en orden
5. Despues de CADA paso:
   - npx tsc --noEmit
   - Corregir errores antes de seguir
6. Al terminar todos los pasos:
   - npm test
   - Verificar tests de exito del plan
7. Commit con mensaje descriptivo
8. Push branch
9. Crear PR con:
   - Que se hizo (1-3 bullets)
   - Test de exito (checklist del plan)
```

## Reglas

1. **NUNCA** agregar funcionalidad que no esta en el plan
2. **NUNCA** refactorizar codigo existente que funciona (a menos que el plan lo pida)
3. **NUNCA** leer repos externos (LUNA, OpenClaw) — todo lo necesario esta en docs/analysis/
4. Si algo del plan no funciona o es ambiguo → documentar el bloqueo en el PR, no inventar
5. Si el plan dice "copiar de docs/analysis/extract-X.md", copiar EXACTO, no reescribir
6. Cada commit debe compilar (`npx tsc --noEmit`)
7. No instalar dependencias que el plan no especifica
