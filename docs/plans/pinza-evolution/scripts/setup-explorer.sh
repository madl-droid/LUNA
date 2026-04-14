#!/bin/bash
# Setup para sesiones EXPLORER
# Clona los 3 repos fuente en modo read-only

set -e

echo "=== EXPLORER SETUP ==="

# Repo principal (donde se guardan los analisis)
if [ ! -d "luna-platform" ]; then
  git clone https://github.com/madl-droid/luna.git luna-platform
fi

# Repos fuente (solo lectura)
if [ ! -d "pinza-source" ]; then
  git clone https://github.com/madl-droid/Pinza-Colombiana.git pinza-source
fi

if [ ! -d "openclaw-source" ]; then
  git clone https://github.com/nicepkg/openclaw.git openclaw-source
fi

echo ""
echo "=== REPOS LISTOS ==="
echo "  luna-platform/     — repo principal (push analisis aqui)"
echo "  pinza-source/      — Pinza-Colombiana (solo lectura)"
echo "  openclaw-source/   — OpenClaw (solo lectura)"
echo ""
echo "Tu rol: EXPLORER"
echo "Lee: docs/plans/pinza-evolution/roles/explorer.md"
echo "Output: docs/analysis/ en luna-platform/"
