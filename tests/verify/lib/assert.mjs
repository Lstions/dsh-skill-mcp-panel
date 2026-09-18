/**
 * Assertion + result collection for the independent suite.
 *
 * Three outcomes, never two:
 *   PASS    — asserted against observed reality
 *   FAIL    — asserted and contradicted
 *   BLOCKED — the feature under test has not landed, so there is nothing to
 *             verify. A blocked case is NOT evidence of anything.
 *
 * Every observation is recorded verbatim so acceptance.md can quote raw output
 * instead of a summary table.
 */
export class Blocked extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'Blocked'
  }
}

export function makeReport(caseName) {
  const checks = []
  const notes = []
  return {
    caseName,
    checks,
    notes,
    /** Record one assertion. `detail` is printed verbatim on failure. */
    check(label, actual, expected) {
      const ok = deepEqual(actual, expected)
      checks.push({ label, ok, actual, expected })
      return ok
    },
    /** Assert a predicate, carrying the raw evidence into the record. */
    assert(label, condition, evidence = '') {
      const ok = Boolean(condition)
      checks.push({ label, ok, actual: evidence, expected: 'truthy' })
      return ok
    },
    /** Record a raw observation without asserting on it. */
    observe(label, value) {
      notes.push({ label, value })
      return value
    },
    /** Skip the rest of the case: the feature is absent, not wrong. */
    blocked(reason) {
      throw new Blocked(reason)
    },
  }
}

function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null || typeof a !== 'object') return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/**
 * Run one case, isolating Blocked from real failures.
 * @returns {{name: string, status: 'PASS'|'FAIL'|'BLOCKED', checks: object[], notes: object[], blockedReason?: string, error?: string}}
 */
export async function runCase(name, fn) {
  const report = makeReport(name)
  let status = 'PASS'
  let blockedReason
  let error
  try {
    await fn(report)
  } catch (thrown) {
    if (thrown instanceof Blocked) {
      status = 'BLOCKED'
      blockedReason = thrown.message
    } else {
      status = 'FAIL'
      error = thrown?.stack ?? String(thrown)
    }
  }
  if (status === 'PASS' && report.checks.some((c) => !c.ok)) status = 'FAIL'
  return { name, status, checks: report.checks, notes: report.notes, blockedReason, error }
}

/** Print one case result with its raw observations. */
export function printCase(result, verbose = true) {
  const mark = result.status === 'PASS' ? 'PASS   ' : result.status === 'FAIL' ? 'FAIL   ' : 'BLOCKED'
  console.log(`\n--- ${mark} ${result.name} ---`)
  for (const note of result.notes) {
    if (!verbose) continue
    console.log(`  · ${note.label}: ${format(note.value)}`)
  }
  for (const check of result.checks) {
    console.log(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.label}`)
    if (!check.ok) {
      console.log(`         expected: ${format(check.expected)}`)
      console.log(`         actual  : ${format(check.actual)}`)
    }
  }
  if (result.blockedReason !== undefined) console.log(`  blocked: ${result.blockedReason}`)
  if (result.error !== undefined) console.log(`  error  : ${result.error}`)
}

function format(value) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}