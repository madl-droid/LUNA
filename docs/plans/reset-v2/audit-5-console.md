# Audit Plan — Instance 5: Console Updates

**Branch**: `reset/instance-5-console`
**LLM**: `sonnet`

## Pre-Audit: Read These First
- /docker/luna-repo/docs/plans/reset-v2/instance-5-console.md (the plan)
- /docker/luna-repo/docs/plans/reset-v2/reuse-inventory.md
- ALL modified files from Instance 5

## Audit Checklist

### 1. Compilation
```bash
npx tsc --noEmit
```
ZERO errors.

### 2. Reuse Compliance
- [ ] All new settings stored via `configStore.set()` / `configStore.setMultiple()` — NOT custom storage
- [ ] All settings read via `configStore.get()` / `configStore.getAll()` — NOT direct DB queries
- [ ] Console fields use existing field types (text, number, boolean, select, textarea, model-select, volume, tags, etc.) — NOT custom field types
- [ ] Sidebar items follow existing patterns (group, order, icon)
- [ ] Page rendering follows existing SSR pattern
- [ ] i18n uses existing ES/EN label objects — NOT new translation system
- [ ] Hot-reload uses existing `console:config_applied` hook — NOT custom mechanism
- [ ] NO new CSS files created
- [ ] NO new npm packages
- [ ] NO new API route patterns (use existing /console/api/ structure)

### 3. Engine Advanced Page (/console/agente/advanced)
- [ ] ENGINE_MODE select field with 'agentic' and 'legacy' options
- [ ] ENGINE_AGENTIC_MAX_TURNS number field with min/max
- [ ] ENGINE_EFFORT_ROUTING boolean toggle
- [ ] ENGINE_TOOL_DEDUP boolean toggle
- [ ] ENGINE_LOOP_DETECTION boolean toggle
- [ ] ENGINE_ERROR_AS_CONTEXT boolean toggle
- [ ] ENGINE_PARTIAL_RECOVERY boolean toggle
- [ ] LLM_LOW_EFFORT_MODEL model-select field
- [ ] LLM_MEDIUM_EFFORT_MODEL model-select field
- [ ] LLM_HIGH_EFFORT_MODEL model-select field
- [ ] All fields have ES and EN labels
- [ ] All fields have info/description text
- [ ] Fields are organized in logical sections with dividers

### 4. Subagents Page (/console/agente/subagents)
- [ ] Fresh context toggle or info displayed
- [ ] Existing subagent configuration not broken

### 5. Identity Page (/console/agente/identity)
- [ ] AGENT_ACCENT select field with regional options
- [ ] AGENT_ACCENT_PROMPT textarea (conditional on accent selection)
- [ ] Existing identity fields (name, last name, title, company, language, country) still present and working
- [ ] Accent field changes trigger config_applied hook

### 6. Skills Section
- [ ] Skills are visible somewhere in the console
- [ ] Skill names and descriptions displayed
- [ ] Enable/disable per skill if implemented
- [ ] User type filtering if implemented

### 7. Tools Page (/console/herramientas/tools)
- [ ] shortDescription field visible per tool
- [ ] detailedGuidance field visible per tool (textarea)
- [ ] Existing tool fields (enabled, maxRetries, access rules) still work
- [ ] Changes save correctly to tool registry

### 8. Proactive Settings
- [ ] Smart cooldown toggle and timing fields
- [ ] Orphan recovery toggle and settings
- [ ] Conversation guard toggle
- [ ] All settings save to config_store or proactive.json

### 9. Hot-Reload Verification
For each new setting, verify:
- [ ] Changing ENGINE_MODE triggers config_applied and engine reloads
- [ ] Changing effort models triggers config_applied
- [ ] Changing accent triggers config_applied and prompt cache clears
- [ ] No restart required for any new setting

### 10. UI Quality
- [ ] No layout breaks (fields properly spaced, sections aligned)
- [ ] Field widths appropriate (third, half, full)
- [ ] Select options are meaningful (not technical jargon)
- [ ] Info text is helpful for non-technical users
- [ ] Labels are consistent (all in same language pattern)

### 11. Backwards Compatibility
- [ ] Existing console pages still render correctly
- [ ] Existing settings still load and save
- [ ] Existing API routes still respond
- [ ] Existing sidebar items unchanged
- [ ] No JavaScript errors in browser console (if testable)

## Fix Protocol
1. Compilation errors first
2. Missing fields second
3. Reuse violations third
4. UI layout issues fourth
5. Commit: `audit(instance-5): fix [description]`
