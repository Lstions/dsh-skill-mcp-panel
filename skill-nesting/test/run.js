/**
 * Offline test for dsh-skill-nesting.
 *
 * Runs the real provider against a fake Cordis context backed by node:fs, so
 * discovery, parsing, dedupe, duplicate policy and config validation are
 * verified without booting dsh.
 */
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../lib/index.js'
import { makeFsService, makeCtx, skillFile, makeChecker } from './harness.mjs'

const { results, check } = makeChecker()

/** Apply the plugin and return the registered provider plus its context. */
function boot(config, options = {}) {
  const harness = makeCtx(makeFsService(), options)
  apply(harness.ctx, config)
  return { harness, provider: harness.captured.provider, control: harness.captured.control }
}

const names = async (provider) => (await provider.list()).map((c) => c.name).sort()

// ── fixture tree ───────────────────────────────────────────────────────────
const root = await mkdtemp(join(tmpdir(), 'skillnest-'))
const second = await mkdtemp(join(tmpdir(), 'skillnest2-'))

await mkdir(join(root, 'creative', 'ascii-art'), { recursive: true })
await mkdir(join(root, 'creative', 'pixel-art'), { recursive: true })
await mkdir(join(root, 'software-development', 'debuggers'), { recursive: true })
await mkdir(join(root, 'mlops', 'models', 'audiocraft'), { recursive: true })
await mkdir(join(root, 'flat-skill'), { recursive: true })
await mkdir(join(root, '.archive', 'hidden-skill'), { recursive: true })
await mkdir(join(second, 'other', 'extra-skill'), { recursive: true })

await writeFile(join(root, 'creative', 'ascii-art', 'SKILL.md'), skillFile('ascii-art'))
await writeFile(join(root, 'creative', 'pixel-art', 'SKILL.md'), skillFile('pixel-art'))
await writeFile(join(root, 'software-development', 'debuggers', 'SKILL.md'), skillFile('debuggers'))
await writeFile(join(root, 'mlops', 'models', 'audiocraft', 'SKILL.md'), skillFile('audiocraft'))
await writeFile(join(root, 'flat-skill', 'SKILL.md'), skillFile('flat-skill'))
await writeFile(join(root, 'loose.md'), skillFile('loose-skill'))
await writeFile(join(root, 'DESCRIPTION.md'), '---\ndescription: category metadata\n---\n')
await writeFile(join(root, '.archive', 'hidden-skill', 'SKILL.md'), skillFile('hidden-skill'))
await writeFile(join(second, 'other', 'extra-skill', 'SKILL.md'), skillFile('extra-skill'))

// A skill's bundled resources must never be mistaken for skills.
await mkdir(join(root, 'creative', 'ascii-art', 'references'), { recursive: true })
await writeFile(join(root, 'creative', 'ascii-art', 'references', 'note.md'), '# not a skill\n')
await mkdir(join(root, 'creative', 'ascii-art', 'nested-dir'), { recursive: true })
await writeFile(join(root, 'creative', 'ascii-art', 'nested-dir', 'SKILL.md'), skillFile('should-not-appear'))

// Malformed / invalid / blocked skills.
await mkdir(join(root, 'broken-skill'), { recursive: true })
await writeFile(join(root, 'broken-skill', 'SKILL.md'), 'no frontmatter here\n')
await mkdir(join(root, 'bad-name'), { recursive: true })
await writeFile(join(root, 'bad-name', 'SKILL.md'), skillFile('Bad_Name'))
await mkdir(join(root, 'blocked-skill'), { recursive: true })
await writeFile(join(root, 'blocked-skill', 'SKILL.md'), skillFile('blocked-skill', 'disable-model-invocation: true\n'))
await mkdir(join(root, 'blocked-user'), { recursive: true })
await writeFile(join(root, 'blocked-user', 'SKILL.md'), skillFile('blocked-user', 'user-invocable: false\n'))

// Block-scalar description.
await mkdir(join(root, 'block-scalar'), { recursive: true })
await writeFile(join(root, 'block-scalar', 'SKILL.md'), '---\nname: block-scalar\ndescription: |\n  First line\n  second line.\n---\n\nBody.\n')

// A genuine duplicate name across two DISTINCT roots.
await mkdir(join(second, 'other', 'ascii-art'), { recursive: true })
await writeFile(join(second, 'other', 'ascii-art', 'SKILL.md'), skillFile('ascii-art'))

// ─ 1. single root, default depth ─────────────────────────────────────────
const single = boot({ roots: root })
check('discovers nested skills at depth 2 and 3', await names(single.provider), [
  'ascii-art', 'audiocraft', 'block-scalar', 'blocked-user', 'debuggers', 'flat-skill', 'loose-skill', 'pixel-art',
])
check('skips .archive hidden dir by default', (await names(single.provider)).includes('hidden-skill'), false)
check('does not descend into a skill dir', (await names(single.provider)).includes('should-not-appear'), false)
check('ignores malformed frontmatter', (await names(single.provider)).includes('broken-skill'), false)
check('ignores invalid skill name', (await names(single.provider)).includes('Bad_Name'), false)
check('excludes model-blocked skill', (await names(single.provider)).includes('blocked-skill'), false)
check('keeps user-blocked but model-visible skill', (await names(single.provider)).includes('blocked-user'), true)
check(
  'folds block-scalar description',
  (await single.provider.list()).find((c) => c.name === 'block-scalar').description,
  'First line second line.',
)

// ── 2. includeHidden ─────────────────────────────────────────────────────
check('includeHidden descends into dot dirs', (await names(boot({ roots: root, includeHidden: true }).provider)).includes('hidden-skill'), true)

// ─ 3. multi-root: first-wins (default) ───────────────────────────────────
const multi = boot({ roots: [root, second] })
const multiCandidates = await multi.provider.list()
check('merges a second root', (await names(multi.provider)).includes('extra-skill'), true)
check('first-wins keeps exactly one entry per name', multiCandidates.filter((c) => c.name === 'ascii-art').length, 1)
check(
  'first-wins keeps the first root path',
  multiCandidates.find((c) => c.name === 'ascii-art').locator.path.startsWith(root),
  true,
)
check('first-wins reports the duplicate', multi.provider.lastReport.duplicates.map((d) => d.name), ['ascii-art'])
check('duplicate record lists every competing path', multi.provider.lastReport.duplicates[0].paths.length, 2)

// ── 4. duplicatePolicy: error withholds the name ──────────────────────────
const strict = boot({ roots: [root, second], duplicatePolicy: 'error' })
const strictNames = await names(strict.provider)
check('error policy withholds the conflicting name', strictNames.includes('ascii-art'), false)
check('error policy keeps non-conflicting skills', strictNames.includes('pixel-art') && strictNames.includes('extra-skill'), true)
check('error policy still reports the conflict', strict.provider.lastReport.duplicates.map((d) => d.name), ['ascii-art'])

// ── 5. overlapping roots are NOT duplicates (identity, not path text) ─────
// A symlinked alias of the same root reaches the identical files; realpath
// identity must collapse them instead of reporting every skill as duplicated.
const aliasRoot = await mkdtemp(join(tmpdir(), 'skillnest-alias-'))
await symlink(root, join(aliasRoot, 'alias'))
const overlapping = boot({ roots: [root, join(aliasRoot, 'alias')] })
const overlappingNames = await names(overlapping.provider)
check('symlinked alias does not duplicate names', overlapping.provider.lastReport.duplicates.length, 0)
check('symlinked alias still yields every skill once', overlappingNames.filter((n) => n === 'ascii-art').length, 1)

// ── 6. depth limiting ─────────────────────────────────────────────────────
const depth1 = await names(boot({ roots: root, maxDepth: 1 }).provider)
check('maxDepth 1 finds direct-child skills', depth1.includes('flat-skill'), true)
check('maxDepth 1 excludes depth-2 skills', depth1.includes('ascii-art'), false)

// ── 7. get() round-trip ───────────────────────────────────────────────────
const art = (await single.provider.list()).find((c) => c.name === 'ascii-art')
const full = await single.provider.get(art)
check('get returns the body', full.content.startsWith('# ascii-art'), true)
check('get exposes resourceBase', full.resourceBase, { kind: 'directory', path: join(root, 'creative', 'ascii-art') })
check('get reports provider name', full.provider, 'nested-filesystem')
check('get reports source', full.source, 'custom')

// ── 8. missing root is not fatal ─────────────────────────────────────────
const missing = boot({ roots: [join(root, 'does-not-exist'), second] })
check('missing root is skipped, others still load', await names(missing.provider), ['ascii-art', 'extra-skill'])

// ── 9. no roots configured ────────────────────────────────────────────────
const empty = boot({})
check('no roots warns and registers nothing', empty.harness.logs.some(([level]) => level === 'warn'), true)

// ── 10. symlinked category follows ────────────────────────────────────────
const linked = await mkdtemp(join(tmpdir(), 'skillnest3-'))
await mkdir(join(linked, 'categories'), { recursive: true })
await symlink(join(root, 'creative'), join(linked, 'categories', 'creative'))
await writeFile(join(linked, 'linked.md'), skillFile('linked-skill'))
check('follows a symlinked category', (await names(boot({ roots: linked }).provider)).includes('ascii-art'), true)

// ── 11. config validation ─────────────────────────────────────────────────
function configError(config) {
  try {
    boot(config)
    return undefined
  } catch (error) {
    return error.message
  }
}
check('rejects a negative maxDepth', /maxDepth/.test(configError({ roots: root, maxDepth: 0 }) ?? ''), true)
check('rejects a non-boolean watch', /watch/.test(configError({ roots: root, watch: 'yes' }) ?? ''), true)
check('rejects a non-string providerName', /providerName/.test(configError({ roots: root, providerName: 7 }) ?? ''), true)
check('rejects an unknown duplicatePolicy', /duplicatePolicy/.test(configError({ roots: root, duplicatePolicy: 'nope' }) ?? ''), true)
check('accepts a bare string root', configError({ roots: '/tmp' }), undefined)
check('accepts an empty config without throwing', configError({}), undefined)

// ── 12. settings override reaches the live provider ───────────────────────
// `installSection`'s `setSource` is the plugin's sink: the settings service
// hands it a getter, and later signals changes through `onChange`. This mock
// models exactly that, so the seam the Settings card writes through is real.
{
  const baseConfig = {
    roots: [], maxDepth: 4, rank: 300, includeHidden: false, includeFlatRootFiles: true,
    watch: false, watchDebounceMs: 250, duplicatePolicy: 'first-wins', providerName: 'nested-filesystem',
  }
  let resolved = baseConfig
  let onChange = () => {}
  const settings = {
    installSection: (_owner, _ns, _schema, _base, hooks) => {
      // The service hands the plugin a getter; the plugin calls it to resolve
      // the live value, so `onChange` is what makes a new value visible.
      hooks.setSource(() => resolved)
      onChange = hooks.onChange
    },
  }
  const harness = makeCtx(makeFsService(), { settings: { settings } })
  apply(harness.ctx, { roots: [] })
  const provider = harness.captured.provider
  check('settings source starts empty', (await provider.list()).length, 0)
  resolved = { ...baseConfig, roots: [root] }
  onChange()
  check('settings override moves live discovery', (await provider.list()).length > 0, true)
}

await rm(root, { recursive: true, force: true })
await rm(second, { recursive: true, force: true })
await rm(linked, { recursive: true, force: true })
await rm(aliasRoot, { recursive: true, force: true })

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)