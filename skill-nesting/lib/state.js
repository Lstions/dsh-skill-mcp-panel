/**
 * dsh-skill-nesting — assembly of the `StatePayload` the management page reads.
 *
 * THE ONE RULE THIS MODULE FOLLOWS
 * Everything a user could act on is READ BACK from the live registry, never
 * inferred from what this plugin intended to do. `effective`, `shadowedBy`, and
 * every conflict `winner` come from `ctx.skills.list()` and from the registry's
 * own layer tables. A plugin that published — or withheld — a candidate has
 * proved nothing; only the merged catalog is evidence.
 *
 * WHY THE READ-BACK IS NOT OPTIONAL
 * `SkillRegistry` merges `[global, ...scope chain]`: a NEARER layer wins a
 * duplicate name OUTRIGHT, before rank is ever consulted. A preset that mounts
 * its own `skill-filesystem` into its own scope therefore keeps serving a name
 * no matter how good our rank is. Reporting such a skill as "disabled" would be
 * a lie, so `shadowedBy` names the provider that still serves it.
 *
 * CACHING (N5)
 * The merged catalog is read FRESH on every build: correctness depends on it,
 * and the registry's own collect cache already makes it cheap. The LAYER
 * CANDIDATE ENUMERATION — which re-invokes every provider's `list()`, bypassing
 * the registry cache — is memoised per registry revision + config signature +
 * toggle signature, so a request never re-walks the tree.
 *
 * @module dsh-skill-nesting/state
 */

import { maskSecret, STATE_VERSION, WRITE_ACCESS } from './contract.js'
import { judgeHidden, readCatalog, discoverScopes, togglesSignature, SHADOW_UNNAMED } from './toggle.js'

/**
 * Mask a transport configuration at EVERY depth.
 *
 * The contract's `maskDict` masks the top level of a dictionary, which is
 * exactly right for a flat settings section but NOT for an MCP server config:
 * `{ env: { GITHUB_TOKEN } }` and `{ headers: { authorization } }` hide their
 * secrets one level down, and a top-level-only pass lets the real token reach
 * the browser. The key grammar stays the contract's own `maskSecret`, so there
 * is still one definition of what counts as secret.
 *
 * @param {unknown} value - any configuration value.
 * @param {number} [depth] - recursion guard.
 * @returns {unknown} the value, with every secret-bearing key masked.
 */
export function maskDeep(value, depth = 0) {
  if (depth > 8) return '…'
  if (Array.isArray(value)) return value.map((item) => maskDeep(item, depth + 1))
  if (value === null || typeof value !== 'object') return value
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    const masked = maskSecret(key, entry)
    out[key] = masked === entry ? maskDeep(entry, depth + 1) : masked
  }
  return out
}

/** Basename every skill definition file uses. */
const SKILL_FILE = 'SKILL.md'

/** Rank reported when a winning candidate's own rank cannot be observed. */
export const UNKNOWN_RANK = -1

/**
 * Split a skill file path against its configured root.
 *
 * @param {string} root - configured root path.
 * @param {string} filePath - absolute path of the `SKILL.md`.
 * @returns {{category: string, file: string, directory: string}}
 */
export function relativeTo(root, filePath) {
  if (typeof root !== 'string' || root === '' || typeof filePath !== 'string') {
    return { category: '', file: '', directory: '' }
  }
  const prefix = root.endsWith('/') ? root : `${root}/`
  if (!filePath.startsWith(prefix)) return { category: '', file: '', directory: '' }
  const parts = filePath.slice(prefix.length).split('/')
  const file = parts.pop() ?? ''
  const directory = parts.pop() ?? ''
  return { category: parts.join('/'), file, directory }
}

/**
 * The category of a discovered skill: the path between root and the skill's own
 * directory. `''` means the skill sits directly under the root.
 *
 * @param {string} root - configured root.
 * @param {string} filePath - absolute path of the `SKILL.md`.
 * @returns {string} category path, possibly empty.
 */
export function categoryOf(root, filePath) {
  const { category, file } = relativeTo(root, filePath)
  if (file !== SKILL_FILE) return ''
  return category
}

/**
 * Build the state document assembler.
 *
 * @param {object} deps
 * @param {object} deps.ctx - Cordis context.
 * @param {object} deps.provider - the nested skill provider (supplies `lastIndex`).
 * @param {() => object} deps.readConfig - resolved plugin config.
 * @param {() => Set<string>} deps.readDisabled - the live disable table.
 * @param {() => Promise<object>|object} deps.readMcp - MCP inventory.
 * @param {() => string} deps.readWriteAccess - effective {@link WRITE_ACCESS}.
 * @param {() => boolean} deps.isWritable - whether this host may write at all.
 * @param {(message: string) => void} [deps.log] - diagnostic sink.
 * @returns {{build: Function, invalidate: Function, stats: Function}}
 */
export function createStateBuilder(deps) {
  const { ctx, provider, readConfig, readDisabled, readMcp, readWriteAccess, isWritable } = deps
  const sink = typeof deps.log === 'function' ? deps.log : () => {}

  /** Monotonic host revision; echoed by the client and fenced on write. */
  let revision = 1
  /** Memoised layer enumeration: `{key, value}`. */
  let layerCache

  const bump = () => {
    revision += 1
  }

  /** Drop the memoised layer enumeration; called after every mutation. */
  function invalidate() {
    layerCache = undefined
    bump()
  }

  /** Signature of the discovery-relevant configuration (cache-key component). */
  function configSignature() {
    const config = readConfig()
    return JSON.stringify([
      config.providerName, config.roots, config.maxDepth, config.rank,
      config.includeHidden, config.includeFlatRootFiles, config.duplicatePolicy,
    ])
  }

  /**
   * Enumerate one registry layer's candidates.
   *
   * This re-invokes every provider's `list()`, so it is called only when the
   * memo key moves — never on the request path of a warm cache.
   *
   * @param {object} layer - a registry layer object.
   * @returns {Promise<object[]|undefined>} entries, or undefined when unavailable.
   */
  async function enumerateLayer(layer) {
    const registry = ctx.skills
    if (layer === undefined || typeof registry?.listLayerCandidates !== 'function') return undefined
    try {
      const collected = await registry.listLayerCandidates(layer, {})
      return collected?.entries ?? []
    } catch (error) {
      sink(`skill-nesting: could not enumerate a registry layer: ${String(error)}`)
      return undefined
    }
  }

  /**
   * Every candidate claiming one name in one enumerated layer, in the
   * registry's own precedence order (`rank → providerOrder → localOrder`).
   *
   * @param {object[]|undefined} entries - enumerated layer entries.
   * @param {string} name - skill name.
   * @returns {Array<{path: string, provider: string, rank: number, providerOrder: number, localOrder: number}>}
   */
  function rankCandidates(entries, name) {
    const out = []
    for (const entry of entries ?? []) {
      if (entry?.candidate?.name !== name) continue
      out.push({
        path: typeof entry.candidate.path === 'string' ? entry.candidate.path : '',
        provider: entry.provider?.name ?? entry.candidate.provider ?? '',
        rank: Number.isFinite(entry.candidate.rank) ? entry.candidate.rank : UNKNOWN_RANK,
        providerOrder: Number.isFinite(entry.providerOrder) ? entry.providerOrder : 0,
        localOrder: Number.isFinite(entry.localOrder) ? entry.localOrder : 0,
      })
    }
    out.sort((left, right) =>
      left.rank - right.rank || left.providerOrder - right.providerOrder || left.localOrder - right.localOrder)
    return out
  }

  /**
   * Enumerate every layer this process can see, memoised.
   * @returns {Promise<{global: object[]|undefined, scoped: Array<{key: object, entries: object[]|undefined}>}>}
   */
  async function collectLayers() {
    const cacheKey = `${ctx.skills?.revision ?? 0}|${configSignature()}|${togglesSignature(readDisabled())}|${revision}`
    if (layerCache !== undefined && layerCache.key === cacheKey) return layerCache.value

    const layers = ctx.skills?.layers
    const global = await enumerateLayer(layers?.global)
    const scoped = []
    for (const key of discoverScopes(ctx)) {
      const layer = typeof layers?.peek === 'function' ? layers.peek(key) : undefined
      if (layer === undefined) continue
      scoped.push({ key, entries: await enumerateLayer(layer) })
    }
    const value = { global, scoped }
    layerCache = { key: cacheKey, value }
    return value
  }

  /**
   * Build the complete state document.
   * @returns {Promise<object>} a {@link import('./contract.js').StatePayload}.
   */
  async function build() {
    const config = readConfig()
    const disabled = readDisabled()
    const errors = []

    // ── the merged catalog, read back fresh: the only source of truth ──────
    let catalog = new Map()
    try {
      catalog = await readCatalog(ctx, undefined)
    } catch (error) {
      errors.push(`the skill catalog could not be read: ${String(error)}`)
    }

    // Discovery diagnostics from the provider's most recent scan (F8.1).
    const report = provider?.lastReport ?? { roots: [], duplicates: [], skipped: [], errors: [] }
    for (const problem of report.errors ?? []) errors.push(`root ${problem.path}: ${problem.message}`)
    const skipped = report.skipped ?? []
    for (const path of skipped.slice(0, 20)) errors.push(`skipped unreadable or invalid skill file: ${path}`)
    if (skipped.length > 20) errors.push(`… and ${skipped.length - 20} more unreadable or invalid skill file(s)`)

    const index = provider?.lastIndex ?? { byName: new Map(), roots: [] }

    // ── layer enumeration: the winner's rank and cross-provider losers ─────
    const { global, scoped } = await collectLayers()

    // ── scope-aware verdicts: read back, never assumed ────────────────────
    const scopeVerdicts = new Map()
    if (disabled.size > 0) {
      const views = []
      for (const key of discoverScopes(ctx)) {
        try {
          views.push({ key, catalog: await readCatalog(ctx, key) })
        } catch {
          // An unreadable view is not evidence of anything; skip it.
        }
      }
      for (const name of disabled) {
        const host = judgeHidden({ catalog, name, providerName: config.providerName })
        let verdict = { effective: host.hidden, shadowedBy: host.hidden ? null : host.shadowedBy, provider: host.provider, present: host.present }
        for (const view of views) {
          const judge = judgeHidden({ catalog: view.catalog, name, providerName: config.providerName })
          if (judge.hidden) continue
          verdict = { effective: false, shadowedBy: judge.shadowedBy ?? 'nearer-layer', provider: judge.provider ?? verdict.provider, present: true }
          break
        }
        scopeVerdicts.set(name, verdict)
      }
    }

    // ── skills: the live catalog, plus disabled names it no longer holds ──
    const skills = []
    const seen = new Set()
    for (const [name, summary] of catalog) {
      seen.add(name)
      const own = index.byName?.get(name)
      const isDisabled = disabled.has(name)
      const verdict = scopeVerdicts.get(name)
      // A suppressed name is carried by OUR candidate, which has no real file
      // behind it — so the path shown must be the file the skill really lives
      // at, not the suppression locator.
      const path = own?.winner?.path
        ?? (summary.provider === config.providerName ? '' : (typeof summary.path === 'string' ? summary.path : ''))
      const root = own?.winner?.root ?? ''
      skills.push({
        name,
        description: own?.winner?.description
          ?? (typeof summary.description === 'string' ? summary.description : ''),
        path,
        root,
        category: own?.winner?.category ?? (root === '' ? '' : categoryOf(root, path)),
        enabled: !isDisabled,
        // Read back: suppressed only when the winner really is our suppression
        // candidate (same provider, both invocation flags false).
        effective: isDisabled ? verdict?.effective === true : true,
        shadowedBy: isDisabled && verdict?.effective !== true
          ? (verdict?.shadowedBy ?? summary.provider ?? SHADOW_UNNAMED)
          : null,
        modelInvocable: summary.invocation?.modelInvocable === true,
        userInvocable: summary.invocation?.userInvocable === true,
        provider: typeof summary.provider === 'string' ? summary.provider : '',
        rank: winnerRank({ name, path, global, index, summary }),
      })
    }
    // A disabled name the catalog no longer holds at all (the `error` policy
    // withheld it, or a root vanished) must still be listed so the toggle can
    // be flipped back.
    for (const name of disabled) {
      if (seen.has(name)) continue
      const winner = index.byName?.get(name)?.winner
      const verdict = scopeVerdicts.get(name)
      skills.push({
        name,
        description: winner?.description ?? '',
        path: winner?.path ?? '',
        root: winner?.root ?? '',
        category: winner?.category ?? '',
        enabled: false,
        effective: verdict?.effective === true,
        shadowedBy: verdict?.effective === true ? null : (verdict?.shadowedBy ?? null),
        modelInvocable: false,
        userInvocable: false,
        provider: winner?.provider ?? config.providerName,
        rank: winner?.rank ?? UNKNOWN_RANK,
      })
    }
    skills.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))

    // ── conflicts: names claimed by more than one DISTINCT file ──────────
    const conflicts = buildConflicts({ index, catalog, global, scoped, config })

    // ── roots ─────────────────────────────────────────────────────────────
    const roots = (index.roots ?? []).map((entry) => ({
      path: entry.path,
      exists: entry.exists === true,
      skillCount: entry.skillCount ?? 0,
    }))
    if (roots.length === 0) {
      for (const path of config.roots) roots.push({ path, exists: false, skillCount: 0 })
    }

    // ── mcp ───────────────────────────────────────────────────────────────
    let inventory = { servers: [], managerAvailable: false, mcpClientAvailable: false }
    try {
      inventory = await readMcp()
    } catch (error) {
      errors.push(`the MCP inventory could not be read: ${String(error)}`)
    }

    return {
      version: STATE_VERSION,
      revision,
      writable: isWritable() === true,
      writeAccess: readWriteAccess(),
      roots,
      skills,
      conflicts,
      errors,
      mcp: sanitiseMcp(inventory),
      config: publicConfig(config),
    }
  }

  /** Rank of the candidate that actually won a name, observed from the layer table. */
  function winnerRank({ name, path, global, index, summary }) {
    const observed = rankCandidates(global, name).find((candidate) => candidate.path === path)
    if (observed !== undefined) return observed.rank
    const own = index.byName?.get(name)?.entries?.find((candidate) => candidate.path === path)
    if (own !== undefined) return own.rank
    if (summary !== undefined && path === '') return UNKNOWN_RANK
    return UNKNOWN_RANK
  }

  /**
   * Build the conflict rows.
   *
   * A conflict is a name claimed by two or more DISTINCT files. Two roots that
   * are the same directory (`~/.agents/skills` is commonly a symlink to
   * `~/.hermes/skills`) reach the identical canonical file and are ONE
   * candidate, so they never appear here — that is the whole point of identity-
   * based dedupe. The winner is taken from the LIVE CATALOG rather than
   * recomputed, so the row cannot disagree with what the model actually sees.
   *
   * `resolvable` answers "can this plugin change the outcome?":
   *  - false when a NEARER layer owns the name (no rank or root order helps);
   *  - false when this plugin supplies no candidate for the name at all;
   *  - true otherwise, because `roots` order, `rank` and `duplicatePolicy` are
   *    all editable here.
   *
   * @returns {object[]} {@link import('./contract.js').ConflictRow} values.
   */
  function buildConflicts({ index, catalog, global, scoped, config }) {
    const rows = []
    for (const [name, entry] of index.byName ?? []) {
      // Distinct files this plugin discovered, deduped by canonical identity.
      const distinct = []
      for (const candidate of entry.entries ?? []) {
        if (!distinct.some((seenOne) => seenOne.canonical === candidate.canonical)) distinct.push(candidate)
      }

      const summary = catalog.get(name)
      const winnerPath = typeof summary?.path === 'string' ? summary.path : undefined
      const winnerIsOurs = winnerPath !== undefined && distinct.some((candidate) => candidate.path === winnerPath)

      // Cross-provider only: nothing of ours is involved and one file is not a conflict.
      if (distinct.length < 2 && winnerIsOurs) continue
      if (distinct.length < 2 && summary === undefined) continue
      if (distinct.length < 2 && !winnerIsOurs) {
        // One of ours lost to somebody else's single file: still a real conflict
        // worth showing, because two distinct files claim one name.
        if (winnerPath === undefined) continue
      }

      const winnerEntries = rankCandidates(global, name)
      const observedWinner = winnerEntries.find((candidate) => candidate.path === winnerPath) ?? winnerEntries[0]
      const winner = {
        path: winnerPath ?? distinct[0]?.path ?? '',
        root: distinct.find((candidate) => candidate.path === winnerPath)?.root ?? '',
        provider: (typeof summary?.provider === 'string' && summary.provider !== '' ? summary.provider : undefined)
          ?? observedWinner?.provider
          ?? config.providerName,
        rank: observedWinner?.rank ?? distinct[0]?.rank ?? UNKNOWN_RANK,
      }

      // Every other distinct file is a loser, ours first then other providers'.
      const losers = []
      const addLoser = (candidate) => {
        if (candidate.path === '' || candidate.path === winner.path) return
        if (losers.some((loser) => loser.path === candidate.path)) return
        losers.push(candidate)
      }
      for (const candidate of distinct) {
        addLoser({ path: candidate.path, root: candidate.root, provider: config.providerName, rank: candidate.rank })
      }
      for (const candidate of winnerEntries) {
        if (candidate.provider === config.providerName) continue
        const known = distinct.find((own) => own.path === candidate.path)
        addLoser({ path: candidate.path, root: known?.root ?? '', provider: candidate.provider, rank: candidate.rank })
      }
      if (winner.path === '' && losers.length === 0) continue

      // A nearer layer owning the name makes it unresolvable from here.
      let nearerLayerOwns = false
      for (const view of scoped) {
        for (const candidate of rankCandidates(view.entries, name)) {
          if (candidate.provider === winner.provider) continue
          nearerLayerOwns = true
        }
      }
      const resolvable = !nearerLayerOwns && distinct.length >= 1

      rows.push({ name, winner, losers, policy: config.duplicatePolicy, resolvable })
    }
    rows.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    return rows
  }

  /** Mask every secret in the MCP inventory before it can reach a browser (N4). */
  function sanitiseMcp(inventory) {
    const servers = Array.isArray(inventory?.servers) ? inventory.servers : []
    return {
      // `maskDeep`, not the contract's top-level `maskDict`: an MCP config hides
      // its secrets inside `env` / `headers`, one level below the dictionary the
      // contract's helper walks.
      servers: servers.map((server) => ({ ...server, config: maskDeep(server?.config) })),
      managerAvailable: inventory?.managerAvailable === true,
      mcpClientAvailable: inventory?.mcpClientAvailable === true,
    }
  }

  /** The subset of configuration the management page may display and rewrite. */
  function publicConfig(config) {
    return {
      providerName: config.providerName,
      roots: config.roots.slice(),
      maxDepth: config.maxDepth,
      rank: config.rank,
      includeHidden: config.includeHidden,
      includeFlatRootFiles: config.includeFlatRootFiles,
      watch: config.watch,
      watchDebounceMs: config.watchDebounceMs,
      duplicatePolicy: config.duplicatePolicy,
      writeAccess: config.writeAccess,
    }
  }

  return {
    build,
    invalidate,
    /** @returns {{revision: number}} current counters, for diagnostics and tests. */
    stats: () => ({ revision }),
  }
}

/**
 * Whether a configured write-access mode permits a request.
 *
 * `same-origin` accepts any request that passed the contract's origin+JSON
 * gate, which is what makes the page usable over a LAN address. `loopback`
 * additionally requires the socket peer to be a loopback address.
 *
 * @param {string} mode - a {@link WRITE_ACCESS} value.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {boolean} whether the request may write.
 */
export function allowsWrite(mode, req) {
  if (mode !== WRITE_ACCESS.LOOPBACK) return true
  const address = req?.socket?.remoteAddress
  if (typeof address !== 'string') return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
}