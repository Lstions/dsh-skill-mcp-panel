#!/usr/bin/env node
/**
 * Independent acceptance suite for dsh-skill-nesting.
 *
 *   node tests/verify/run.mjs              # all cases
 *   node tests/verify/run.mjs f31 n4       # named cases only
 *   node tests/verify/run.mjs --list       # names only
 *   node tests/verify/run.mjs --json       # machine-readable summary
 *
 * Exit code: 0 only when every case PASSED. BLOCKED cases (feature not landed)
 * exit non-zero on purpose — silence must never read as success. Pass
 * `--allow-blocked` to treat them as non-fatal while a feature is in flight.
 *
 * Three outcomes, never two:
 *   PASS    asserted against observed reality
 *   FAIL    asserted and contradicted
 *   BLOCKED feature not implemented yet — NOT evidence of anything
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCase, printCase, Blocked } from './lib/assert.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const casesDir = join(HERE, 'cases')

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const listMode = args.includes('--list')
const allowBlocked = args.includes('--allow-blocked')
const requested = args.filter((arg) => !arg.startsWith('--'))

const CASE_FILES = [
  'f31',
  'f3strategy',
  'f3competitor',
  'f3cache',
  'f33',
  'f44',
  'f63',
  'scale',
  'n4',
  'n4nested',
  'degrade',
  'perf',
  'mutation',
]

if (listMode) {
  for (const file of CASE_FILES) {
    const path = join(casesDir, `${file}.mjs`)
    if (!existsSync(path)) {
      console.log(`${file}\t(missing case file)`)
      continue
    }
    const meta = await readMeta(path)
    console.log(`${meta.id}\t${meta.requirement}\t${meta.title}`)
  }
  process.exit(0)
}

const selected = requested.length > 0 ? requested : CASE_FILES
const results = []

// An unawaited rejection inside a case must not kill the run: a suite that
// dies on case 3 never reports cases 4..N, and the missing output reads as
// "nothing failed" to anyone skimming the tail. Surface it as a FAIL instead.
const strayRejections = []
process.on('unhandledRejection', (reason) => {
  strayRejections.push(reason?.stack ?? String(reason))
})

for (const name of selected) {
  const path = join(casesDir, `${name}.mjs`)
  if (!existsSync(path)) {
    results.push({ name, status: 'FAIL', checks: [], notes: [], error: `case file not found: ${path}` })
    continue
  }
  let result
  try {
    const module = await import(path)
    if (typeof module.run !== 'function') {
      results.push({ name, status: 'FAIL', checks: [], notes: [], error: 'case exports no run()' })
      continue
    }
    result = await runCase(name, module.run)
    result.meta = module.meta
  } catch (error) {
    // Import-time failures (a syntax error, a missing dependency) are a FAIL of
    // the harness itself, reported loudly rather than skipped.
    result = { name, status: 'FAIL', checks: [], notes: [], error: `case crashed: ${error?.stack ?? String(error)}` }
  }
  results.push(result)
  if (!jsonMode) printCase(result)
}

// Any rejection that escaped a case is a defect in the case, not a pass.
if (strayRejections.length > 0) {
  results.push({
    name: '(unhandled rejections)',
    status: 'FAIL',
    checks: [],
    notes: [],
    error: strayRejections.join('\n---\n'),
  })
}

const passed = results.filter((r) => r.status === 'PASS')
const failed = results.filter((r) => r.status === 'FAIL')
const blocked = results.filter((r) => r.status === 'BLOCKED')

if (jsonMode) {
  console.log(JSON.stringify({ results, passed: passed.length, failed: failed.length, blocked: blocked.length }, null, 2))
} else {
  console.log('\n' + '='.repeat(72))
  console.log(`verify: ${passed.length} passed, ${failed.length} failed, ${blocked.length} blocked (of ${results.length})`)
  for (const result of failed) console.log(`  FAIL    ${result.name}`)
  for (const result of blocked) console.log(`  BLOCKED ${result.name} — ${result.blockedReason}`)
  const totalChecks = results.reduce((sum, r) => sum + r.checks.length, 0)
  const failedChecks = results.reduce((sum, r) => sum + r.checks.filter((c) => !c.ok).length, 0)
  console.log(`verify: ${totalChecks - failedChecks}/${totalChecks} individual assertions passed`)
}

const ok = failed.length === 0 && (allowBlocked || blocked.length === 0)
process.exit(ok ? 0 : 1)

async function readMeta(path) {
  try {
    const module = await import(path)
    return module.meta ?? { id: '?', requirement: '?', title: '?' }
  } catch (error) {
    return { id: '?', requirement: '?', title: `(unloadable: ${error.message.slice(0, 60)})` }
  }
}