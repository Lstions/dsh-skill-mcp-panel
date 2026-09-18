/**
 * N5 — performance of the state endpoint at real scale.
 *
 * N5 requires P95 < 500ms on this machine's ~135-skill tree, AFTER warm-up.
 * The method matters as much as the number, so it is written down here:
 *
 *   samples   60 sequential GETs against the real registered handler
 *   warm-up   the first 10 samples are discarded, because a cold scan of the
 *             tree is a different measurement from steady-state request cost
 *   statistic P95 by nearest-rank on the retained samples (index ceil(0.95*n)-1)
 *             — stated explicitly because "P95" is otherwise ambiguous between
 *             nearest-rank and interpolation
 *   load      the real provider over the real roots, so the cache is exercised
 *             the way production exercises it
 *
 * Raw per-sample numbers are printed, not just the percentile: a P95 alone
 * cannot distinguish "consistently 40ms" from "two 900ms spikes".
 */
import { loadState, hasModule } from '../lib/plugin-under-test.mjs'
import { runRealProvider } from '../lib/real-provider.mjs'
import { createWebServerHarness, makeRequest } from '../lib/http-harness.mjs'
import { loadHttp } from '../lib/plugin-under-test.mjs'
import { registerProvider, bootRealSkills, candidate, settle } from '../lib/real-harness.mjs'

const WARMUP = 10
const SAMPLES = 60

export const meta = { id: 'perf', requirement: 'N5', title: 'state endpoint P95 under real scale' }

export async function run(report) {
  if (!hasModule('state.js')) report.blocked('N5: skill-nesting/lib/state.js does not exist yet')

  // Preferred measurement: the real HTTP handler, because that is what N5 names.
  if (hasModule('http.js')) {
    const measured = await measureOverHttp(report)
    if (measured !== undefined) return
  }
  await measureStateBuilder(report)
}

/** Time the registered GET handler over a real provider-backed context. */
async function measureOverHttp(report) {
  const http = await loadHttp(report)
  const stateModule = await loadState(report)
  report.observe('state builder export', typeof stateModule.createStateBuilder)

  const provider = await runRealProvider(
    ['/home/sun/.agents/skills', '/home/sun/.hermes/skills', '/home/sun/.dsh/skills'],
    { maxDepth: 4, includeHidden: false, duplicatePolicy: 'first-wins' },
    report,
  )
  report.observe('catalog under measurement', `${provider.skills.length} skills`)

  const server = createWebServerHarness()
  if (typeof http.createHttpRoutes !== 'function') {
    report.observe('http registrar', `none found in ${JSON.stringify(Object.keys(http))}`)
    return undefined
  }

  const { ctx, dispose } = await bootRealSkills()
  try {
    registerProvider(
      ctx,
      'nested-filesystem',
      provider.skills.map((entry) =>
        candidate(entry.name, { provider: 'nested-filesystem', rank: 300, path: entry.path, description: entry.description }),
      ),
    )
    await settle()

    // Wire the REAL state builder and route factory with the same dependency
    // bag production uses, so the measured cost is the shipped cost. An earlier
    // version passed only a partial bag and the handler threw
    // "readWriteAccess is not a function" — a harness defect, not a slow path.
    const builder = stateModule.createStateBuilder({
      ctx,
      provider: { name: 'nested-filesystem', lastReport: { roots: [], errors: [], duplicates: [] } },
      readConfig: () => ({ roots: [], maxDepth: 4, rank: 300, duplicatePolicy: 'first-wins' }),
      readDisabled: () => new Set(),
      readMcp: () => ({ servers: [], managerAvailable: false, mcpClientAvailable: false }),
      readWriteAccess: () => 'same-origin',
      isWritable: () => true,
      log: () => {},
    })
    await http.createHttpRoutes({
      ctx: server.ctx,
      buildState: () => builder.build(),
      applyOps: async () => [],
      readWriteAccess: () => 'same-origin',
      isWritable: () => true,
    })

    const handler = server.handlerFor('/skill-nesting/state') ?? server.handlers[Object.keys(server.handlers)[0]]
    if (handler === undefined) {
      report.observe('state handler', 'not registered — falling back to the builder')
      return undefined
    }

    // NON-VACUITY GUARD. A fast handler that returns an empty document would
    // satisfy "P95 < 500ms" while measuring nothing. The payload size is
    // asserted BEFORE the timing loop, so a shrunken catalog fails loudly
    // instead of producing a flattering number.
    const probe = makeRequest({ method: 'GET', host: '127.0.0.1:3080' })
    await handler(probe.req, probe.res)
    let payload
    try {
      payload = JSON.parse(probe.res.capturedBody ?? '{}')
    } catch {
      payload = {}
    }
    const payloadSkills = Array.isArray(payload.skills) ? payload.skills.length : 0
    report.observe('payload skills in the measured response', payloadSkills)
    report.assert(
      'N5: the measured payload really contains the full catalog (a fast empty response would prove nothing)',
      payloadSkills >= 100,
      `payloadSkills=${payloadSkills} — expected the real tree's ~135; a much smaller number means the timing measures an empty document`,
    )

    const timings = []
    for (let index = 0; index < WARMUP + SAMPLES; index += 1) {
      const { req, res } = makeRequest({ method: 'GET', host: '127.0.0.1:3080' })
      const start = process.hrtime.bigint()
      await handler(req, res)
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6
      if (index >= WARMUP) timings.push(Number(elapsedMs.toFixed(2)))
    }
    summarise(report, timings, 'GET /skill-nesting/state (real handler)')
    return true
  } finally {
    await dispose()
  }
}

/** Fallback: time the state builder directly. Reported as a different口径. */
async function measureStateBuilder(report) {
  const stateModule = await loadState(report)
  const build = stateModule.buildState ?? stateModule.createState ?? stateModule.describeState
  if (typeof build !== 'function') {
    report.blocked(
      `N5: lib/state.js exports no builder (exports=${JSON.stringify(Object.keys(stateModule))})`,
    )
  }

  const provider = await runRealProvider(
    ['/home/sun/.agents/skills', '/home/sun/.hermes/skills', '/home/sun/.dsh/skills'],
    { maxDepth: 4, includeHidden: false, duplicatePolicy: 'first-wins' },
    report,
  )
  report.observe('catalog under measurement', `${provider.skills.length} skills`)

  const { ctx, dispose } = await bootRealSkills()
  try {
    registerProvider(
      ctx,
      'nested-filesystem',
      provider.skills.map((entry) => candidate(entry.name, { provider: 'nested-filesystem', rank: 300, path: entry.path })),
    )
    await settle()

    const timings = []
    for (let index = 0; index < WARMUP + SAMPLES; index += 1) {
      const start = process.hrtime.bigint()
      await build({ ctx, readConfig: () => ({ roots: [] }), readDeclared: () => [] })
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6
      if (index >= WARMUP) timings.push(Number(elapsedMs.toFixed(2)))
    }
    summarise(report, timings, 'state builder (no HTTP layer — different口径 from N5)')
  } finally {
    await dispose()
  }
}

/** Nearest-rank percentile over retained samples, with raw numbers reported. */
function summarise(report, timings, label) {
  const sorted = [...timings].sort((a, b) => a - b)
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]
  const p50 = p(0.5)
  const p95 = p(0.95)
  const max = sorted[sorted.length - 1]
  const mean = timings.reduce((a, b) => a + b, 0) / timings.length

  report.observe('measurement口径', `${label}; warmup=${WARMUP} discarded; samples=${timings.length}; nearest-rank P95`)
  report.observe('raw samples (ms)', timings.join(' '))
  report.observe('P50 / P95 / max / mean (ms)', `${p50.toFixed(2)} / ${p95.toFixed(2)} / ${max.toFixed(2)} / ${mean.toFixed(2)}`)

  report.assert(`N5: P95 < 500ms (measured ${p95.toFixed(2)}ms)`, p95 < 500, `P95=${p95.toFixed(2)}ms over ${timings.length} samples`)
  report.assert(`N5: P50 < 200ms (measured ${p50.toFixed(2)}ms)`, p50 < 200, `P50=${p50.toFixed(2)}ms`)
}