/**
 * Verify the watcher invalidates the registry when a nested SKILL.md changes,
 * and that a settings change re-watches a newly added root.
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../lib/index.js'
import { makeFsService, makeCtx, skillFile } from './harness.mjs'

const root = await mkdtemp(join(tmpdir(), 'skillwatch-'))
const root2 = await mkdtemp(join(tmpdir(), 'skillwatch2-'))
await mkdir(join(root, 'cat', 'skill-a'), { recursive: true })
await writeFile(join(root, 'cat', 'skill-a', 'SKILL.md'), skillFile('skill-a'))

const results = []
const check = (label, ok) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`) }

// ── 1. filesystem change invalidates and is observed ──────────────────────
{
  const harness = makeCtx(makeFsService())
  apply(harness.ctx, { roots: root, watchDebounceMs: 50 })
  const { provider, control } = harness.captured
  const before = (await provider.list()).map((c) => c.name)

  await mkdir(join(root, 'cat', 'skill-b'), { recursive: true })
  await writeFile(join(root, 'cat', 'skill-b', 'SKILL.md'), skillFile('skill-b'))
  await new Promise((r) => setTimeout(r, 900))

  const after = (await provider.list()).map((c) => c.name)
  check('watcher invalidates the catalog', control.invalidated > 0)
  check('new nested skill appears', after.includes('skill-b'))
  check('existing skill is retained', before.includes('skill-a') && after.includes('skill-a'))
}

// ─ 2. a settings change re-watches a NEW root ────────────────────────────
// The initial watch set is empty; after the settings source adds a root, an
// edit under that root must still be observed. This is what `reconcile` exists
// for — without it the watcher would be stuck on the old root set.
{
  const base = {
    roots: [], maxDepth: 4, rank: 300, includeHidden: false, includeFlatRootFiles: true,
    watch: true, watchDebounceMs: 50, duplicatePolicy: 'first-wins', providerName: 'nested-filesystem',
  }
  let resolved = base
  let onChange = () => {}
  const settings = {
    installSection: (_owner, _ns, _schema, _entry, hooks) => {
      hooks.setSource(() => resolved)
      onChange = hooks.onChange
    },
  }
  const harness = makeCtx(makeFsService(), { settings: { settings } })
  await mkdir(join(root2, 'cat', 'late-skill'), { recursive: true })
  await writeFile(join(root2, 'cat', 'late-skill', 'SKILL.md'), skillFile('late-skill'))

  apply(harness.ctx, base)
  const { provider, control } = harness.captured
  check('starts with no skills', (await provider.list()).length === 0)

  resolved = { ...base, roots: [root2] }
  onChange()
  check('settings-added root is discovered', (await provider.list()).some((c) => c.name === 'late-skill'))

  const before = control.invalidated
  await mkdir(join(root2, 'cat', 'later-skill'), { recursive: true })
  await writeFile(join(root2, 'cat', 'later-skill', 'SKILL.md'), skillFile('later-skill'))
  await new Promise((r) => setTimeout(r, 900))

  check('newly added root is actually watched', control.invalidated > before)
  check('late edit is visible', (await provider.list()).some((c) => c.name === 'later-skill'))
}

await rm(root, { recursive: true, force: true })
await rm(root2, { recursive: true, force: true })

const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)