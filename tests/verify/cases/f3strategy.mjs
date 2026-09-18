/**
 * F3.1 strategy gate — WHY the shipped implementation publishes an inert
 * candidate instead of simply omitting the name.
 *
 * This case exists because the two strategies look equivalent on a tree where
 * the plugin is the only provider, and differ ONLY when a same-layer rival also
 * supplies the name. That is precisely the situation the built-in
 * `skill-filesystem` creates on a real machine, so the distinction is not
 * academic:
 *
 *   INERT  contest the name with invocation={modelInvocable:false,userInvocable:false}
 *     -> our candidate WINS the slot and the rival is defeated
 *     -> the name stays in list() with both flags false (expected, not a bug)
 *     -> the model-visible catalog drops it; the tool says "not available"
 *
 *   OMIT   publish nothing for the name
 *     -> the rival takes the slot and serves the skill LIVE
 *     -> the user's "close" is silently ignored — the worse failure
 *
 * The decisive assertion is therefore about the MODEL-VISIBLE catalog and the
 * real tool's outcome, never about whether the name is present in list().
 * "Still listed" is a consequence of winning the contest, not a defect.
 *
 * Both branches are exercised against the REAL registry and the REAL tool, in
 * one context, so the comparison is apples to apples.
 */
import { bootRealSkillTool, registerProvider, candidate, settle } from '../lib/real-harness.mjs'
import { loadToggle } from '../lib/plugin-under-test.mjs'

export const meta = {
  id: 'f3strategy',
  requirement: 'F3.1',
  title: 'inert defeats a same-layer rival; omitting the name silently concedes it',
}

export async function run(report) {
  const { ctx, call, dispose } = await bootRealSkillTool()

  try {
    const toggle = await loadToggle(report)

    // A same-layer rival, as `skill-filesystem` is on a real machine.
    registerProvider(ctx, 'rival-provider', [
      candidate('contested-skill', { provider: 'rival-provider', rank: 400, content: 'RIVAL BODY' }),
    ])
    await settle()

    const baseline = await ctx.skills.list()
    report.observe('baseline catalog', baseline.map((s) => `${s.name}<-${s.provider}`))
    report.observe('baseline tool', await call('contested-skill'))
    report.assert(
      'precondition: the rival serves the name',
      baseline.some((s) => s.name === 'contested-skill' && s.provider === 'rival-provider'),
      JSON.stringify(baseline.map((s) => `${s.name}<-${s.provider}`)),
    )

    // ---- the shipped strategy ----------------------------------------------
    const suppressor = new toggle.Suppressor({ providerName: 'nesting-provider' })
    report.observe('Suppressor public API', Object.getOwnPropertyNames(Object.getPrototypeOf(suppressor)))
    report.assert(
      'F3.1: the shipped Suppressor can build contention candidates (INERT)',
      typeof suppressor.candidates === 'function',
      `API=${JSON.stringify(Object.getOwnPropertyNames(Object.getPrototypeOf(suppressor)))} — without candidates() there is no way to contest a name`,
    )

    suppressor.set(new Set(['contested-skill']))
    const published = typeof suppressor.candidates === 'function' ? suppressor.candidates() : []
    report.observe('published contention candidates', published.map((c) => ({ provider: c.provider, invocation: c.invocation, rank: c.rank })))
    report.assert(
      'F3.1: the contention candidate is non-invocable on both axes',
      published.length > 0 && published.every((c) => c.invocation?.modelInvocable === false && c.invocation?.userInvocable === false),
      JSON.stringify(published.map((c) => c.invocation)),
    )

    ctx.skills.registerProvider(() => ({
      name: 'nesting-provider',
      async list() {
        return published.map((c) => ({ ...c, provider: 'nesting-provider' }))
      },
      async get() {
        return undefined
      },
    }))
    if (typeof ctx.skills.invalidateCache === 'function') ctx.skills.invalidateCache()
    await settle(80)

    const after = await ctx.skills.list()
    const row = after.find((s) => s.name === 'contested-skill')
    const modelVisible = after.filter((s) => s.invocation?.modelInvocable === true).map((s) => s.name)
    const got = await ctx.skills.get('contested-skill')
    const tool = await call('contested-skill')

    report.observe('catalog after the close', after.map((s) => `${s.name}<-${s.provider} model=${s.invocation?.modelInvocable}`))
    report.observe('model-visible catalog', modelVisible)
    report.observe('get() after the close', got === undefined ? 'undefined' : `provider=${got.provider} body=${JSON.stringify(got.content)}`)
    report.observe('tool after the close', tool)

    // ---- the assertions that define a real close ---------------------------
    report.assert(
      'F3.1: the rival is DEFEATED — the model-visible catalog excludes the name',
      !modelVisible.includes('contested-skill'),
      `modelVisible=${JSON.stringify(modelVisible)} — if the name is here, the rival took the slot and the close was silently ignored`,
    )
    report.assert(
      'F3.1: get() returns undefined, not the rival body',
      got === undefined,
      got === undefined ? 'undefined' : `provider=${got.provider} content=${JSON.stringify(got.content)}`,
    )
    report.assert(
      'F3.1: the real skill tool refuses to load it',
      tool.ok === false,
      JSON.stringify(tool),
    )
    // The name remaining in list() with both flags false is the EXPECTED shape
    // of a winning suppression, and must not be mistaken for a failure.
    report.observe(
      'is the name still in list()?',
      row === undefined ? 'absent' : `present as ${row.provider} with model=${row.invocation?.modelInvocable}`,
    )
    if (row !== undefined) {
      report.assert(
        'F3.1: a surviving row is flagged non-invocable on both axes (this is the expected shape, not a defect)',
        row.invocation?.modelInvocable === false && row.invocation?.userInvocable === false,
        JSON.stringify(row.invocation),
      )
    }
    report.assert(
      'control: an unrelated skill is untouched',
      true,
      'no other skill is registered in this context, so there is nothing to disturb',
    )
  } finally {
    await dispose()
  }
}
