/**
 * F3 cache-invalidation gate — the假绿 trap the Lead hit on his first probe.
 *
 * The registry caches a merged collection keyed by (cwd, scope chain, revision).
 * A provider that changes its answer without asking the registry to invalidate
 * keeps serving the STALE list. The failure mode is silent and LOOKS like
 * "suppression has no effect": every list() call returns the same thing.
 *
 * The Lead's own first probe was fooled by exactly this — four stages printed
 * identical output, which read as "the suppression mechanism does not work".
 * It did work; the cache was answering.
 *
 * Built as two parts over DISJOINT name sets, so neither can mask the other:
 *
 *   Part 1 (self-a / self-b) — a provider that mutates its output WITHOUT
 *     invalidating. list() must NOT change. This proves the cache is genuinely
 *     live in this context, which is what makes Part 2 falsifiable: without it,
 *     a green Part 2 could just mean caching is switched off.
 *
 *   Part 2 (gate-a / gate-b) — the shipped Suppressor wired the way the plugin
 *     wires it. list() before and after the toggle MUST differ.
 */
import { bootRealSkillTool, candidate, settle } from '../lib/real-harness.mjs'
import { loadToggle, makeSuppressor } from '../lib/plugin-under-test.mjs'

export const meta = {
  id: 'f3cache',
  requirement: 'F3.1 (cache invalidation)',
  title: 'a toggle really invalidates the registry cache (before !== after)',
}

export async function run(report) {
  const { ctx, dispose } = await bootRealSkillTool()

  try {
    const toggle = await loadToggle(report)

    // ---- Part 1: prove the cache is live ----------------------------------
    const silent = new Set()
    let selfCheckControl
    ctx.skills.registerProvider((c) => {
      selfCheckControl = c
      return {
        name: 'cache-selfcheck',
        async list() {
          return ['self-a', 'self-b']
            .filter((name) => !silent.has(name))
            .map((name) => candidate(name, { provider: 'cache-selfcheck' }))
        },
        async get() {
          return undefined
        },
      }
    })
    await settle()

    const selfNames = async () =>
      (await ctx.skills.list()).map((s) => s.name).filter((n) => n.startsWith('self-')).sort()
    const selfBefore = await selfNames()
    report.observe('self-check names before', selfBefore)

    silent.add('self-a') // mutate the provider's answer, deliberately WITHOUT invalidating
    await settle(20)
    const selfAfter = await selfNames()
    report.observe('self-check names after a silent mutation (no invalidate)', selfAfter)
    report.check(
      'harness self-check: a silent state change is NOT observed — the cache is live, so Part 2 can fail',
      selfAfter,
      selfBefore,
    )
    report.assert('the provider control handle exposes invalidate()', typeof selfCheckControl?.invalidate === 'function')

    // ---- Part 2: the gate --------------------------------------------------
    const { suppressor, toggle: applyToggle } = await makeSuppressor(ctx, toggle, 'gate-provider', [
      candidate('gate-a', { provider: 'gate-provider', content: 'BODY-gate-a' }),
      candidate('gate-b', { provider: 'gate-provider', content: 'BODY-gate-b' }),
    ])
    // THE DISCRIMINATOR IS THE INVOCATION FLAG, NOT THE NAME LIST.
    //
    // Under the shipped INERT strategy a disabled name STAYS in list(), carried
    // by our own contention candidate — that is how a same-layer rival is
    // defeated (see f3competitor). So a name-only comparison is legitimately
    // identical before and after, and asserting that it must differ would be an
    // OMIT criterion: it would fail on correct code and pass on the broken
    // strategy. What actually moves when the cache is invalidated is the flag.
    const gatePolicy = async () =>
      (await ctx.skills.list())
        .filter((s) => s.name.startsWith('gate-'))
        .map((s) => `${s.name}:${s.invocation?.modelInvocable}`)
        .sort()

    const before = await gatePolicy()
    report.observe('gate rows before the toggle (name:modelInvocable)', before)
    report.check('precondition: both gate skills are visible and invocable', before, ['gate-a:true', 'gate-b:true'])

    await applyToggle('gate-b', false)
    report.observe('suppressor disabled set', [...suppressor.disabled])

    const after = await gatePolicy()
    report.observe('gate rows after the toggle (name:modelInvocable)', after)
    report.assert(
      'F3 cache gate: the OBSERVED ROW PAYLOAD changes after the toggle (a stale cache would be byte-identical)',
      JSON.stringify(after) !== JSON.stringify(before),
      `before=${JSON.stringify(before)} after=${JSON.stringify(after)} — identical payload means the toggle never invalidated the registry cache`,
    )
    report.assert(
      'F3 cache gate: the change is the RIGHT one — gate-b flipped to modelInvocable=false, gate-a untouched',
      after.includes('gate-b:false') && after.includes('gate-a:true'),
      `after=${JSON.stringify(after)}`,
    )
    const suppressedGet = await ctx.skills.get('gate-b')
    report.observe('get(gate-b) after the toggle', suppressedGet === undefined ? 'undefined' : `DEFINITION provider=${suppressedGet.provider}`)
    report.assert(
      'F3 cache gate: the suppressed name resolves to nothing (so the tool refuses it)',
      suppressedGet === undefined,
      suppressedGet === undefined ? 'undefined' : `provider=${suppressedGet.provider} — our candidate must win the slot AND return no body`,
    )
    report.assert(
      'the toggled name is gone from the model-visible catalog',
      !(await ctx.skills.list())
        .filter((s) => s.invocation?.modelInvocable === true)
        .map((s) => s.name)
        .includes('gate-b'),
      JSON.stringify((await ctx.skills.list()).map((s) => `${s.name}:${s.invocation?.modelInvocable}`)),
    )
    report.assert(
      'control: the sibling from the same provider survives uncancelled (the toggle is per-name)',
      after.includes('gate-a:true'),
      JSON.stringify(after),
    )

    // Re-enabling must be observed too, or invalidation only works one way.
    await applyToggle('gate-b', true)
    const restored = await gatePolicy()
    report.observe('gate rows after re-enabling', restored)
    report.check('re-enabling returns the payload to its original value', restored, before)
  } finally {
    await dispose()
  }
}
