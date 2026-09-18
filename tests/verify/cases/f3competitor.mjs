/**
 * F3.1 — the SAME-LAYER COMPETITOR case: the single most valuable adversarial
 * case in this suite, because it is the one a well-meaning "cleanup" breaks.
 *
 * THE TRAP
 * Two strategies can make a skill look closed, and they differ only when
 * another provider in the SAME LAYER also supplies the name:
 *
 *   INERT  win the name with a candidate whose invocation is all-false
 *     -> the name is in list() but not model-invocable
 *     -> get() returns undefined, the real tool says "not available"
 *     -> the competitor is DEFEATED: the close is honored
 *
 *   OMIT   stop publishing the candidate, so nothing of ours contests the name
 *     -> registry falls through to the competitor, which serves it live
 *     -> model sees it again, get() returns the competitor's body
 *     -> the close is SILENTLY IGNORED — worse than a visible failure
 *
 * Verified independently (evidence/probe-same-layer.mjs):
 *   INERT -> model sees []            get() undefined   tool "not available"
 *   OMIT  -> model sees ["x"]         get() =competitor tool loads the body
 *
 * OMIT looks cleaner ("the name disappears from the list!") and is exactly the
 * change a later contributor makes for tidiness. This case turns red the moment
 * anyone does, and states in the failure message why that is a regression.
 *
 * It also pins the honest limit: a NEARER layer (preset scope) cannot be
 * defeated by either strategy. That is F3.3's job, asserted there.
 */
import { bootRealSkillTool, registerProvider, candidate, settle } from '../lib/real-harness.mjs'
import { bootShippedPlugin } from '../lib/real-provider.mjs'


export const meta = {
  id: 'f3competitor',
  requirement: 'F3.1',
  title: 'with a same-layer competitor, closing must still take effect (inert, not omit)',
}

export async function run(report) {
  const { ctx, call, dispose } = await bootRealSkillTool()

  try {
    // The competitor models the built-in `skill-filesystem`: a different
    // provider, SAME layer (global), worse rank than ours.
    registerProvider(ctx, 'competitor', [
      candidate('shared-skill', { provider: 'competitor', rank: 400, content: 'COMPETITOR BODY' }),
    ])
    await settle()

    const before = await ctx.skills.list()
    report.observe('catalog before any toggle', before.map((s) => `${s.name}<-${s.provider}`))
    report.observe('tool before toggle', await call('shared-skill'))
    report.assert(
      'precondition: the competitor really serves the name before the toggle',
      before.some((s) => s.name === 'shared-skill' && s.provider === 'competitor'),
      `before=${JSON.stringify(before.map((s) => `${s.name}<-${s.provider}`))} — without a real competitor this scenario proves nothing`,
    )

    // ---- run the SHIPPED provider, with the name disabled -------------------
    //
    // The real `NestedSkillProvider` is used rather than a hand-built stand-in,
    // because the decision under test belongs to it: what it publishes for a
    // disabled name. A stand-in could encode this test's assumption instead of
    // the product's behaviour.
    const shipped = await loadShippedProvider(ctx, report)
    report.observe('shipped provider class', shipped.provider.constructor.name)
    const published = await shipped.provider.list()
    const ours = published.filter((c) => c.name === 'shared-skill')
    report.observe(
      'shipped provider publishes for the disabled name',
      ours.map((c) => ({ provider: c.provider, invocation: c.invocation, rank: c.rank })),
    )
    report.assert(
      'F3.1: the shipped provider still CONTESTS the disabled name (publishing nothing lets a rival win)',
      ours.length > 0,
      `published=${JSON.stringify(ours)} — an empty array here means the close is silently conceded to the competitor`,
    )
    report.assert(
      'F3.1: the contention candidate is non-invocable on both axes',
      ours.every((c) => c.invocation?.modelInvocable === false && c.invocation?.userInvocable === false),
      JSON.stringify(ours.map((c) => c.invocation)),
    )

    // Mount the shipped provider into the real registry, next to the rival.
    ctx.skills.registerProvider(() => shipped.provider)
    if (typeof ctx.skills.invalidateCache === 'function') ctx.skills.invalidateCache()
    await settle(80)

    const after = await ctx.skills.list()
    const afterRow = after.find((s) => s.name === 'shared-skill')
    const modelVisible = after.filter((s) => s.invocation?.modelInvocable === true).map((s) => s.name)
    const got = await ctx.skills.get('shared-skill')
    const tool = await call('shared-skill')

    report.observe('catalog after closing', after.map((s) => `${s.name}<-${s.provider} model=${s.invocation?.modelInvocable}`))
    report.observe('model-visible catalog after closing', modelVisible)
    report.observe('get() after closing', got === undefined ? 'undefined' : `provider=${got.provider} body=${JSON.stringify(got.content)}`)
    report.observe('tool after closing', tool)

    // ---- the assertions that define a real close ---------------------------
    report.assert(
      'F3.1: the model-visible catalog does NOT contain the name (the competitor must not take over)',
      !modelVisible.includes('shared-skill'),
      `modelVisible=${JSON.stringify(modelVisible)} — if the name reappears here, our provider stopped contesting it and the competitor silently won`,
    )
    report.assert(
      'F3.1: get() returns undefined, not the competitor body',
      got === undefined,
      got === undefined ? 'undefined' : `the close was ignored: provider=${got.provider} content=${JSON.stringify(got.content)}`,
    )
    report.assert(
      'F3.1: the real skill tool refuses to load it',
      tool.ok === false,
      JSON.stringify(tool),
    )

    // The honest-reporting requirement: whichever row survives, it must not
    // read as "closed AND callable".
    if (afterRow !== undefined) {
      report.observe('surviving row', afterRow)
      report.assert(
        'F3.1: the surviving row is NOT model-invocable',
        afterRow.invocation?.modelInvocable === false,
        `row model=${afterRow.invocation?.modelInvocable} provider=${afterRow.provider}`,
      )
    }
  } finally {
    await dispose()
  }
}

/** Instantiate the shipped provider over a temp tree with one name disabled. */
async function loadShippedProvider(ctx, report) {
  return bootShippedPlugin(report, ['shared-skill'], ['shared-skill'])
}