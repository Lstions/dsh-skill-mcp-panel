/**
 * Boot the REAL Cordis context with the REAL skill registry, so verification
 * never depends on a hand-rolled fake that could agree with a wrong
 * implementation.
 *
 * The store path carries a pnpm hash and changes on reinstall, so every package
 * is discovered by glob. Nothing here is hard-coded to one hash.
 */
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const STORE = '/home/sun/.local/share/pnpm/global/v11'

/** Find a pnpm store package dir by name, newest store entry first. */
function findPackage(name) {
  if (!existsSync(STORE)) throw new Error(`pnpm store missing: ${STORE}`)
  const stores = readdirSync(STORE).sort()
  for (const store of stores.reverse()) {
    const pnpmDir = join(STORE, store, 'node_modules', '.pnpm')
    if (!existsSync(pnpmDir)) continue
    const match = readdirSync(pnpmDir)
      .filter((entry) => entry.startsWith(`@deepseek-ai+${name}@`))
      .sort()
      // Prefer an entry whose peer set includes cordis, then the shortest name.
      .sort((a, b) => a.length - b.length)[0]
    if (match === undefined) continue
    const lib = join(pnpmDir, match, 'node_modules', '@deepseek-ai', name, 'lib', 'index.js')
    if (existsSync(lib)) return lib
  }
  throw new Error(`cannot locate @deepseek-ai/${name} in the pnpm store under ${STORE}`)
}

let cached

/** Load the real Cordis + skill + scope modules once. */
export async function loadReal() {
  if (cached !== undefined) return cached
  const cordis = await import(findPackage('cordis'))
  const skill = await import(findPackage('dsh-skill'))
  const scope = await import(findPackage('dsh-scope'))
  cached = { cordis, skill, scope, paths: { cordis: findPackage('cordis'), skill: findPackage('dsh-skill'), scope: findPackage('dsh-scope') } }
  return cached
}

/** Path of a real store package's lib entry, for reporting provenance. */
export function packagePath(name) {
  return findPackage(name)
}

/**
 * A live context carrying the real `skills` service.
 * @returns {{ctx: object, mod: object, dispose: Function}}
 */
export async function bootRealSkills() {
  const { cordis, skill, scope } = await loadReal()
  const ctx = new cordis.Context()
  ctx.plugin(skill.default ?? skill)
  await settle()
  const dispose = async () => {
    try {
      await ctx.fiber?.dispose?.()
    } catch {}
  }
  return { ctx, mod: skill, scopeMod: scope, dispose }
}

/**
 * Register a provider that publishes exactly the given candidates.
 *
 * A candidate's OWN `provider` field is left alone when the candidate sets one:
 * the registry asserts that a returned candidate's provider matches the
 * registering provider, so silently overwriting it would both hide a genuine
 * mismatch and let two providers be simulated from one registration.
 */
export function registerProvider(ctx, name, candidates) {
  ctx.skills.registerProvider(() => ({
    name,
    async list() {
      return candidates.map((c) => (c.provider === undefined ? { ...c, provider: name } : { ...c }))
    },
    async get(candidate_) {
      const found = candidates.find((c) => c.name === candidate_.name)
      if (found === undefined) return undefined
      return { ...found, provider: found.provider ?? name, content: found.content ?? `body of ${found.name}` }
    },
  }))
}

/** Build one registry candidate. */
export function candidate(name, options = {}) {
  return {
    name,
    description: options.description ?? `Description for ${name}.`,
    invocation: options.invocation ?? { modelInvocable: true, userInvocable: true },
    source: options.source ?? 'custom',
    provider: options.provider,
    rank: options.rank ?? 300,
    path: options.path ?? `/tmp/verify/${name}/SKILL.md`,
    locator: options.locator ?? {},
    content: options.content,
  }
}

/** Let Cordis finish its async fiber work. */
export function settle(ms = 40) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Boot the REAL `skill` tool alongside the real registry, so "the model can no
 * longer load it" is measured by the actual consumer instead of by a
 * transcribed approximation.
 *
 * `dsh-tools` needs `systemPrompt`, and `dsh-tool-skill` needs `agents`; both
 * are stubbed narrowly, because neither participates in the decision under test.
 * @returns {{ctx: object, tools: object[], call: Function, dispose: Function}}
 */
export async function bootRealSkillTool() {
  const { cordis, skill } = await loadReal()
  const toolsMod = await import(findPackage('dsh-tools'))
  const toolSkillMod = await import(findPackage('dsh-tool-skill'))

  const ctx = new cordis.Context()
  ctx.provide('systemPrompt', { tools: () => {}, section: () => () => {} })
  ctx.provide('agents', { get: () => undefined, list: () => [], on: () => () => {} })
  ctx.plugin(skill.default ?? skill)
  ctx.plugin(toolsMod.default ?? toolsMod)
  await settle(90)
  ctx.plugin(toolSkillMod.default ?? toolSkillMod)
  await settle(260)

  const tool = ctx.tools.get('skill')
  if (tool === undefined) throw new Error('bootRealSkillTool: the real skill tool did not register')

  /** Invoke the real tool the way an agent turn would. */
  const call = async (name) => {
    try {
      const result = await tool.execute({ name }, { signal: undefined, agent: undefined })
      return { ok: true, message: `loaded body=${JSON.stringify(result.content)}` }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  }

  const dispose = async () => {
    try {
      await ctx.fiber?.dispose?.()
    } catch {}
  }
  return { ctx, tool, call, dispose }
}

/** The model-visible catalog, using the same predicate the real tool uses. */
export async function modelVisibleCatalog(ctx, options = {}) {
  const summaries = await ctx.skills.list(options)
  return summaries.filter((s) => s.invocation?.modelInvocable === true).map((s) => s.name)
}

/** Mint a child scope the way a preset composition owns its own layer. */
export function mintScope(ctx, scopeMod, key = { preset: 'verify' }) {
  return scopeMod.createScope(ctx, key, {})
}