#!/usr/bin/env node

/**
 * Version bump script for Luna.
 * Usage: npm run version:bump -- [major|minor|patch]
 * Example: npm run version:bump -- patch  -> 2.0.0 -> 2.0.1
 *
 * Every version bump REQUIRES user confirmation (see docs/plans/reset-v2/overview.md).
 * Format: MAJOR.MINOR.PATCH (semver)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgPath = resolve(__dirname, '..', 'package.json')

const bumpType = process.argv[2]
if (!bumpType || !['major', 'minor', 'patch'].includes(bumpType)) {
  console.error('Usage: npm run version:bump -- [major|minor|patch]')
  console.error('Example: npm run version:bump -- patch')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
const parts = pkg.version.split('.').map(Number)
const [major, minor, patch] = parts

let newVersion
switch (bumpType) {
  case 'major':
    newVersion = `${major + 1}.0.0`
    break
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`
    break
  case 'patch':
    newVersion = `${major}.${minor}.${patch + 1}`
    break
}

console.log(`Bumping version: ${pkg.version} -> ${newVersion} (${bumpType})`)
pkg.version = newVersion
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`Updated ${pkgPath}`)
