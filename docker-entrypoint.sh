#!/bin/sh
# LUNA — Docker entrypoint
# Copies bundled instance defaults into the mounted volume if missing.
# This ensures new instances get prompt templates, fallbacks, etc.
# without requiring manual file copying.

BUNDLED="/app/instance-defaults"
TARGET="/app/instance"

# Sync directories: copy missing files/dirs without overwriting existing ones
for dir in prompts fallbacks tools system knowledge; do
  if [ -d "$BUNDLED/$dir" ]; then
    # Create target dir if it doesn't exist
    mkdir -p "$TARGET/$dir"
    # Copy contents recursively, but never overwrite existing files (-n)
    cp -rn "$BUNDLED/$dir/." "$TARGET/$dir/" 2>/dev/null || true
  fi
done

exec node dist/index.js "$@"
