#!/usr/bin/env node
/**
 * Run every skill-nesting test in one pass and exit non-zero on any failure.
 *
 * Usage: node test/all.mjs
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const suites = [
  { name: 'provider (discovery, dedupe, policy, config)', file: 'run.js' },
  { name: 'watcher (invalidation, re-watch)', file: 'watch.mjs' },
  { name: 'settings card (render, diff, write)', file: 'client.mjs' },
  { name: 'settings namespace (real provider)', file: 'namespace-check.mjs' },
]

let failed = 0
for (const suite of suites) {
  console.log(`\n=== ${suite.name} ===`)
  const result = spawnSync(process.execPath, [join(here, suite.file)], { stdio: 'inherit' })
  if (result.status !== 0) failed += 1
}

console.log(`\n${failed === 0 ? 'ALL SUITES PASSED' : `${failed} suite(s) FAILED`}`)
process.exit(failed === 0 ? 0 : 1)