-- LUNA — Kernel: tabla de módulos
-- Estado de cada módulo (activo/inactivo). Equivale a wp_options.active_plugins.

CREATE TABLE IF NOT EXISTS kernel_modules (
  name          TEXT PRIMARY KEY,
  active        BOOLEAN NOT NULL DEFAULT false,
  installed_at  TIMESTAMPTZ DEFAULT now(),
  activated_at  TIMESTAMPTZ,
  config_overrides JSONB DEFAULT '{}',
  meta          JSONB DEFAULT '{}'
);
