/**
 * F1 / F4 — real-tree scale, recomputed from scratch every run.
 *
 * The numbers 139/24 circulated in the task brief and 135/24 in the Lead's
 * correction. Rather than adopt either, this case re-derives every figure from
 * the filesystem and STATES ITS口径, because a count without a denominator and
 * a counting rule is not a measurement.
 *
 * 口径 (stated so the numbers can be challenged):
 *   root        /home/sun/.hermes/skills   (== realpath of /home/sun/.agents/skills)
 *   identity    canonical realpath of each SKILL.md, so one file reached via two
 *               roots counts ONCE (this is what makes the symlink alias legal)
 *   include     every SKILL.md at any depth reachable without following a
 *               skill directory further down
 *   skip        nothing — this is the RAW tree, before the plugin's own
 *               includeHidden / maxDepth filters
 *   name        the `name:` scalar in the opening frontmatter block
 *   category    path segments between the root and the skill directory
 *
 * The plugin's own filters (includeHidden=false, maxDepth=4) are then applied
 * separately, and BOTH numbers are reported so nobody has to guess which one a
 * later sentence meant.
 */
import { readdirSync, statSync, readFileSync, realpathSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { runRealProvider } from '../lib/real-provider.mjs'

const USER_ROOT = '/home/sun/.hermes/skills'
const ALIAS_ROOT = '/home/sun/.agents/skills'

export const meta = { id: 'scale', requirement: 'F1 + F4', title: 'real-tree denominators, recomputed with a stated口径' }

export async function run(report) {
  if (!existsSync(USER_ROOT)) {
    report.blocked(`the user skill root ${USER_ROOT} does not exist on this machine`)
  }

  // ---- 1. raw filesystem census -------------------------------------------
  const raw = walkSkillFiles(USER_ROOT)
  const canonical = [...new Set(raw.map((entry) => entry.canonical))]
  report.observe('raw SKILL.md files (path count)', raw.length)
  report.observe('unique by realpath', canonical.length)
  report.observe('raw skill directory names', new Set(raw.map((e) => e.name)).size)

  report.check('alias resolves to the same directory (F4.4 precondition)', realpathSync(ALIAS_ROOT), realpathSync(USER_ROOT))

  // ---- 2. the plugin's own view, via the real provider --------------------
  const configured = await runRealProvider(
    [ALIAS_ROOT, USER_ROOT, '/home/sun/.dsh/skills'],
    { maxDepth: 4, includeHidden: false, duplicatePolicy: 'first-wins' },
    report,
  )
  report.observe('provider config口径', 'roots=[.agents,.hermes,.dsh] maxDepth=4 includeHidden=false policy=first-wins')
  report.observe('provider skills', configured.skills.length)
  report.observe('provider unique names', configured.uniqueNames)
  report.observe('provider conflicts', configured.duplicates.length)
  report.observe('provider conflict names', configured.duplicates.map((d) => d.name))
  report.observe('provider root errors', configured.errors.length)
  report.observe('provider categories', configured.categories.length)

  // Why the two censuses differ: hidden dirs, depth, and name-level dedupe.
  // Printed, not assumed, so a future tree change shows up as a changed
  // explanation rather than a silently wrong number.
  const hiddenExcluded = raw.filter((entry) => entry.segments.slice(0, -1).some((seg) => seg.startsWith('.')))
  const tooDeep = raw.filter((entry) => entry.segments.length - 1 > 4)
  // A conflict merges N files into ONE candidate, so files != candidates.
  const mergedByConflict = configured.duplicates.reduce((sum, d) => sum + (d.paths.length - 1), 0)
  report.observe('excluded by includeHidden=false', hiddenExcluded.length)
  report.observe('excluded by maxDepth=4', tooDeep.length)
  report.observe('files merged into one candidate by name conflicts', mergedByConflict)
  report.observe(
    'hidden dirs seen',
    [...new Set(hiddenExcluded.flatMap((e) => e.segments.filter((s) => s.startsWith('.'))))],
  )

  report.check(
    'the explanation accounts for the whole gap (files - excluded - merged = candidates)',
    raw.length - hiddenExcluded.length - tooDeep.length - mergedByConflict,
    configured.skills.length,
  )

  // ---- 3. category counting is口径-DEPENDENT: state it, do not assume ------
  //
  // This machine yields "24 categories" under two DIFFERENT conventions that
  // happen to share a cardinality but do NOT contain the same members:
  //   (a) immediate-parent basename, the algorithm in skill-nesting/test/realtree.mjs
  //       -> buckets depth-1 skills under a pseudo-category "skills", and
  //          collapses mlops/{evaluation,inference,models,research} into four
  //          standalone names that lose their "mlops" prefix
  //   (b) full relative category path
  //       -> keeps mlops/evaluation distinct, but drops the depth-1 pseudo-bucket
  // Both are 24. Same number, different set — which is exactly why the number
  // alone must never be quoted without its口径.
  const immediateParent = new Set(
    raw
      .filter((entry) => !entry.segments.slice(0, -1).some((s) => s.startsWith('.')))
      .map((entry) => (entry.segments.length > 1 ? entry.segments[entry.segments.length - 2] : '(root)')),
  )
  const fullPath = new Set(configured.categories)
  report.observe('category conventions (a) immediate-parent basename', [...immediateParent].sort().join(', '))
  report.observe('category conventions (b) full relative path', [...fullPath].sort().join(', '))
  report.observe('convention (a) count', immediateParent.size)
  report.observe('convention (b) count', fullPath.size)
  report.observe(
    'members present in (a) but not (b)',
    [...immediateParent].filter((c) => !fullPath.has(c)).sort(),
  )
  report.observe(
    'members present in (b) but not (a)',
    [...fullPath].filter((c) => !immediateParent.has(c)).sort(),
  )

  // ---- 3. the assertions that matter for the requirement ------------------
  report.assert(
    'F1: nested discovery finds a substantial tree (not 0, not only the depth-1 skills)',
    configured.skills.length > 100,
    `${configured.skills.length} skills`,
  )
  report.assert(
    'F1: dedupe by file identity means the symlink alias contributes no duplicates',
    configured.duplicates.length === 0 || configured.duplicates.every((d) => d.paths.every((p) => !p.includes('/.agents/'))),
    `conflicts=${JSON.stringify(configured.duplicates.map((d) => d.name))}`,
  )
  report.assert(
    'F4.4: no conflict is reported between the alias root and the real root',
    !configured.duplicates.some(
      (d) =>
        d.paths.some((p) => p.includes('/.agents/')) && d.paths.some((p) => p.includes('/.hermes/')),
    ),
    `conflicts=${JSON.stringify(configured.duplicates)}`,
  )

  // State the denominator explicitly for acceptance.md to quote verbatim.
  report.observe(
    'DENOMINATOR (quote this)',
    `${configured.skills.length} skills / ${configured.categories.length} categories / ${configured.duplicates.length} conflict(s); ` +
      `raw census ${raw.length} SKILL.md (${canonical.length} unique realpaths); ` +
      `口径 roots=[.agents→.hermes, .hermes, .dsh] maxDepth=4 includeHidden=false`,
  )
}

/** Recursively collect SKILL.md files, identity = realpath. */
function walkSkillFiles(root, depth = 0, segments = []) {
  const out = []
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  const hasSkill = entries.some((e) => e.name === 'SKILL.md' && e.isFile())
  if (hasSkill && segments.length > 0) {
    const path = join(root, 'SKILL.md')
    out.push({ path, canonical: realpathSync(path), name: segments[segments.length - 1], segments, depth })
    return out
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    let child = join(root, entry.name)
    let real = child
    try {
      real = realpathSync(child)
    } catch {
      continue
    }
    if (real === root) continue
    out.push(...walkSkillFiles(child, depth + 1, [...segments, entry.name]))
  }
  return out
}