/**
 * F4 — the conflict list must agree with the live registry, and a symlink alias
 * must never be mistaken for a conflict.
 *
 * Two independent claims:
 *
 *  F4.4  `/home/sun/.agents/skills` is a symlink to `/home/sun/.hermes/skills`.
 *        Both roots are configured. A path-text implementation would report all
 *        ~135 skills as duplicates. Identity-based dedupe reports them once.
 *        This is asserted on the REAL symlink, not a synthetic one, so it also
 *        catches a root list that merely happens to exclude the alias.
 *
 *  F4.2  For every conflict the interface reports, the winner's provider+path
 *        must equal what `ctx.skills.list()` actually resolves for that name.
 *        A conflict panel that disagrees with the registry is worse than none.
 */
import { realpathSync, existsSync, lstatSync } from 'node:fs'
import { bootRealSkills, registerProvider, candidate, settle } from '../lib/real-harness.mjs'
import { loadState, readStateSkills } from '../lib/plugin-under-test.mjs'
import { runRealProvider } from '../lib/real-provider.mjs'

const USER_ROOT = '/home/sun/.hermes/skills'
const ALIAS_ROOT = '/home/sun/.agents/skills'

export const meta = { id: 'f44', requirement: 'F4.2 + F4.4', title: 'symlink alias is not a conflict; conflict winners match the registry' }

export async function run(report) {
  // ---- Part 1: the real symlink ------------------------------------------
  const isLink = existsSync(ALIAS_ROOT) && lstatSync(ALIAS_ROOT).isSymbolicLink()
  report.observe('alias root', `${ALIAS_ROOT} isSymbolicLink=${isLink} -> ${existsSync(ALIAS_ROOT) ? realpathSync(ALIAS_ROOT) : 'MISSING'}`)
  report.assert('precondition: the alias really is a symlink to the user root', isLink && realpathSync(ALIAS_ROOT) === realpathSync(USER_ROOT))

  const provider = await runRealProvider(
    [ALIAS_ROOT, USER_ROOT, '/home/sun/.dsh/skills'],
    { maxDepth: 4, includeHidden: false, duplicatePolicy: 'first-wins' },
    report,
  )
  report.observe('skills discovered through both roots', provider.skills.length)
  report.observe('conflicts reported', provider.duplicates.map((d) => ({ name: d.name, paths: d.paths })))

  report.assert(
    'F4.4: aliased roots do not multiply the catalog (a path-text impl would report ~all as duplicates)',
    provider.skills.length > 0 && provider.duplicates.length < provider.skills.length,
    `${provider.duplicates.length} conflicts over ${provider.skills.length} skills`,
  )
  report.assert(
    'F4.4: no conflict pairs an alias path with a real-root path',
    !provider.duplicates.some(
      (d) => d.paths.some((p) => p.includes('/.agents/')) && d.paths.some((p) => p.includes('/.hermes/')),
    ),
    JSON.stringify(provider.duplicates),
  )
  // Every reported path must be a distinct real file: that is what "genuine
  // duplicate" means here, and it is the property the alias case turns on.
  for (const duplicate of provider.duplicates) {
    const canonical = duplicate.paths.map((p) => {
      try {
        return realpathSync(p)
      } catch {
        return `MISSING:${p}`
      }
    })
    report.check(
      `conflict "${duplicate.name}" candidates are distinct files`,
      new Set(canonical).size,
      canonical.length,
    )
  }

  // ---- Part 2: conflicts vs the live registry -----------------------------
  const { ctx, dispose } = await bootRealSkills()
  try {
    // Feed the real discovered catalog into the real registry, then compare.
    const real = provider.skills.map((entry) => candidate(entry.name, {
      provider: 'nested-filesystem',
      rank: 300,
      path: entry.path,
      description: entry.description,
    }))
    registerProvider(ctx, 'nested-filesystem', real)
    await settle()

    const stateModule = await loadState(report)
    const { state, skills } = await readStateSkills(stateModule, ctx, report)
    const registry = await ctx.skills.list()

    report.observe('registry size', registry.length)
    report.observe('state.skills size', skills.length)
    report.check('F2: state skill count equals the live registry count', skills.length, registry.length)

    const conflicts = state.conflicts ?? []
    report.observe('state.conflicts', conflicts.map((c) => ({ name: c.name, winner: c.winner, policy: c.policy })))

    // F4.2 —逐名核对 winner against the registry.
    let compared = 0
    let mismatched = 0
    for (const conflict of conflicts) {
      const live = registry.find((s) => s.name === conflict.name)
      if (live === undefined) continue
      compared += 1
      const providerMatches = live.provider === conflict.winner?.provider
      const pathMatches = live.path === conflict.winner?.path
      if (!providerMatches || !pathMatches) {
        mismatched += 1
        report.observe(`MISMATCH for "${conflict.name}"`, {
          reported: { provider: conflict.winner?.provider, path: conflict.winner?.path },
          live: { provider: live.provider, path: live.path },
        })
      }
    }
    report.observe('conflicts compared against the registry', compared)
    report.check('F4.2: every conflict winner matches the registry (mismatches)', mismatched, 0)

    // F4.5 — the empty state is explicit, never blank.
    report.assert(
      'F4.5: conflicts is an array (an empty list is a valid, renderable answer)',
      Array.isArray(conflicts),
      `typeof=${typeof conflicts}`,
    )
    for (const conflict of conflicts) {
      report.assert(
        `F4.1: conflict "${conflict.name}" carries a policy`,
        typeof conflict.policy === 'string' && conflict.policy.length > 0,
        `policy=${JSON.stringify(conflict.policy)}`,
      )
      report.assert(
        `F4.1: conflict "${conflict.name}" lists its losers`,
        Array.isArray(conflict.losers) && conflict.losers.length > 0,
        `losers=${JSON.stringify(conflict.losers)}`,
      )
      report.assert(
        `F4.6: conflict "${conflict.name}" states resolvability`,
        typeof conflict.resolvable === 'boolean',
        `resolvable=${JSON.stringify(conflict.resolvable)}`,
      )
    }
  } finally {
    await dispose()
  }
}