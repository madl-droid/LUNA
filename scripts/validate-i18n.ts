#!/usr/bin/env tsx
/**
 * LUNA — i18n validation script
 * Compares keys used in templates (via t('key', lang)) against keys defined in i18n dictionaries.
 * Reports missing keys in either language and unused keys.
 *
 * Usage: npx tsx scripts/validate-i18n.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const OFICINA_DIR = path.resolve('src/modules/oficina')
const I18N_FILE = path.join(OFICINA_DIR, 'templates-i18n.ts')

// 1. Extract defined keys from i18n file
const i18nContent = fs.readFileSync(I18N_FILE, 'utf-8')

function extractKeys(langBlock: string): Set<string> {
  const keys = new Set<string>()
  // Strip string values to avoid matching words inside them
  // Replace 'value' and "value" with empty strings
  const stripped = langBlock.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
  // Now match word: patterns — these are only real keys
  const regex = /\b(\w+)\s*:/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(stripped)) !== null) {
    const key = match[1]!
    if (key.length < 2) continue
    keys.add(key)
  }
  return keys
}

// Split by 'es:' and 'en:' blocks
const esBlockMatch = i18nContent.match(/\bes:\s*\{([\s\S]*?)\n\s*\},/)
const enBlockMatch = i18nContent.match(/\ben:\s*\{([\s\S]*?)\n\s*\},/)

const esKeys = esBlockMatch ? extractKeys(esBlockMatch[1]!) : new Set<string>()
const enKeys = enBlockMatch ? extractKeys(enBlockMatch[1]!) : new Set<string>()

// 2. Extract used keys from template files
const TEMPLATE_FILES = [
  'templates.ts',
  'templates-sections.ts',
  'templates-fields.ts',
  'templates-modules.ts',
  'templates-i18n.ts',
].map(f => path.join(OFICINA_DIR, f))

const usedKeys = new Set<string>()

// Known dynamic key prefixes (constructed at runtime, not false positives)
const DYNAMIC_PREFIXES = ['waStatus_']

for (const file of TEMPLATE_FILES) {
  if (!fs.existsSync(file)) continue
  const content = fs.readFileSync(file, 'utf-8')
  // Match t('key', ...) and t("key", ...) — only static string literals
  const regex = /\bt\(\s*['"]([^'"]+)['"]\s*,/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const key = match[1]!
    // Skip dynamic patterns (e.g. 'waStatus_' used in t('waStatus_' + status))
    if (DYNAMIC_PREFIXES.some(p => key === p)) continue
    usedKeys.add(key)
  }
}

// 3. Report
let hasErrors = false

// Keys used in templates but missing from ES
const missingEs = [...usedKeys].filter(k => !esKeys.has(k)).sort()
if (missingEs.length > 0) {
  hasErrors = true
  console.error(`\n❌ ${missingEs.length} key(s) used in templates but MISSING from Spanish (es):`)
  for (const k of missingEs) console.error(`   - ${k}`)
}

// Keys used in templates but missing from EN
const missingEn = [...usedKeys].filter(k => !enKeys.has(k)).sort()
if (missingEn.length > 0) {
  hasErrors = true
  console.error(`\n❌ ${missingEn.length} key(s) used in templates but MISSING from English (en):`)
  for (const k of missingEn) console.error(`   - ${k}`)
}

// Keys in ES but not in EN (asymmetry)
const esOnly = [...esKeys].filter(k => !enKeys.has(k)).sort()
if (esOnly.length > 0) {
  hasErrors = true
  console.error(`\n⚠️  ${esOnly.length} key(s) in ES but not in EN:`)
  for (const k of esOnly) console.error(`   - ${k}`)
}

// Keys in EN but not in ES
const enOnly = [...enKeys].filter(k => !esKeys.has(k)).sort()
if (enOnly.length > 0) {
  hasErrors = true
  console.error(`\n⚠️  ${enOnly.length} key(s) in EN but not in ES:`)
  for (const k of enOnly) console.error(`   - ${k}`)
}

// Unused keys (defined but never used in templates)
const allDefined = new Set([...esKeys, ...enKeys])
const unused = [...allDefined].filter(k => !usedKeys.has(k)).sort()
if (unused.length > 0) {
  console.log(`\nℹ️  ${unused.length} key(s) defined but not used in templates (may be used in client JS):`)
  for (const k of unused) console.log(`   - ${k}`)
}

if (!hasErrors) {
  console.log('\n✅ i18n validation passed — all used keys are defined in both languages.')
} else {
  process.exit(1)
}
