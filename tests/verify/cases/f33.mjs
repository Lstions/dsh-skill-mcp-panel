/**
 * F3.3 — a near-layer (preset scope) copy must be reported honestly.
 *
 * THE MECHANIC, measured against the real registry
 * (evidence/probe-preset-depth1.mjs, probe-near-layer.mjs):
 *   - `skill-filesystem` mounted by a preset registers into THAT PRESET'S layer.
 *   - A GLOBAL-layer provider — where skill-mcp-panel lives — cannot shadow it,
 *     and rank does not help: the nearer layer wins outright. Measured: a
 *     global rank-100 suppression candidate LOSES to a preset rank-500 provider.
 *   - Measured on this machine: the preset's depth-1 filesystem provider finds
 *     exactly 10 skills, while the nested provider finds 135. So 10 of 135 names
 *     are owned by the preset layer and CANNOT be closed from the global plugin.
 *
 * Therefore: toggling one of those off from the global plugin cannot hide it
 * from the model. The interface must say so. Reporting "closed" is a lie, and a
 * test that only checks the plugin's own bookkeeping would never catch it.
 *
 * TWO TRAPS this case is built to avoid:
 *   1. `ctx.skills.list({scope})` takes a scope KEY, not a scoped ctx. Passing
 *      the ctx yields the global view and a false pass.
 *   2. Reading only the global view also yields a false pass, because the global
 *      view cannot see the preset layer at all.
 */
import { bootRealSkills, registerProvider, candidate, settle, loadReal } from '../lib/real-harness.mjs'
import { loadToggle } from '../lib/plugin-under-test.mjs'

export const meta = {
  id: 'f33',
  requirement: 'F3.3',
  title: 'a skill owned by the preset (near) layer is reported effective=false, never "closed"',
}

export async function run(report) {
  const { ctx, dispose } = await bootRealSkills()

  try {
    const toggle = await loadToggle(report)
    const { scope: scopeMod } = await loadReal()

    // Global layer: this plugin owns `contested` and can suppress within it.
    const { suppressor, toggle: applyToggle } = await makeGlobalSuppressor(ctx, toggle, 'nesting-suppressor')

    // Near layer: a preset legitimately supplies the SAME name with a WORSE
    // rank, proving that layer proximity beats rank.
    const scoped = scopeMod.createScope(ctx, { preset: 'verify-near-layer' }, {})
    const scopeKey = scopeMod.scopeOf(scoped.ctx)
    scoped.ctx.plugin({
      name: 'verify-preset-skills',
      inject: ['skills'],
      apply(c) {
        c.skills.registerProvider(() => ({
          name: 'preset-owner',
          async list() {
            return [candidate('contested', { provider: 'preset-owner', rank: 500 })]
          },
          async get() {
            return { ...candidate('contested', { provider: 'preset-owner' }), content: 'PRESET BODY' }
          },
        }))
      },
    })
    await settle(80)

    report.observe('preset scope key', JSON.stringify(scopeKey))
    report.observe('preset layer providers', [...(ctx.skills.layers.peek(scopeKey)?.providers.keys() ?? [])])
    report.observe('observed discovery scope keys', toggle.discoverScopes(ctx).map((k) => JSON.stringify(k)))
    report.assert(
      'precondition: the scope was discovered by the shipped discoverScopes()',
      toggle.discoverScopes(ctx).some((k) => k === scopeKey),
      `discovered=${JSON.stringify(toggle.discoverScopes(ctx))}`,
    )

    // The scope KEY must be used, not the scoped ctx (trap 1).
    const globalView = await ctx.skills.list()
    const presetView = await ctx.skills.list({ scope: scopeKey })
    report.observe('global view', globalView.map((s) => `${s.name}<-${s.provider}`))
    report.observe('preset view', presetView.map((s) => `${s.name}<-${s.provider} rank-implicit`))
    report.assert(
      'precondition: the preset layer really serves this name',
      presetView.some((s) => s.name === 'contested' && s.provider === 'preset-owner'),
      `presetView=${JSON.stringify(presetView.map((s) => `${s.name}<-${s.provider}`))}`,
    )

    // ---- the operation under test: close it from the GLOBAL plugin ---------
    await applyToggle('contested', false)
    report.observe('suppressed names', [...suppressor.disabled])

    const hostJudge = toggle.judgeHidden({
      catalog: await toggle.readCatalog(ctx, undefined),
      name: 'contested',
      providerName: 'nesting-suppressor',
    })
    report.observe('judgeHidden on the HOST view alone', hostJudge)

    const verdicts = await toggle.verifyDisabled({
      ctx,
      names: ['contested'],
      providerName: 'nesting-suppressor',
    })
    const verdict = verdicts.get('contested')
    report.observe('verifyDisabled verdict (all views)', verdict)

    // ---- F3.3: the honest report -------------------------------------------
    report.assert('F3.3: a verdict exists for the toggled name', verdict !== undefined, JSON.stringify([...verdicts]))
    if (verdict !== undefined) {
      report.assert(
        'F3.3: effective is false — the toggle did NOT take effect in every visible view',
        verdict.effective === false,
        `effective=${JSON.stringify(verdict.effective)} — true here is a false success report, because the preset still serves it`,
      )
      report.assert(
        'F3.3: shadowedBy names who still supplies it',
        typeof verdict.shadowedBy === 'string' && verdict.shadowedBy.length > 0,
        `shadowedBy=${JSON.stringify(verdict.shadowedBy)} — must name the provider or a reason, not be null`,
      )
      report.assert(
        'F3.3: the verifier noticed the preset layer (not just the global view)',
        hostJudge.hidden === true && verdict.effective === false,
        `hostJudge.hidden=${hostJudge.hidden}, verdict.effective=${verdict.effective} — if both agree, the scoped views were never read`,
      )
      report.assert(
        'F3.3: the human-readable detail does not claim success',
        (() => {
          const detail = toggle.describeVerdict('contested', false, verdict)
          report.observe('describeVerdict text', detail)
          return !/\bdisabled\b/i.test(detail) || /still|remains|not/i.test(detail)
        })(),
        'the text must not say plainly "disabled" while a nearer layer still serves it',
      )
    }

    // Sanity: the preset view must STILL serve the name — that is the premise.
    const afterPresetView = await ctx.skills.list({ scope: scopeKey })
    report.assert(
      'F3.3 mechanic: the name is STILL live in the preset scope after the global suppression',
      afterPresetView.some((s) => s.name === 'contested' && s.provider === 'preset-owner'),
      `presetView=${JSON.stringify(afterPresetView.map((s) => `${s.name}<-${s.provider}`))}`,
    )
  } finally {
    await dispose()
  }
}

/** Register the shipped Suppressor at the global layer with a given rank. */
async function makeGlobalSuppressor(ctx, toggle, providerName) {
  const suppressor = new toggle.Suppressor({ providerName, rank: 100 })
  ctx.skills.registerProvider(() => ({
    name: providerName,
    async list() {
      return suppressor.candidates()
    },
    async get() {
      return undefined
    },
  }))
  await settle(40)
  return {
    suppressor,
    async toggle(name, enabled) {
      const next = new Set(suppressor.disabled)
      if (enabled === false) next.add(name)
      else next.delete(name)
      suppressor.set(next)
      if (typeof ctx.skills.invalidateCache === 'function') ctx.skills.invalidateCache()
      await settle(40)
    },
  }
}