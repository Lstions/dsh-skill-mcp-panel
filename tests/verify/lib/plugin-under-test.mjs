/**
 * Bridge from the verification suite to the code under test.
 *
 * This module is the ONLY place that knows where the implementation lives, so
 * when a module is renamed the cases still read as requirement statements.
 *
 * Two rules keep this from producing false greens:
 *
 *   1. A missing module throws `Blocked`, never returns a stub. A stub would let
 *      every downstream assertion pass against nothing.
 *   2. A module that EXISTS but does not expose the expected entry point throws
 *      `Blocked` naming the exports it did find. That distinguishes "not built
 *      yet" from "built differently", and neither is silently a pass.
 *
 * The entry points below are pinned to the API devA actually shipped
 * (`lib/toggle.js`: Suppressor / verifyDisabled / judgeHidden / planToggle), and
 * the export list is printed on every load so a drift shows up in the raw
 * output instead of becoming a mysterious block.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Blocked } from './assert.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
// The plugin package IS the repository root: this file lives at
// <repo>/tests/verify/lib/, so three hops up is the repo, and `lib/` is direct.
const REPO = join(HERE, '..', '..', '..')
const LIB = join(REPO, 'lib')

function libPath(name) {
  return join(LIB, name)
}

/** Whether a lib module has landed. */
export function hasModule(name) {
  return existsSync(libPath(name))
}

/** Import one lib module, or Blocked when it does not exist. */
export async function loadLib(name, requirement) {
  const path = libPath(name)
  if (!existsSync(path)) {
    throw new Blocked(`${requirement}: skill-mcp-panel/lib/${name} does not exist yet (dev work in flight)`)
  }
  const module = await import(path)
  return module
}

/** Load lib/toggle.js and require its suppression entry points. */
export async function loadToggle(report) {
  const module = await loadLib('toggle.js', 'F3')
  report?.observe('toggle.js exports', Object.keys(module))
  const required = ['Suppressor', 'verifyDisabled', 'judgeHidden', 'readCatalog', 'readOne', 'discoverScopes']
  const missing = required.filter((name) => module[name] === undefined)
  if (missing.length > 0) {
    throw new Blocked(
      `F3: lib/toggle.js is missing ${missing.join(', ')} (found: ${Object.keys(module).join(', ')})`,
    )
  }
  return module
}

/** Load lib/state.js and require its builder factory. */
export async function loadState(report) {
  const module = await loadLib('state.js', 'F2/F4/F5')
  report?.observe('state.js exports', Object.keys(module))
  if (typeof module.createStateBuilder !== 'function') {
    throw new Blocked(
      `F2: lib/state.js exports no createStateBuilder (found: ${Object.keys(module).join(', ')})`,
    )
  }
  return module
}

/** Load lib/http.js and require its route factory. */
export async function loadHttp(report) {
  const module = await loadLib('http.js', 'N4')
  report?.observe('http.js exports', Object.keys(module))
  if (typeof module.createHttpRoutes !== 'function') {
    throw new Blocked(
      `N4: lib/http.js exports no createHttpRoutes (found: ${Object.keys(module).join(', ')})`,
    )
  }
  return module
}

/** Load lib/mcp.js and require the manager factory. */
export async function loadMcp(report) {
  const module = await loadLib('mcp.js', 'F5/F6')
  report?.observe('mcp.js exports', Object.keys(module))
  const factory = module.createMcpManager ?? module.createManager ?? module.default
  if (typeof factory !== 'function') {
    throw new Blocked(
      `F5/F6: lib/mcp.js exports no manager factory (found: ${Object.keys(module).join(', ')})`,
    )
  }
  return module
}

export function findStateBuilder(module) {
  for (const name of ['buildState', 'createState', 'describeState', 'buildDocument', 'state']) {
    if (typeof module?.[name] === 'function') return module[name]
  }
  return undefined
}

export function findRegistrar(module) {
  for (const name of [
    'registerHttp',
    'registerRoutes',
    'installHttp',
    'registerEndpoints',
    'createHttpRoutes',
    'mountHttp',
    'register',
  ]) {
    if (typeof module?.[name] === 'function') return module[name]
  }
  return undefined
}

/**
 * Wire the shipped `Suppressor` the way the plugin wires it.
 *
 * THE STRATEGY MATTERS, and only one of the two is correct:
 *
 *   INERT (what the plugin does)
 *     Publish a candidate that WINS the name with both invocation flags false.
 *     The rival is defeated, `get()` returns undefined, the model catalog drops
 *     it. The name REMAINS in `list()` carried by our candidate — that is the
 *     expected shape of a winning suppression, not a defect.
 *
 *   OMIT (WRONG — do not "simplify" into this)
 *     Publish nothing for the name. The candidate slot is CONCEDED, so any
 *     same-layer rival (the built-in `skill-filesystem`, on a real machine)
 *     immediately takes it over and serves the skill LIVE. The user believes
 *     the skill is off while the model still sees and loads it.
 *
 * Measured both ways against the real registry with a same-layer rival present
 * (tests/verify/evidence/probe-same-layer.mjs):
 *   INERT -> model sees [] , get() undefined   => close honored
 *   OMIT  -> model sees [x], get() = rival body => close silently ignored
 *
 * So this harness publishes `suppressor.candidates()` for disabled names
 * instead of filtering them out. An earlier version of this file filtered,
 * which made every case assert the harness's own wrong strategy rather than the
 * product's behaviour.
 *
 * @returns {Promise<{suppressor: object, toggle: Function, invalidate: Function}>}
 */
export async function makeSuppressor(ctx, toggle, providerName = 'nested-filesystem', registered = []) {
  const suppressor = new toggle.Suppressor({ providerName })
  ctx.skills.registerProvider(() => ({
    name: providerName,
    async list() {
      // Live candidates, minus any name being suppressed, PLUS the suppression
      // candidates that contest those names. Order is irrelevant: rank decides.
      const visible = registered.filter((candidate) => !suppressor.omits(candidate))
      const suppressions = suppressor.candidates()
      return [...visible, ...suppressions].map((candidate) => ({ ...candidate, provider: providerName }))
    },
    async get(candidate_) {
      // A suppressed name resolves to nothing, which is what makes the real
      // `skill` tool refuse it rather than serve the body.
      if (suppressor.omits(candidate_)) return undefined
      const found = registered.find((c) => c.name === candidate_.name)
      if (found === undefined) return undefined
      return { ...found, provider: providerName, content: found.content ?? `body of ${found.name}` }
    },
  }))
  await settle()
  return {
    suppressor,
    /** Names currently suppressed, for observation. */
    suppressed: () => [...suppressor.disabled],
    /** Disable or enable one name, then invalidate so the next read is fresh. */
    async toggle(name, enabled) {
      const next = new Set(suppressor.disabled)
      if (enabled === false) next.add(name)
      else next.delete(name)
      suppressor.set(next)
      // Without this the registry serves a cached collection and the change is
      // invisible — the exact假绿 the Lead hit on his first probe. The shipped
      // provider calls `control.invalidate()`; `invalidateCache()` is the same
      // cache bust reached from outside.
      if (typeof ctx.skills.invalidateCache === 'function') ctx.skills.invalidateCache()
      await settle(30)
    },
    invalidate: async () => {
      if (typeof ctx.skills.invalidateCache === 'function') ctx.skills.invalidateCache()
      await settle(20)
    },
  }
}

/**
 * Build the state document through the shipped factory and read its skills.
 *
 * The factory takes the same dependency bag `lib/index.js` supplies in
 * production, so the document under assertion is the real one.
 */
export async function readStateSkills(stateModule, ctx, report, overrides = {}) {
  if (typeof stateModule?.createStateBuilder !== 'function') {
    throw new Blocked(`F2: lib/state.js exports no createStateBuilder (found: ${Object.keys(stateModule ?? {}).join(', ')})`)
  }
  const builder = stateModule.createStateBuilder({
    ctx,
    provider: { name: 'nested-filesystem', lastReport: { roots: [], errors: [], duplicates: [] } },
    readConfig: () => ({ roots: [], maxDepth: 4, rank: 300, duplicatePolicy: 'first-wins' }),
    readDisabled: () => new Set(),
    readMcp: () => ({ servers: [], managerAvailable: false, mcpClientAvailable: false }),
    readWriteAccess: () => 'same-origin',
    isWritable: () => true,
    log: () => {},
    ...overrides,
  })
  const document = await builder.build()
  const skills = document?.skills
  if (!Array.isArray(skills)) {
    throw new Blocked(
      `F2: the state document has no skills array (got ${typeof skills}; keys=${JSON.stringify(Object.keys(document ?? {}))})`,
    )
  }
  report?.observe('state.revision', document.revision)
  report?.observe('state.errors', document.errors)
  return { state: document, skills }
}

/** Read one lib file's bytes, for hash comparisons outside the mutation case. */
export function libBytes(name) {
  return readFileSync(libPath(name))
}

function settle(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export { REPO, LIB }