#!/bin/bash
# Setup para sesiones EXECUTOR
# Clona el repo principal e instala dependencias

set -e

SESSION_NUM=${1:-"??"}

echo "=== EXECUTOR SETUP (Session $SESSION_NUM) ==="

# Repo principal
if [ ! -d "luna-platform" ]; then
  git clone https://github.com/madl-droid/luna.git luna-platform
fi

cd luna-platform

# Instalar dependencias
npm install

# Verificar que compila
echo "Verificando compilacion base..."
npx tsc --noEmit && echo "OK: Compila limpio" || echo "ERROR: No compila — resolver antes de empezar"

# Verificar tests
echo "Corriendo tests base..."
npm test && echo "OK: Tests pasan" || echo "WARN: Tests fallando — revisar antes de empezar"

echo ""
echo "=== LISTO ==="
echo "Tu rol: EXECUTOR"
echo "Lee tu plan: docs/plans/sessions/session-${SESSION_NUM}.md"
echo "Branch: feat/s${SESSION_NUM}-{nombre}"
echo ""
echo "Workflow:"
echo "  1. Leer plan completo"
echo "  2. git checkout -b feat/s${SESSION_NUM}-{nombre}"
echo "  3. Implementar pasos"
echo "  4. npx tsc --noEmit (despues de cada paso)"
echo "  5. npm test (al final)"
echo "  6. git push -u origin feat/s${SESSION_NUM}-{nombre}"
