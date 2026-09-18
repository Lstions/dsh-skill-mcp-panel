/**
 * Drive the repo's own provider module directly, so scale cases measure the
 * SHIPPED discovery code rather than a reimplementation of it.
 *
 * `lib/index.js` is a Cordis plugin whose `apply()` needs a context. The repo's
 * own test harness (`skill-nesting/test/harness.mjs`) already provides a
 * minimal one that captures the registered provider; this reuses that contract
 * instead of inventing a second, divergent fake.
 */
import { makeFsService, makeCtx } from '../../../skill-nesting/test/harness.mjs'

/**
 * Run the real provider over the given roots.
 * @returns {Promise<{skills: object[], uniqueNames: number, duplicates: object[], errors: object[], categories: string[], report: object}>}
 */
export async function runRealProvider(roots, config, report) {
  const harness = makeCtx(makeFsService())
  const { apply } = await import('../../../skill-nesting/lib/index.js')
  apply(harness.ctx, { roots, ...config })

  const captured = harness.captured
  if (captured === undefined) throw new Error('runRealProvider: apply() registered no provider')

  const skills = await captured.provider.list()
  const last = captured.provider.lastReport ?? {}

  const names = skills.map((candidate) => candidate.name)
  const categories = new Set()
  for (const candidate of skills) {
    const directory = candidate.locator?.directory ?? ''
    const relative = directory.replace(/^.*\/skills\//, '')
    const parts = relative.split('/').filter(Boolean)
    // Category = every directory segment above the skill directory itself.
    const category = parts.length > 1 ? parts.slice(0, -1).join('/') : (parts[0] ?? '')
    categories.add(category)
  }

  report?.observe('provider warnings', harness.logs.filter(([level]) => level === 'warn').map(([, message]) => message))

  return {
    skills,
    uniqueNames: new Set(names).size,
    duplicates: last.duplicates ?? [],
    skipped: last.skipped ?? [],
    errors: last.errors ?? [],
    categories: [...categories].filter(Boolean).sort(),
    report: last,
  }
}
/**
 * Drive the SHIPPED plugin end to end over a throwaway skill tree.
 *
 * `apply()` is called exactly as the host composition calls it, with the
 * persisted disable table in `config.skills` (read through `readToggles`). This
 * is the only way to assert on what the PRODUCT publishes for a disabled name —
 * a hand-built provider stand-in would encode the test author's assumption
 * instead of the product's behaviour, which is precisely how an earlier version
 * of this suite misjudged the suppression strategy.
 *
 * @param {object} report - observation sink.
 * @param {string[]} skillNames - skills to create in the temp tree.
 * @param {string[]} disabled - names to place in the disable table.
 * @returns {Promise<{provider: object, ctx: object, root: string, cleanup: Function}>}
 */
export async function bootShippedPlugin(report, skillNames, disabled = []) {
  const { makeFsService, makeCtx } = await import('../../../skill-nesting/test/harness.mjs')
  const { apply } = await import('../../../skill-nesting/lib/index.js')
  const { writeTempSkillTree, removeTree } = await import('./fs-probe.mjs')

  const tree = writeTempSkillTree(skillNames.map((name) => ({ name, body: `ORIGINAL BODY of ${name}` })))
  const harness = makeCtx(makeFsService())
  apply(harness.ctx, {
    roots: [tree.root],
    maxDepth: 4,
    includeHidden: false,
    duplicatePolicy: 'first-wins',
    // The persisted disable table, read through `readToggles(config)`.
    skills: Object.fromEntries(disabled.map((name) => [name, true])),
  })
  await new Promise((resolve) => setTimeout(resolve, 60))

  if (harness.captured === undefined) {
    throw new Error('bootShippedPlugin: apply() registered no provider')
  }
  report?.observe('shipped provider class', harness.captured.provider.constructor.name)
  report?.observe('shipped temp root', tree.root)
  return {
    provider: harness.captured.provider,
    ctx: harness.ctx,
    root: tree.root,
    cleanup: () => removeTree(tree.root),
  }
}
