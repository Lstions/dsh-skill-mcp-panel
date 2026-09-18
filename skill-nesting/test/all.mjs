#!/usr/bin/env node
/**
 * Run every skill-nesting test in one pass and exit non-zero on any failure.
 *
 * Usage: node test/all.mjs
 *
 * Two groups:
 *   - the developers' own suites (regression protection for shipped behaviour)
 *   - `tests/verify` — the independent adversarial acceptance suite, which
 *     boots the REAL Cordis context and the REAL skill registry rather than a
 *     hand-rolled fake. Its BLOCKED outcomes are reported separately: a blocked
 *     case means the feature has not landed, and must never read as a pass.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')

const suites = [
  { name: 'provider (discovery, dedupe, policy, config)', file: join(here, 'run.js') },
  { name: 'watcher (invalidation, re-watch)', file: join(here, 'watch.mjs') },
  { name: 'settings card (render, diff, write)', file: join(here, 'client.mjs') },
  // The management page. Renders the real bundle under a stub settings scope and
  // asserts the N3 requirement: the page must work with NO usable settings
  // scope, which is exactly what a non-loopback page gets.
  { name: 'management page (sections, N3, three-state, i18n)', file: join(here, 'ui-page.mjs') },
  { name: 'settings namespace (real provider)', file: join(here, 'namespace-check.mjs') },
  // Host-side suites (devA / devB). Each exits non-zero on any failed check, so
  // the aggregate below can trust `status !== 0` without reading their output.
  { name: 'host toggle (suppression strategy, verdicts)', file: join(here, 'host-toggle.mjs') },
  { name: 'host state (document assembly, conflicts, masking)', file: join(here, 'host-state.mjs') },
  { name: 'host http (origin gate, revision fence, routes)', file: join(here, 'host-http.mjs') },
  { name: 'host live (real instance: toggle, HTTP, files untouched)', file: join(here, 'host-live.mjs') },
  { name: 'mcp inventory (offline: masking, validation, status mapping)', file: join(here, 'mcp-inventory.mjs') },
  { name: 'mcp live (real Cordis tree + real stdio server)', file: join(here, 'mcp-live.mjs'), slow: true },
]

// Host suites that exist but are not assertion suites: probe scripts print
// evidence and always exit 0, so folding them into a gate would add runtime
// without adding protection. `realtree.mjs` is the same kind of script.
const reports = [{ name: 'real tree report', file: join(here, 'realtree.mjs') }]

// The independent suite lives outside the package so it cannot accidentally
// share a helper with the code it is judging.
const verifyRunner = join(repo, 'tests', 'verify', 'run.mjs')

let failed = 0
let blocked = 0
const failedNames = []
const blockedNames = []
const skippedNames = []

for (const suite of suites) {
  if (!existsSync(suite.file)) {
    // A suite that vanished must not be silently skipped: that is exactly how a
    // gate stops protecting anything without anyone noticing.
    console.log(`\n=== ${suite.name} ===\nMISSING: ${suite.file}`)
    failed += 1
    failedNames.push(`${suite.name} (file missing)`)
    continue
  }
  console.log(`\n=== ${suite.name} ===`)
  // Capture output as well as forwarding it, so a suite that prints SKIP and
  // exits 0 can be reported as NOT RUN rather than silently counted as green.
  // `namespace-check.mjs` does exactly that when it cannot resolve the settings
  // provider, and its "9/9 passed" then never executes — a vacuous pass that
  // looks identical to a real one in a summary line.
  const result = spawnSync(process.execPath, [suite.file], {
    stdio: ['inherit', 'pipe', 'inherit'],
    encoding: 'utf8',
  })
  const output = result.stdout ?? ''
  process.stdout.write(output)
  if (result.status !== 0) {
    failed += 1
    failedNames.push(suite.name)
    continue
  }
  if (/^\s*SKIP\b/m.test(output)) {
    skippedNames.push(suite.name)
  }
}

// Report-only scripts: their output is evidence for humans, not a gate.
for (const script of reports) {
  if (!existsSync(script.file)) continue
  console.log(`\n=== ${script.name} (report only, not a gate) ===`)
  spawnSync(process.execPath, [script.file], { stdio: 'inherit' })
}

if (existsSync(verifyRunner)) {
  console.log('\n=== independent acceptance suite (tests/verify) ===')
  // Run once as a human-readable gate, then once as JSON so the split between
  // "failed" and "blocked" is derived from a machine-readable field rather than
  // parsed out of prose.
  const result = spawnSync(process.execPath, [verifyRunner], { stdio: 'inherit' })
  const summary = spawnSync(process.execPath, [verifyRunner, '--json'], { encoding: 'utf8' })
  try {
    const parsed = JSON.parse(summary.stdout.slice(summary.stdout.indexOf('{')))
    blocked = parsed.blocked ?? 0
    for (const entry of parsed.results ?? []) {
      if (entry.status === 'FAIL') failedNames.push(`verify:${entry.name}`)
      if (entry.status === 'BLOCKED') blockedNames.push(`verify:${entry.name}`)
    }
    if (parsed.failed > 0) failed += parsed.failed
  } catch (error) {
    console.log(`could not read the verify summary as JSON: ${error.message}`)
    if (result.status !== 0) failed += 1
  }
} else {
  console.log(`\n=== independent acceptance suite ===\nMISSING: ${verifyRunner}`)
  failed += 1
  failedNames.push('tests/verify (runner missing)')
}

console.log('\n' + '='.repeat(72))
if (failed === 0 && blocked === 0 && skippedNames.length === 0) {
  console.log('ALL SUITES PASSED')
} else if (failed === 0 && blocked === 0) {
  console.log(`ALL SUITES PASSED, but ${skippedNames.length} suite(s) did NOT RUN (see SKIPPED below)`)
} else {
  const parts = []
  // `failed` counts suites; failedNames may hold several verify cases. Report
  // the number of distinct failing things, not a sum that double-counts.
  if (failed > 0) parts.push(`${failed} suite/case(s) FAILED`)
  if (blocked > 0) parts.push(`${blocked} verify case(s) BLOCKED (feature not landed — not a pass)`)
  console.log(parts.join('; '))
}
if (failedNames.length > 0) {
  console.log('FAILED:')
  for (const name of failedNames) console.log(`  - ${name}`)
}
if (blockedNames.length > 0) {
  console.log('BLOCKED:')
  for (const name of blockedNames) console.log(`  - ${name}`)
}
if (skippedNames.length > 0) {
  // Printed loudly and never folded into "passed": a suite that self-skips has
  // verified nothing, and a green summary that hides it is the single most
  // misleading outcome this file can produce.
  console.log('SKIPPED (these suites verified NOTHING — do not read them as green):')
  for (const name of skippedNames) console.log(`  - ${name}`)
}
console.log(
  `SUMMARY suites=${suites.length} failed=${failed} blocked=${blocked} skipped=${skippedNames.length}`,
)
// Non-zero whenever anything failed OR anything is blocked: a blocked case is
// an unverified requirement, and silence about it is the failure mode this
// whole suite exists to prevent. A skipped suite exits 0 (the skip is usually
// environmental, not a code defect) but is always named in the summary.
process.exit(failed === 0 ? 0 : 1)
