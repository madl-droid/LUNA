-- Migration 049: Seed comparativo-researcher subagent type
-- Subagente que investiga datos de competidores para llenar plantillas de comparativos.
-- Se habilita/deshabilita dinámicamente según el módulo templates esté activo.

INSERT INTO subagent_types (
  slug, name, description, enabled, model_tier, token_budget,
  verify_result, can_spawn_children, is_system, google_search_grounding,
  allowed_tools, exclusive_tools, system_prompt
) VALUES (
  'comparativo-researcher',
  'Investigador de Comparativos',
  'Subagente que investiga información de competidores para llenar plantillas de documentos comparativos. Analiza URLs, PDFs y datos proporcionados, puede delegar búsqueda web al sub-agente de búsqueda.',
  false,
  'complex',
  100000,
  true,
  true,
  true,
  false,
  '{}',
  '{}',
  E''
) ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  model_tier = EXCLUDED.model_tier,
  token_budget = EXCLUDED.token_budget,
  verify_result = EXCLUDED.verify_result,
  can_spawn_children = EXCLUDED.can_spawn_children,
  is_system = EXCLUDED.is_system,
  system_prompt = EXCLUDED.system_prompt,
  updated_at = now();
