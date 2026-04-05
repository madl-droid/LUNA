-- Migration 034: Add exclusive_tools to subagent_types
-- Tools listed in exclusive_tools are REMOVED from the main agent when this subagent is enabled.
-- This replaces the hardcoded web_explore removal in filterAgenticTools().

ALTER TABLE subagent_types
  ADD COLUMN IF NOT EXISTS exclusive_tools TEXT[] NOT NULL DEFAULT '{}';

-- Migrate web-researcher: make web_explore exclusive (was hardcoded in engine)
UPDATE subagent_types
  SET exclusive_tools = '{web_explore}'
  WHERE slug = 'web-researcher' AND exclusive_tools = '{}';
