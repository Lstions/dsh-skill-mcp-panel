/**
 * HOST test — skill enable/disable against the REAL `SkillRegistry`.
 *
 * WHY THE REAL REGISTRY
 * The behaviours under test are the registry's, not this plugin's beliefs about
 * them: layer priority, the `rank → providerOrder → localOrder` tie-break, and
 * the collect cache that makes `control.invalidate()` mandatory. A stub could
 * only confirm what the implementation already assumes.
 *
 * THE CASE THAT MATTERS MOST is "same-layer competitor": it is the one place
 * where WINNING the name (inert candidate) beats YIELDING it (omitting the
 * candidate), and therefore the one most likely to be "optimised" away by
 * somebody who reasons that a disabled skill should vanish from `list()`. It
 * must not.
 */
import { mkdtemp, mkdir, writeFile, rm, symlink, stat, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../lib/index.js'
import {
  INVOCATION_OFF,
  SUPPRESS_RANK,
  Suppressor,
  planToggle,
  readOne,
  readToggles,
  verifyDisabled,
  verifyEnabled,
} from '../lib/toggle.js'
import { bootRegistry, loadCordis, makeChecker, makeFsService, makeSettingsStub, skillFile } from './host-harness.mjs'

const { check, checkTrue, checkFalse, finish } = makeChecker()
const { Context } = await loadCordis()

// ── fixture: a categorised tree, so one skill is nested and one is flat ────
const root = await mkdtemp(join(tmpdir(), 'host-toggle-'))
await mkdir(join(root, 'creative', 'ascii-art'), { recursive: true })
await mkdir(join(root, 'creative', 'pixel-art'), { recursive: true })
await mkdir(join(root, 'flat-skill'), { recursive: true })
await writeFile(join(root, 'creative', 'ascii-art', 'SKILL.md'), skillFile('ascii-art'))
await writeFile(join(root, 'creative', 'pixel-art', 'SKILL.md'), skillFile('pixel-art'))
await writeFile(join(root, 'flat-skill', 'SKILL.md'), skillFile('flat-skill'))

/** Where the plugin's real provider sits relative to a competing provider. */
const OUR_RANK = 300
const COMPETITOR_RANK = 500

/**
 * Boot the real registry with this plugin mounted, plus the settings stub.
 *
 * @param {object} [config] - composition config.
 * @returns {Promise<object>} the live pieces a test needs.
 */
async function boot(config = {}) {
  const registry = await bootRegistry()
  const base = {
    roots: [root], maxDepth: 4, rank: OUR_RANK, includeHidden: false, includeFlatRootFiles: true,
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
  await ctx.plugin(
    {
      name: 'skill-mcp-panel-host',
      inject: ['skills'],
      apply: (pluginCtx) => {
        pluginCtx.provide('settings', settings.settings)
        apply(pluginCtx, base)
      },
    },
    {},
  )
  return { ...registry, ctx, settings, logs, base }
}

/** Names in the merged catalog, in registry order. */
const namesOf = async (ctx, scope) => (await ctx.skills.list(scope === undefined ? {} : { scope })).map((s) => s.name)

/** Apply a settings write the way an HTTP toggle does, then invalidate caches. */
async function toggle(booted, name, enabled) {
  const disabled = readToggles(booted.settings.resolved())
  const plan = planToggle(disabled, name, enabled)
  if (plan.changed) booted.settings.write([plan.op])
  return plan
}

// ── 1. suppression mechanics on a name only this plugin owns ──────────────
{
  const booted = await boot()
  check('every fixture skill is discovered', await namesOf(booted.ctx), ['ascii-art', 'flat-skill', 'pixel-art'])
  const before = await readOne(booted.ctx, 'ascii-art')
  checkTrue('before: ascii-art is served by us', before.provider === 'nested-filesystem' && before.modelInvocable)

  await toggle(booted, 'ascii-art', false)

  const after = await readOne(booted.ctx, 'ascii-art')
  // THE NAME IS EXPECTED TO REMAIN. Judging the toggle by its absence from
  // `list()` would be the wrong test — it is carried by our suppression
  // candidate with both invocation flags false.
  checkTrue('after: the name stays in the catalog (won by us, not yielded)', after.present)
  check('after: the winner is our provider', after.provider, 'nested-filesystem')
  checkFalse('after: modelInvocable is false', after.modelInvocable)
  checkFalse('after: userInvocable is false', after.userInvocable)

  const modelView = (await booted.ctx.skills.list()).filter((s) => booted.isModelInvocable(s)).map((s) => s.name)
  check('after: the MODEL catalog no longer offers it', modelView, ['flat-skill', 'pixel-art'])
  const userView = (await booted.ctx.skills.list()).filter((s) => booted.isUserInvocable(s)).map((s) => s.name)
  check('after: the USER catalog no longer offers it', userView, ['flat-skill', 'pixel-art'])

  check('after: loading the body answers undefined', await booted.ctx.skills.get('ascii-art'), undefined)
  check('after: the other two are untouched', await namesOf(booted.ctx), ['ascii-art', 'flat-skill', 'pixel-art'])

  const verdict = (await verifyDisabled({ ctx: booted.ctx, names: ['ascii-art'], providerName: 'nested-filesystem' })).get('ascii-art')
  checkTrue('after: the read-back verdict is effective', verdict.effective)
  check('after: nothing shadows it', verdict.shadowedBy, null)

  // ── restore ────────────────────────────────────────────────────────────
  await toggle(booted, 'ascii-art', true)
  const restored = await readOne(booted.ctx, 'ascii-art')
  checkTrue('restored: served by us again', restored.provider === 'nested-filesystem')
  checkTrue('restored: modelInvocable is true again', restored.modelInvocable)
  checkTrue('restored: userInvocable is true again', restored.userInvocable)
  const body = await booted.ctx.skills.get('ascii-art')
  checkTrue('restored: the body loads again', typeof body?.content === 'string' && body.content.includes('# ascii-art'))
  check('restored: the model catalog is complete again', (await booted.ctx.skills.list()).filter((s) => booted.isModelInvocable(s)).map((s) => s.name), ['ascii-art', 'flat-skill', 'pixel-art'])

  await booted.ctx.fiber.dispose()
}

// ── 2. THE DECISIVE CASE: a same-layer competitor also serves the name ────
// Yielding the name (omitting our candidate) would hand it straight to the
// competitor, which then serves the skill the user believes is off. Winning the
// name is the ONLY strategy that suppresses it. This case is the guard.
{
  const booted = await boot()
  booted.ctx.skills.registerProvider(() => ({
    name: 'same-layer-competitor',
    async list() {
      return [{
        name: 'ascii-art',
        description: 'Competing ascii-art.',
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'custom',
        provider: 'same-layer-competitor',
        rank: COMPETITOR_RANK,
        locator: { path: '/competitor/ascii-art' },
        path: '/competitor/ascii-art',
      }]
    },
    async get(candidate) {
      return {
        name: candidate.name, description: candidate.description, invocation: candidate.invocation,
        source: 'custom', provider: 'same-layer-competitor', content: 'COMPETITOR BODY',
      }
    },
  }))
  booted.ctx.skills.invalidateCache()

  const baseline = await booted.ctx.skills.list()
  check('competitor baseline: we win the name on rank', baseline.find((s) => s.name === 'ascii-art').provider, 'nested-filesystem')

  await toggle(booted, 'ascii-art', false)

  const row = (await booted.ctx.skills.list()).find((s) => s.name === 'ascii-art')
  check('competitor present: the winner is STILL us (not the competitor)', row.provider, 'nested-filesystem')
  checkFalse('competitor present: the model cannot invoke it', row.invocation.modelInvocable)
  const modelView = (await booted.ctx.skills.list()).filter((s) => booted.isModelInvocable(s)).map((s) => s.name)
  check('competitor present: the MODEL catalog still hides it', modelView.includes('ascii-art'), false)
  check('competitor present: the body is unavailable', await booted.ctx.skills.get('ascii-art'), undefined)

  await booted.ctx.fiber.dispose()
}

// ── 3. a NEARER layer cannot be suppressed — reported, never faked ────────
{
  const booted = await boot()
  const KEY = { id: 'preset-standard' }
  const scoped = booted.createScope(booted.ctx, KEY)
  await scoped.ctx.plugin({
    name: 'preset-skills',
    inject: ['skills'],
    apply(pluginCtx) {
      pluginCtx.skills.registerProvider(() => ({
        name: 'skill-filesystem',
        async list() {
          return [{
            name: 'ascii-art',
            description: 'Preset ascii-art.',
            invocation: { modelInvocable: true, userInvocable: true },
            source: 'user-agents',
            provider: 'skill-filesystem',
            rank: 500,
            locator: { path: '/preset/ascii-art' },
            path: '/preset/ascii-art',
          }]
        },
        async get(candidate) {
          return {
            name: candidate.name, description: candidate.description, invocation: candidate.invocation,
            source: 'user-agents', provider: 'skill-filesystem', content: 'PRESET BODY',
          }
        },
      }))
    },
  })
  booted.ctx.skills.invalidateCache()

  const scopedBefore = (await booted.ctx.skills.list({ scope: KEY })).find((s) => s.name === 'ascii-art')
  check('nearer layer wins the name outright, despite our lower rank', scopedBefore.provider, 'skill-filesystem')

  await toggle(booted, 'ascii-art', false)

  const host = await readOne(booted.ctx, 'ascii-art')
  checkTrue('host view: our suppression won the global layer', host.provider === 'nested-filesystem' && !host.modelInvocable)
  const scopeView = await readOne(booted.ctx, 'ascii-art', KEY)
  check('nearer view: the preset provider still serves it', scopeView.provider, 'skill-filesystem')
  checkTrue('nearer view: it is STILL model-invocable there', scopeView.modelInvocable)

  const verdict = (await verifyDisabled({ ctx: booted.ctx, names: ['ascii-art'], providerName: 'nested-filesystem' })).get('ascii-art')
  checkFalse('verdict: effective is FALSE — the toggle did not take effect', verdict.effective)
  check('verdict: shadowedBy names the real owner', verdict.shadowedBy, 'skill-filesystem')
  checkTrue('verdict: the name is still present', verdict.present)

  const body = await booted.ctx.skills.get('ascii-art', { scope: KEY })
  check('nearer view: the preset body is still loadable', body.content, 'PRESET BODY')

  await booted.ctx.fiber.dispose()
}

// ─ 4. a toggle NEVER touches the skill file (md5 + mtime) ────────────────
{
  const booted = await boot()
  const file = join(root, 'creative', 'ascii-art', 'SKILL.md')
  const digest = async () => createHash('md5').update(await readFile(file)).digest('hex')
  const before = { md5: await digest(), mtimeMs: (await stat(file)).mtimeMs }

  await toggle(booted, 'ascii-art', false)
  await readOne(booted.ctx, 'ascii-art')
  await toggle(booted, 'ascii-art', true)
  await toggle(booted, 'pixel-art', false)

  const after = { md5: await digest(), mtimeMs: (await stat(file)).mtimeMs }
  check('the SKILL.md md5 is unchanged by a toggle', after.md5, before.md5)
  check('the SKILL.md mtime is unchanged by a toggle', after.mtimeMs, before.mtimeMs)

  await booted.ctx.fiber.dispose()
}

// ── 5. invalidation is what makes a toggle visible (the mandatory call) ───
// Without `control.invalidate()` the registry serves its memoised catalog and a
// toggle appears to do nothing. This case proves the dependency is real, so a
// future refactor that drops the call cannot pass by accident.
{
  const registry = await bootRegistry()

  // A minimal provider whose output is switched without invalidating.
  let off = false
  const control = { current: undefined }
  registry.ctx.skills.registerProvider((registration) => {
    control.current = registration
    return {
      name: 'switcher',
      async list() {
        return [{
          name: 'thing',
          description: 'Thing.',
          invocation: off ? { ...INVOCATION_OFF } : { modelInvocable: true, userInvocable: true },
          source: 'custom', provider: 'switcher', rank: SUPPRESS_RANK, locator: { path: '/thing' }, path: '/thing',
        }]
      },
      async get() {
        return undefined
      },
    }
  })
  checkTrue('invalidation probe: the name starts model-invocable', (await registry.ctx.skills.list())[0].invocation.modelInvocable)

  off = true
  checkTrue(
    'invalidation probe: WITHOUT invalidate the catalog is stale (this is the trap)',
    (await registry.ctx.skills.list())[0].invocation.modelInvocable === true,
  )
  control.current.invalidate()
  checkFalse(
    'invalidation probe: WITH invalidate the new policy is visible',
    (await registry.ctx.skills.list())[0].invocation.modelInvocable,
  )

  await registry.ctx.fiber.dispose()
}

// ── 6. unit-level contract of the suppressor and the toggle table ─────────
{
  const suppressor = new Suppressor({ providerName: 'nested-filesystem' })
  suppressor.set(['b-skill', 'a-skill'], new Map([['a-skill', { description: 'Real A.', path: '/a/SKILL.md', category: 'cat' }]]))
  const candidates = suppressor.candidates()
  check('suppressor emits one candidate per disabled name, sorted', candidates.map((c) => c.name), ['a-skill', 'b-skill'])
  check('suppressor rank wins the same-layer competition', candidates.every((c) => c.rank === SUPPRESS_RANK), true)
  check('suppressor candidates are model- and user-invisible', candidates.map((c) => c.invocation), [INVOCATION_OFF, INVOCATION_OFF])
  check('suppressor reuses the real description', candidates[0].description, 'Disabled in skill-mcp-panel: Real A.')
  check('suppressor invents a description for an unknown name', candidates[1].description, 'Disabled in skill-mcp-panel.')
  check('suppressor keeps the real path for display', candidates[0].path, '/a/SKILL.md')
  checkTrue('suppressor knows what it omits', suppressor.omits({ name: 'a-skill' }))

  check('readToggles ignores a malformed table', [...readToggles({ skills: 'nope' })], [])
  check('readToggles ignores null', [...readToggles({ skills: null })], [])
  check('readToggles reads only true entries', [...readToggles({ skills: { a: true, b: false, c: true } })], ['a', 'c'])

  check('planToggle disables by setting the key', planToggle(new Set(), 'x', false).op, { op: 'set', path: ['skills', 'x'], value: true })
  check('planToggle enables by UNSETTING the key', planToggle(new Set(['x']), 'x', true).op, { op: 'unset', path: ['skills', 'x'] })
  checkFalse('planToggle reports no change when already disabled', planToggle(new Set(['x']), 'x', false).changed)
  checkFalse('planToggle reports no change when already enabled', planToggle(new Set(), 'x', true).changed)
}

// ── 7. two roots that are the same directory are ONE skill, not a conflict ─
{
  const alias = await mkdtemp(join(tmpdir(), 'host-alias-'))
  await symlink(root, join(alias, 'mirror'))
  const booted = await boot({ roots: [root, join(alias, 'mirror')] })
  check('symlink alias yields each name exactly once', await namesOf(booted.ctx), ['ascii-art', 'flat-skill', 'pixel-art'])
  checkTrue('no duplicate is reported for the mirrored root', (booted.logs.filter(([level, m]) => level === 'warn' && m.includes('duplicated')).length) === 0)
  await booted.ctx.fiber.dispose()
  await rm(alias, { recursive: true, force: true })
}

await rm(root, { recursive: true, force: true })
finish()