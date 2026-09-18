/**
 * Shared harness for the HOST-side tests (`test/host-*.mjs`).
 *
 * Two things here are deliberate and load-bearing:
 *
 * 1. THE REAL `SkillRegistry` IS USED, NOT A STUB. Suppression, layer priority,
 *    `rank → providerOrder → localOrder` ordering and the collect cache are the
 *    exact behaviours under test; a stub would only test this plugin's beliefs
 *    about them. The registry is resolved from the live deployment because the
 *    profile's `node_modules` symlinks point into a pnpm store that has been
 *    pruned, so a bare specifier cannot resolve from this package.
 *
 * 2. THE REAL `ctx.fs` SEMANTICS ARE MODELLED, NOT FAKED AWAY. `targetKey` is
 *    the realpath, which is what makes the symlink-alias rule testable.
 *
 * @module test/host-harness
 */
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Every pnpm global store on this machine, newest first. */
function stores() {
  const root = join(process.env.HOME ?? '/home/sun', '.local/share/pnpm/global/v11')
  if (!existsSync(root)) return []
  return readdirSync(root)
    .map((name) => join(root, name, 'node_modules/.pnpm'))
    .filter((path) => existsSync(path))
}

/**
 * Resolve one `@deepseek-ai/dsh-*` package from the live deployment.
 *
 * Tries, in order: a normal bare import (works when the package is a real
 * dependency), the profile's `node_modules`, then every pnpm store on the
 * machine. Throws with the paths it looked in, so a failure is diagnosable
 * rather than mysterious.
 *
 * @param {string} specifier - e.g. `@deepseek-ai/dsh-skill`.
 * @param {string} [entry] - entry file below the package root.
 * @returns {Promise<object>} the imported module namespace.
 */
export async function loadDeploymentPackage(specifier, entry = 'lib/index.js') {
  const tried = []
  try {
    return await import(specifier)
  } catch (error) {
    tried.push(`${specifier} (bare): ${error.code ?? error.message}`)
  }

  const profileDirs = [
    join(process.env.DSH_PROFILE_DIR ?? join(process.env.HOME ?? '/home/sun', '.dsh/profiles/web')),
    join(process.env.HOME ?? '/home/sun', '.dsh/profiles'),
  ]
  const wanted = specifier.replace('@deepseek-ai/', '')
  for (const base of profileDirs) {
    const candidate = join(base, 'node_modules', specifier, entry)
    tried.push(candidate)
    if (existsSync(candidate)) return await import(pathToFileURL(candidate).href)
  }

  for (const store of stores()) {
    let entries = []
    try {
      entries = readdirSync(store)
    } catch {
      continue
    }
    const match = entries
      .filter((name) => name.startsWith(`@deepseek-ai+${wanted}@`))
      .sort()
      .pop()
    if (match === undefined) continue
    const candidate = join(store, match, 'node_modules', specifier, entry)
    tried.push(candidate)
    if (existsSync(candidate)) return await import(pathToFileURL(candidate).href)
  }

  throw new Error(`test harness could not resolve ${specifier}. Looked in:\n  ${tried.join('\n  ')}`)
}

/** Cordis itself resolves normally (it is a real dependency of this package). */
export async function loadCordis() {
  return await import('@deepseek-ai/cordis')
}

/**
 * Boot a REAL `SkillRegistry` on its own context.
 *
 * @returns {Promise<{ctx: object, isModelInvocable: Function, isUserInvocable: Function, createScope: Function}>}
 */
export async function bootRegistry() {
  const { Context } = await loadCordis()
  const skill = await loadDeploymentPackage('@deepseek-ai/dsh-skill')
  const Registry = skill.default ?? skill.SkillRegistry
  const scope = await loadDeploymentPackage('@deepseek-ai/dsh-scope')

  const ctx = new Context()
  await ctx.plugin(Registry, {})
  return {
    ctx,
    isModelInvocable: skill.isModelInvocable,
    isUserInvocable: skill.isUserInvocable,
    createScope: scope.createScope,
  }
}

/** A filesystem service backed by node:fs with realpath identity (the `ctx.fs` contract). */
export function makeFsService() {
  return {
    async resolve(path) {
      let key
      try {
        key = await realpath(path)
      } catch {
        key = path
      }
      return { targetKey: key, displayPath: path }
    },
    async stat(target) {
      try {
        const info = await stat(target.targetKey)
        return { type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other', version: 'v' }
      } catch {
        return undefined
      }
    },
    async listDir(target) {
      const entries = await readdir(target.targetKey, { withFileTypes: true })
      const out = []
      for (const entry of entries) {
        const path = join(target.targetKey, entry.name)
        let type = 'other'
        try {
          const info = await stat(path)
          type = info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other'
        } catch {}
        let key
        try {
          key = await realpath(path)
        } catch {
          key = path
        }
        out.push({ name: entry.name, type, target: { targetKey: key, displayPath: path } })
      }
      return out
    },
    async readText(target) {
      return await readFile(target.targetKey, 'utf8')
    },
  }
}

/**
 * A settings provider stub that models the REAL `installSection` seam: it hands
 * over a GETTER (never a sampled value) and notifies through `onChange`. This is
 * the trap the project was previously bitten by, so the harness reproduces it
 * exactly: writes land in `user`, `resolved` is re-derived, and only then does
 * `onChange` fire.
 *
 * @param {object} base - the composition base layer.
 * @returns {{settings: object, write: Function, resolved: Function, section: Function, update: Function}}
 */
export function makeSettingsStub(base) {
  let user = {}
  let resolved = { ...base }
  let hooks
  let revision = 0
  const settings = {
    writable: true,
    installSection(_owner, _ns, _schema, entry, sectionHooks) {
      hooks = sectionHooks
      resolved = { ...entry }
      revision += 1
      // The real service calls setSource BEFORE the matching onChange.
      hooks.setSource(() => resolved)
      hooks.onChange()
    },
    get: () => resolved,
    describe: () => [{ ns: 'skill-nesting', value: resolved, revision, user, base }],
    /** The real write path the plugin uses; `update`/`replace` are not needed here. */
    mutate: async (_ns, ops) => {
      applyWrite(ops)
      publish()
    },
  }
  /** Commit the write the way the real service does: resolve, then notify. */
  const publish = () => {
    resolved = { ...base, ...user }
    revision += 1
    hooks.onChange()
  }
  /** Apply path ops the way `applyPathOp` in the real service does. */
  const applyWrite = (ops) => {
    for (const op of ops) {
      const [head, ...rest] = op.path
      if (rest.length === 0) {
        if (op.op === 'set') user = { ...user, [head]: op.value }
        else {
          const { [head]: _drop, ...kept } = user
          user = kept
        }
        continue
      }
      const child = typeof user[head] === 'object' && user[head] !== null ? user[head] : {}
      const next = { ...child }
      const [sub, ...deeper] = rest
      if (deeper.length === 0) {
        if (op.op === 'set') next[sub] = op.value
        else delete next[sub]
      }
      user = { ...user, [head]: next }
    }
  }
  return {
    settings,
    /** Raw user section (what a persisted settings document would hold). */
    section: () => user,
    /** The resolved value the plugin reads through its retained getter. */
    resolved: () => resolved,
    /** Perform a settings write exactly like `settings.mutate(ns, ops)`. */
    write: (ops) => {
      applyWrite(ops)
      publish()
    },
  }
}

/** Collect pass/fail results without exiting, so a caller can summarize. */
export function makeChecker() {
  const results = []
  const check = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    results.push({ label, ok, actual, expected })
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${label}` +
        (ok ? '' : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`),
    )
    return ok
  }
  /** A boolean assertion with an explicit expectation, for readability. */
  const checkTrue = (label, actual) => check(label, actual, true)
  const checkFalse = (label, actual) => check(label, actual, false)
  const finish = () => {
    const failed = results.filter((result) => !result.ok)
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
    process.exit(failed.length === 0 ? 0 : 1)
  }
  return { results, check, checkTrue, checkFalse, finish }
}

/** Build one `SKILL.md` body. */
export function skillFile(name, extras = '') {
  return `---\nname: ${name}\ndescription: "Description for ${name}."\nversion: 1.0.0\nmetadata:\n  hermes:\n    tags: [a, b]\n${extras}---\n\n# ${name}\n\nBody of ${name}.\n`
}

export { here }

/**
 * Find a live provider by name in the registry's global layer.
 *
 * Used by the host tests to hand the EXACT provider the registry is serving to
 * the state builder, so the document under assertion is assembled from the same
 * object the model reads through — not from a second, separately configured
 * instance that could drift.
 *
 * @param {object} ctx - Cordis context.
 * @param {string} name - provider name.
 * @returns {object|undefined} the provider, when registered.
 */
export function findProvider(ctx, name = 'nested-filesystem') {
  const providers = ctx?.skills?.layers?.global?.providers
  if (providers === undefined) return undefined
  const entry = typeof providers.get === 'function' ? providers.get(name) : undefined
  return entry?.provider ?? entry
}