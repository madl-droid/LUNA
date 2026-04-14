#!/bin/bash
# Setup para sesiones AUDITOR
# Clona el repo, instala deps, se prepara para revisar PRs

set -e

echo "=== AUDITOR SETUP ==="

if [ ! -d "luna-platform" ]; then
  git clone https://github.com/madl-droid/luna.git luna-platform
fi

cd luna-platform
npm install

echo ""
echo "=== LISTO ==="
echo "Tu rol: AUDITOR"
echo "Lee: docs/plans/pinza-evolution/roles/auditor.md"
echo ""
echo "Para revisar un PR:"
echo "  1. git fetch origin feat/sNN-nombre"
echo "  2. git checkout feat/sNN-nombre"
echo "  3. npx tsc --noEmit"
echo "  4. npm test"
echo "  5. Revisar cambios: git diff main..HEAD"
echo "  6. Escribir tests adversarios"
echo "  7. Aprobar o rechazar en GitHub"
