# Auditoría: Build, Tests & Calidad de Código (REQUIERE SERVER)

Eres un auditor de calidad de código. Tu tarea es ejecutar todas las herramientas de verificación estática y tests del proyecto LUNA, y reportar el estado real. NO hagas cambios en el código, solo ejecuta y reporta.

## REGLA DE EJECUCIÓN

IMPORTANTE: Algunos comandos pueden ser lentos o generar mucho output.
- Ejecuta cada comando por separado
- Si un comando genera output muy largo, captura a archivo y luego lee las partes relevantes
- Si un comando falla, documenta el error exacto y continúa
- No modifiques nada — solo observa y reporta

### Fase 1: TypeScript Build
Ejecuta:
```bash
cd /home/user/LUNA
# Compilar TypeScript
npm run build 2>&1 | tee /tmp/luna-build-output.txt
# Contar errores
grep -c "error TS" /tmp/luna-build-output.txt 2>/dev/null || echo "0 errors"
# Listar todos los errores únicos
grep "error TS" /tmp/luna-build-output.txt 2>/dev/null | sort | uniq -c | sort -rn
```

Luego lee tsconfig.json para verificar configuración:
```bash
cat /home/user/LUNA/tsconfig.json
```

### Fase 2: ESLint
Ejecuta:
```bash
cd /home/user/LUNA
npm run lint 2>&1 | tee /tmp/luna-lint-output.txt
# Contar
grep -c "error" /tmp/luna-lint-output.txt 2>/dev/null
grep -c "warning" /tmp/luna-lint-output.txt 2>/dev/null
# Top reglas violadas
grep -oP '\S+$' /tmp/luna-lint-output.txt 2>/dev/null | sort | uniq -c | sort -rn | head -20
```

Lee la configuración de ESLint:
```bash
cat /home/user/LUNA/eslint.config.js 2>/dev/null || cat /home/user/LUNA/.eslintrc* 2>/dev/null
```

### Fase 3: Tests
Ejecuta:
```bash
cd /home/user/LUNA
npm test 2>&1 | tee /tmp/luna-test-output.txt
```

Lee vitest.config.ts:
```bash
cat /home/user/LUNA/vitest.config.ts
```

### Fase 4: Dependency Audit
Ejecuta:
```bash
cd /home/user/LUNA
npm audit 2>&1 | tee /tmp/luna-audit-output.txt
```

### Fase 5: Outdated Packages
Ejecuta:
```bash
cd /home/user/LUNA
npm outdated 2>&1 | tee /tmp/luna-outdated-output.txt
```

### Fase 6: Package Analysis
Lee package.json completo:
```bash
cat /home/user/LUNA/package.json
```

Verifica lock file:
```bash
ls -la /home/user/LUNA/package-lock.json 2>/dev/null
```

Busca dependencias posiblemente no usadas (comparar imports vs package.json):
```bash
# Para cada dependencia en package.json, buscar si se importa
cd /home/user/LUNA
for dep in $(node -e "const p=require('./package.json'); Object.keys(p.dependencies||{}).forEach(d=>console.log(d))"); do
  count=$(grep -r "from ['\"]$dep" src/ 2>/dev/null | wc -l)
  if [ "$count" -eq "0" ]; then
    count2=$(grep -r "require(['\"]$dep" src/ 2>/dev/null | wc -l)
    if [ "$count2" -eq "0" ]; then
      echo "UNUSED? $dep (0 imports found)"
    fi
  fi
done
```

### Fase 7: Cobertura de tests
Analiza qué tiene tests y qué no:
```bash
# Archivos con tests
find /home/user/LUNA/tests -name "*.test.ts" 2>/dev/null
# Total archivos de código
find /home/user/LUNA/src -name "*.ts" | wc -l
# Módulos sin tests
for dir in /home/user/LUNA/src/modules/*/; do
  mod=$(basename "$dir")
  tests=$(find /home/user/LUNA/tests -name "*${mod}*" 2>/dev/null | wc -l)
  echo "$mod: $tests test files"
done
```

### Fase 8: Verificar scripts de package.json
```bash
cd /home/user/LUNA
# ¿El script dev funciona? (solo verificar que no crashea inmediatamente)
timeout 10 npm run dev 2>&1 | head -20 || echo "dev script check done"
# ¿migrate necesita DB?
npm run migrate 2>&1 | head -10 || echo "migrate needs running DB"
```

### Fase 9: Estructura del proyecto
```bash
# Archivos huérfanos potenciales (no importados)
cd /home/user/LUNA/src
# Buscar imports circulares (básico)
grep -rn "from '\.\." --include="*.ts" | grep -v node_modules | head -50
# Archivos vacíos
find /home/user/LUNA/src -name "*.ts" -empty 2>/dev/null
# Archivos .js que deberían ser .ts
find /home/user/LUNA/src -name "*.js" 2>/dev/null
```

## Formato del informe

Genera el archivo: docs/reports/audit/S2-build-tests.md

```markdown
# Auditoría: Build, Tests & Calidad de Código
Fecha: [fecha de ejecución]
Auditor: Claude (sesión en server)

## Resumen ejecutivo
(estado general en 3-5 líneas)

## TypeScript Build
- Estado: ✅ PASS / ❌ FAIL
- Errores de tipo: N
- Warnings: N
### tsconfig.json config
| Setting | Valor | Adecuado |
|---------|-------|----------|
| strict | ... | ✅/❌ |
| noUncheckedIndexedAccess | ... | ✅/❌ |
| (otros relevantes) | ... | ... |
### Errores de compilación (si hay)
| # | Archivo:Línea | Error Code | Descripción |
|---|---------------|------------|-------------|

## ESLint
- Estado: ✅ PASS / ❌ FAIL
- Errores: N
- Warnings: N
### Configuración
| Regla clave | Estado | Adecuada |
### Top reglas violadas
| Regla | Count | Severidad | Ejemplo |
|-------|-------|-----------|---------|

## Tests
- Estado: ✅ ALL PASS / ❌ FAILURES
- Suites: N
- Tests: N passed / N failed / N skipped
- Duración: Ns
### Tests existentes
| Suite | Tests | Estado | Duración |
|-------|-------|--------|----------|
### Tests fallidos (si hay)
| Test | Error | Archivo |
|------|-------|---------|

## Dependency Security (npm audit)
- Vulnerabilidades: N critical / N high / N moderate / N low
### Detalle
| Package | Severity | Advisory | Fix available |
|---------|----------|----------|---------------|

## Outdated Packages
| Package | Current | Wanted | Latest | Type |
|---------|---------|--------|--------|------|

## Package Analysis
### Dependencias posiblemente no usadas
| Package | Importada en | Veredicto |
### ¿devDependencies correctas?
### Lock file: ✅/❌

## Cobertura de tests por módulo
| Componente | Archivos .ts | Test files | Cobertura estimada | Criticidad |
|------------|-------------|------------|-------------------|------------|
| kernel | N | 0 | 0% | ALTA |
| engine | N | 0 | 0% | ALTA |
| modules/llm | N | 0 | 0% | ALTA |
| modules/memory | N | 0 | 0% | ALTA |
| modules/whatsapp | N | 0 | 0% | MEDIA |
| (... todos ...) | ... | ... | ... | ... |
| tools/freight | N | 4 | ~X% | BAJA |
### Módulos más críticos sin tests

## Scripts de package.json
| Script | Funciona | Output |
|--------|----------|--------|
| build | ✅/❌ | ... |
| lint | ✅/❌ | ... |
| test | ✅/❌ | ... |
| dev | ✅/❌ | ... |
| migrate | ✅/❌ | ... |

## Estructura del proyecto
### Archivos vacíos encontrados
### Archivos .js en src/ (deberían ser .ts)
### Posibles imports circulares

## Deuda técnica
| # | Prioridad | Descripción | Esfuerzo estimado |
|---|-----------|-------------|-------------------|

## Score de calidad: X/5
(justificación)

## Top 10 acciones prioritarias
1. ...
```

IMPORTANTE: Ejecuta TODOS los comandos. No asumas que algo funciona — verifícalo. Si un comando falla, documenta el error exacto. Captura output real, no estimaciones.
