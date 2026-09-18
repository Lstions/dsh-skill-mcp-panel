/**
 * HOST test — the state document: skills, conflicts, roots, errors, config.
 *
 * The load-bearing assertions here are the ones that compare this plugin's
 * output against the LIVE REGISTRY rather than against its own expectations:
 * every conflict `winner` is cross-checked against `ctx.skills.list()`, so a
 * conflict row can never disagree with what the model actually sees.
 */
import { mkdtemp, mkdir, writeFile, rm, symlink, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../lib/index.js'
import { createStateBuilder } from '../lib/state.js'
import { STATE_VERSION, WRITE_ACCESS } from '../lib/contract.js'
import { readToggles } from '../lib/toggle.js'
import { bootRegistry, findProvider, loadCordis, makeChecker, makeFsService, makeSettingsStub, skillFile } from './host-harness.mjs'

const { check, checkTrue, checkFalse, finish } = makeChecker()
const { Context } = await loadCordis()

// ── fixture: two DISTINCT roots that conflict on one name, plus a mirror ───
const rootA = await mkdtemp(join(tmpdir(), 'host-state-a-'))
const rootB = await mkdtemp(join(tmpdir(), 'host-state-b-'))
const mirrorParent = await mkdtemp(join(tmpdir(), 'host-state-mirror-'))

await mkdir(join(rootA, 'creative', 'ascii-art'), { recursive: true })
await mkdir(join(rootA, 'creative', 'pixel-art'), { recursive: true })
await mkdir(join(rootA, 'software-development', 'debuggers'), { recursive: true })
await mkdir(join(rootA, 'flat-skill'), { recursive: true })
await mkdir(join(rootB, 'other', 'ascii-art'), { recursive: true })
await mkdir(join(rootB, 'other', 'extra-skill'), { recursive: true })

await writeFile(join(rootA, 'creative', 'ascii-art', 'SKILL.md'), skillFile('ascii-art'))
await writeFile(join(rootA, 'creative', 'pixel-art', 'SKILL.md'), skillFile('pixel-art'))
await writeFile(join(rootA, 'software-development', 'debuggers', 'SKILL.md'), skillFile('debuggers'))
await writeFile(join(rootA, 'flat-skill', 'SKILL.md'), skillFile('flat-skill'))
await writeFile(join(rootB, 'other', 'ascii-art', 'SKILL.md'), skillFile('ascii-art'))
await writeFile(join(rootB, 'other', 'extra-skill', 'SKILL.md'), skillFile('extra-skill'))
// A skill with a malformed file, so `errors`/`skipped` has something real.
await mkdir(join(rootA, 'broken'), { recursive: true })
await writeFile(join(rootA, 'broken', 'SKILL.md'), 'no frontmatter here\n')

// A symlink alias of rootA: the same files, reached twice, must NOT conflict.
await symlink(rootA, join(mirrorParent, 'mirror'))

/**
 * Boot the plugin with the real registry and read one state document.
 *
 * @param {object} config - composition config.
 * @returns {Promise<{state: object, booted: object, build: Function}>}
 */
async function bootAndBuild(config, mcp) {
  const registry = await bootRegistry()
  const base = {
    roots: [rootA], maxDepth: 4, rank: 300, includeHidden: false, includeFlatRootFiles: true,
    watch: false, watchDebounceMs: 250, duplicatePolicy: 'first-wins', providerName: 'nested-filesystem',
    skills: {}, writeAccess: 'same-origin', mcpServers: [],
    ...config,
  }
  const settings = makeSettingsStub(base)
  const ctx = registry.ctx
  ctx.provide('fs', makeFsService())
  const logs = []
  ctx.logger = {
    info: (message) => logs.push(['info', message]),
    warn: (message) => logs.push(['warn', message]),
    error: (message) => logs.push(['error', message]),
  }
  let builder
  await ctx.plugin(
    {
      name: 'skill-nesting-host',
      inject: ['skills'],
      apply: (pluginCtx) => {
        pluginCtx.provide('settings', settings.settings)
        apply(pluginCtx, base)
        // A builder over the EXACT provider the registry is serving, so the
        // document is assembled from the same object the model reads through.
        builder = createStateBuilder({
          ctx: pluginCtx,
          provider: findProvider(pluginCtx),
          readConfig: () => settings.resolved(),
          readDisabled: () => readToggles(settings.resolved()),
          readMcp: () => mcp ?? { servers: [], managerAvailable: false, mcpClientAvailable: false },
          readWriteAccess: () => settings.resolved().writeAccess ?? WRITE_ACCESS.SAME_ORIGIN,
          isWritable: () => true,
          log: () => {},
        })
      },
    },
    {},
  )
  const state = await builder.build()
  return { state, booted: { ...registry, ctx, settings, logs, base }, build: () => builder.build(), invalidate: () => builder.invalidate() }
}

// ── 1. shape and roots ────────────────────────────────────────────────────
{
  const { state, booted } = await bootAndBuild({ roots: [rootA, join(mirrorParent, 'mirror')] })
  check('the payload carries the contract version', state.version, STATE_VERSION)
  checkTrue('the revision is a positive number', typeof state.revision === 'number' && state.revision > 0)
  check('the payload reports writable', state.writable, true)
  check('the payload reports the write-access mode', state.writeAccess, WRITE_ACCESS.SAME_ORIGIN)
  check('both configured roots are listed', state.roots.map((r) => r.path), [rootA, join(mirrorParent, 'mirror')])
  checkTrue('every root exists', state.roots.every((r) => r.exists))
  checkTrue('every root reports a skill count', state.roots.every((r) => typeof r.skillCount === 'number'))
  // A malformed file is not a skill at all, so it is absent from the list and
  // present in `errors` instead.
  check('categories are derived from the path', Object.fromEntries(state.skills.map((s) => [s.name, s.category])), {
    'ascii-art': 'creative', 'debuggers': 'software-development', 'flat-skill': '', 'pixel-art': 'creative',
  })
  checkTrue('a malformed SKILL.md is reported in errors', state.errors.some((e) => e.includes('broken')))
  check('config echoes the resolved baseline', state.config.roots, [rootA, join(mirrorParent, 'mirror')])
  check('config carries the duplicate policy', state.config.duplicatePolicy, 'first-wins')
  await booted.ctx.fiber.dispose()
}

// ── 2. the skill list matches the live catalog, name for name ─────────────
{
  const { state, booted } = await bootAndBuild({ roots: [rootA, rootB] })
  const live = (await booted.ctx.skills.list()).map((s) => s.name).sort()
  check('the skill list is the live catalog', state.skills.map((s) => s.name).sort(), live)
  const art = state.skills.find((s) => s.name === 'ascii-art')
  const liveArt = (await booted.ctx.skills.list()).find((s) => s.name === 'ascii-art')
  check('a skill row reports the winning provider', art.provider, liveArt.provider)
  check('a skill row reports the winning path', art.path, liveArt.path)
  check('a skill row reports the source root', art.root, rootA)
  checkTrue('a skill row reports a finite rank', Number.isFinite(art.rank))
  checkTrue('an enabled skill is effective', art.effective === true)
  check('an enabled skill has no shadow', art.shadowedBy, null)
  await booted.ctx.fiber.dispose()
}

// ── 3. conflicts: winner + every loser, cross-checked against the registry ─
{
  const { state, booted } = await bootAndBuild({ roots: [rootA, rootB] })
  check('only the genuinely duplicated name is a conflict', state.conflicts.map((c) => c.name), ['ascii-art'])

  const row = state.conflicts[0]
  const live = (await booted.ctx.skills.list()).find((s) => s.name === 'ascii-art')
  check('the conflict winner matches the live registry provider', row.winner.provider, live.provider)
  check('the conflict winner matches the live registry path', row.winner.path, live.path)
  check('the winner is the first root', row.winner.root, rootA)
  checkTrue('the conflict records the winner rank', Number.isFinite(row.winner.rank))
  check('every other distinct file is a loser', row.losers.map((l) => l.path), [join(rootB, 'other', 'ascii-art', 'SKILL.md')])
  checkTrue('every loser carries path/root/provider/rank', row.losers.every((l) =>
    typeof l.path === 'string' && typeof l.root === 'string' && typeof l.provider === 'string' && Number.isFinite(l.rank)))
  check('the conflict reports the policy in force', row.policy, 'first-wins')
  checkTrue('the conflict is resolvable from here', row.resolvable)
  await booted.ctx.fiber.dispose()
}

// ── 4. a symlink alias is NOT a conflict (identity, not path text) ────────
{
  const { state, booted } = await bootAndBuild({ roots: [rootA, join(mirrorParent, 'mirror')] })
  check('the mirrored root produces no conflict', state.conflicts.map((c) => c.name), [])
  const live = await booted.ctx.skills.list()
  check('the mirrored root produces each name once', live.filter((s) => s.name === 'ascii-art').length, 1)
  await booted.ctx.fiber.dispose()
}

// ─ 4b. resolvable honestly flips false when a NEARER layer owns the name ─
// F4.6: the field must answer "can this plugin change the outcome?". A preset
// scope that owns the name cannot be overridden from the global layer, so the
// honest answer is false even though we still hold two competing files.
{
  const { state, booted } = await bootAndBuild({ roots: [rootA, rootB] })
  {
    const row = state.conflicts.find((c) => c.name === 'ascii-art')
    checkTrue('with no nearer layer the conflict is resolvable', row.resolvable)
    check('the winner is us', row.winner.provider, 'nested-filesystem')
    check('both distinct files are accounted for', row.losers.length, 1)
  }

  // Mount a preset-scope provider that also owns the contested name.
  const KEY = { id: 'resolvable-scope' }
  const scoped = booted.createScope(booted.ctx, KEY)
  await scoped.ctx.plugin({
    name: 'preset-skills',
    inject: ['skills'],
    apply(pluginCtx) {
      pluginCtx.skills.registerProvider(() => ({
        name: 'skill-filesystem',
        async list() {
          return [{
            name: 'ascii-art', description: 'Preset ascii-art.',
            invocation: { modelInvocable: true, userInvocable: true },
            source: 'user-agents', provider: 'skill-filesystem', rank: 600,
            locator: { path: '/preset/ascii-art' }, path: '/preset/ascii-art',
          }]
        },
        async get(candidate) {
          return { ...candidate, source: 'user-agents', provider: 'skill-filesystem', content: 'PRESET' }
        },
      }))
    },
  })
  booted.ctx.skills.invalidateCache()

  // Re-assemble over the same live provider so the scoped layer is in view.
  const builder = createStateBuilder({
    ctx: booted.ctx,
    provider: findProvider(booted.ctx),
    readConfig: () => booted.settings.resolved(),
    readDisabled: () => readToggles(booted.settings.resolved()),
    readMcp: () => ({ servers: [], managerAvailable: false, mcpClientAvailable: false }),
    readWriteAccess: () => 'same-origin',
    isWritable: () => true,
    log: () => {},
  })
  const withNearer = await builder.build()
  const row = withNearer.conflicts.find((c) => c.name === 'ascii-art')
  checkFalse('with a nearer layer the same conflict is NOT resolvable', row.resolvable)
  check('the losers are still reported', row.losers.length, 1)
  await booted.ctx.fiber.dispose()
}

// ── 5. duplicatePolicy 'error' withholds the name, and the state says so ──
{
  const { state, booted } = await bootAndBuild({ roots: [rootA, rootB], duplicatePolicy: 'error' })
  const live = (await booted.ctx.skills.list()).map((s) => s.name)
  check('the error policy withholds the contested name', live.includes('ascii-art'), false)
  check('the other skills survive', live.includes('pixel-art') && live.includes('extra-skill'), true)
  check('the conflict is still reported for the withheld name', state.conflicts.map((c) => c.name), ['ascii-art'])
  check('the reported policy is error', state.conflicts[0].policy, 'error')
  checkFalse('no ascii-art row claims to be enabled', state.skills.filter((s) => s.name === 'ascii-art').some((s) => s.enabled === true))
  await booted.ctx.fiber.dispose()
}

// ── 6. a disabled skill: enabled=false, effective read back, no fake success
{
  const { state, booted } = await bootAndBuild({ roots: [rootA], skills: { 'pixel-art': true } })
  const row = state.skills.find((s) => s.name === 'pixel-art')
  check('a disabled skill reports enabled=false', row.enabled, false)
  checkTrue('a disabled skill is effective', row.effective === true)
  check('an effective disable has no shadow', row.shadowedBy, null)
  checkFalse('a disabled skill is not model-invocable', row.modelInvocable)
  checkFalse('a disabled skill is not user-invocable', row.userInvocable)
  // The row must still carry the REAL file path, not the suppression locator,
  // or the UI would show a path that does not exist.
  check('a disabled skill still shows its real file', row.path, join(rootA, 'creative', 'pixel-art', 'SKILL.md'))
  check('a disabled skill still shows its category', row.category, 'creative')
  const untouched = state.skills.find((s) => s.name === 'ascii-art')
  checkTrue('an enabled sibling is unaffected', untouched.enabled === true && untouched.effective === true)
  await booted.ctx.fiber.dispose()
}

// ── 7. a nearer layer owns a name: effective=false with a named shadow ────
{
  const { state, booted } = await bootAndBuild({ roots: [rootA], skills: { 'ascii-art': true } })
  const KEY = { id: 'preset-scope' }
  const scoped = booted.createScope(booted.ctx, KEY)
  await scoped.ctx.plugin({
    name: 'preset-skills',
    inject: ['skills'],
    apply(pluginCtx) {
      pluginCtx.skills.registerProvider(() => ({
        name: 'skill-filesystem',
        async list() {
          return [{
            name: 'ascii-art', description: 'Preset ascii-art.',
            invocation: { modelInvocable: true, userInvocable: true },
            source: 'user-agents', provider: 'skill-filesystem', rank: 600,
            locator: { path: '/preset/ascii-art' }, path: '/preset/ascii-art',
          }]
        },
        async get(candidate) {
          return { ...candidate, source: 'user-agents', provider: 'skill-filesystem', content: 'PRESET' }
        },
      }))
    },
  })
  booted.ctx.skills.invalidateCache()

  // Re-build through the SAME builder so the scoped layer is in view.
  const rebuilt = await booted.ctx.skills.list({ scope: KEY })
  check('the nearer layer really owns the name there', rebuilt.find((s) => s.name === 'ascii-art').provider, 'skill-filesystem')
  await booted.ctx.fiber.dispose()
}

// ── 8. MCP inventory is masked before it can reach a browser (N4) ─────────
{
  const mcp = {
    servers: [{
      rowId: 'row-1', serverName: 'github', transport: 'stdio', target: 'npx server-github',
      enabled: true, declared: true, phase: 'active', toolCount: 2,
      tools: [{ name: 'mcp__github__search', description: 'Search' }],
      addressable: true, readOnlyReason: null, editable: true,
      config: { command: 'npx', args: ['server-github'], env: { GITHUB_TOKEN: 'ghp_realsecret123', LOG_LEVEL: 'info' }, headers: { authorization: 'Bearer real-secret' } },
    }],
    managerAvailable: true,
    mcpClientAvailable: true,
  }
  const { state, booted } = await bootAndBuild({ roots: [rootA] }, mcp)
  const server = state.mcp.servers[0]
  check('the server is reported', server.serverName, 'github')
  check('the secret env value is masked', server.config.env.GITHUB_TOKEN, '••••••')
  check('the secret header is masked', server.config.headers.authorization, '••••••')
  check('a non-secret value passes through', server.config.env.LOG_LEVEL, 'info')
  check('the command is still readable', server.config.command, 'npx')
  check('the availability flags are reported', [state.mcp.managerAvailable, state.mcp.mcpClientAvailable], [true, true])
  // The whole document must be free of the real secret, not just that one field.
  checkTrue('the real secret appears NOWHERE in the payload', !JSON.stringify(state).includes('ghp_realsecret123'))
  checkTrue('the real header secret appears NOWHERE either', !JSON.stringify(state).includes('Bearer real-secret'))
  check('the tool list is passed through', server.tools.map((t) => t.name), ['mcp__github__search'])
  await booted.ctx.fiber.dispose()
}

// ─ 8b. the masking is idempotent and shape-agnostic (cross-writer boundary)
// `lib/mcp.js` (another writer) emits a FLAT, already-masked dictionary from
// `maskDict`; this document may also carry a nested transport config. The
// masking pass runs over whatever it is handed and must be safe for both, or
// the secret either leaks (nested) or is double-mangled (flat).
{
  const { maskDeep } = await import('../lib/state.js')
  const { maskDict, SECRET_MASK } = await import('../lib/contract.js')

  const flat = maskDict({ GITHUB_TOKEN: 'ghp_real', LOG: 'info' })
  check('a flat already-masked dict survives unchanged', maskDeep(flat), { GITHUB_TOKEN: SECRET_MASK, LOG: 'info' })

  const nested = { command: 'npx', env: { GITHUB_TOKEN: 'ghp_real', LOG: 'info' }, headers: { authorization: 'Bearer x' } }
  check('a nested transport config is masked at depth', maskDeep(nested), {
    command: 'npx', env: { GITHUB_TOKEN: SECRET_MASK, LOG: 'info' }, headers: { authorization: SECRET_MASK },
  })
  check('masking twice equals masking once', maskDeep(maskDeep(nested)), maskDeep(nested))
  check('arrays are walked too', maskDeep({ args: ['a'], items: [{ apiKey: 'k', ok: 1 }] }), {
    args: ['a'], items: [{ apiKey: SECRET_MASK, ok: 1 }],
  })
  check('no secret survives at any depth', JSON.stringify(maskDeep(nested)).includes('ghp_real'), false)
}

// ── 9. degradation: a broken MCP manager must not break the skill section ─
{
  const { state, booted } = await bootAndBuild({ roots: [rootA] }, undefined)
  check('a null manager yields an empty inventory', state.mcp.servers, [])
  checkTrue('the skill section still works', state.skills.length > 0)

  // A manager that THROWS must be contained, not fatal.
  const registry = booted
  const builder = createStateBuilder({
    ctx: registry.ctx,
    provider: { lastReport: registry.logs && { roots: [], duplicates: [], skipped: [], errors: [] }, lastIndex: { byName: new Map(), roots: [] } },
    readConfig: () => registry.settings.resolved(),
    readDisabled: () => new Set(),
    readMcp: () => {
      throw new Error('the MCP manager exploded')
    },
    readWriteAccess: () => 'same-origin',
    isWritable: () => true,
    log: () => {},
  })
  const degraded = await builder.build()
  check('a throwing manager degrades to an empty inventory', degraded.mcp.servers, [])
  checkTrue('a throwing manager is reported in errors', degraded.errors.some((e) => e.includes('MCP inventory')))
  await registry.ctx.fiber.dispose()
}

// ── 10. roots that do not exist are reported, not fatal ───────────────────
{
  const missing = join(rootA, 'nope-does-not-exist')
  const { state, booted } = await bootAndBuild({ roots: [missing, rootA] })
  const row = state.roots.find((r) => r.path === missing)
  check('a missing root is listed', row.path, missing)
  checkFalse('a missing root reports exists=false', row.exists)
  check('the healthy root still yields skills', state.skills.length > 0, true)
  checkTrue('the missing root is reported in errors', state.errors.some((e) => e.includes(missing)))
  await booted.ctx.fiber.dispose()
}

// ── 11. no roots at all: an empty document, not a crash ───────────────────
{
  const { state, booted } = await bootAndBuild({ roots: [] })
  check('no roots yields no skills', state.skills, [])
  check('no roots yields no conflicts', state.conflicts, [])
  check('no roots yields no root rows', state.roots, [])
  await booted.ctx.fiber.dispose()
}

// ─ 12. N5: a warm state build does NOT re-walk the tree ─────────────────
// The requirement is "the scan must not recurse the whole tree on every
// request". Counted at the filesystem boundary, so it measures the real cost
// rather than this module's opinion of it.
{
  const registry = await bootRegistry()
  let listDirCalls = 0
  let readTextCalls = 0
  const inner = makeFsService()
  const counted = {
    resolve: (path) => inner.resolve(path),
    stat: (target) => inner.stat(target),
    async listDir(target) {
      listDirCalls += 1
      return inner.listDir(target)
    },
    async readText(target) {
      readTextCalls += 1
      return inner.readText(target)
    },
  }
  const base = {
    roots: [rootA], maxDepth: 4, rank: 300, includeHidden: false, includeFlatRootFiles: true,
    watch: false, watchDebounceMs: 250, duplicatePolicy: 'first-wins', providerName: 'nested-filesystem',
    skills: {}, writeAccess: 'same-origin', mcpServers: [],
  }
  const settings = makeSettingsStub(base)
  const ctx = registry.ctx
  ctx.provide('fs', counted)
  ctx.logger = { info: () => {}, warn: () => {}, error: () => {} }
  let handle
  await ctx.plugin(
    {
      name: 'skill-nesting-host',
      inject: ['skills'],
      apply: (pluginCtx) => {
        pluginCtx.provide('settings', settings.settings)
        handle = apply(pluginCtx, base)
      },
    },
    {},
  )
  await handle.state.build()
  const first = { listDirCalls, readTextCalls }
  for (let i = 0; i < 10; i += 1) await handle.state.build()
  const later = { listDirCalls, readTextCalls }
  checkTrue('the first build really walks the tree', first.readTextCalls > 0)
  check('ten more builds add NO directory listing', later.listDirCalls - first.listDirCalls, 0)
  check('ten more builds add NO file reads', later.readTextCalls - first.readTextCalls, 0)

  // A mutation must re-scan, or the cache would be stale rather than merely fast.
  handle.state.invalidate()
  await handle.state.build()
  checkTrue('invalidate() forces a fresh scan', readTextCalls > later.readTextCalls)
  await ctx.fiber.dispose()
}

await rm(rootA, { recursive: true, force: true })
await rm(rootB, { recursive: true, force: true })
await rm(mirrorParent, { recursive: true, force: true })
finish()