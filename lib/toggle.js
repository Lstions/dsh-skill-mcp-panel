/**
 * dsh-skill-mcp-panel — skill enable/disable: the suppression mechanism.
 *
 * WHY "WIN THE NAME", AND NOT "STOP PUBLISHING IT"
 * A provider may only ADD candidates; it can never withdraw one another
 * provider published, and it must never touch a user's files. Two ways to make
 * a skill unreachable were measured end-to-end against the real `SkillRegistry`
 * with a SAME-LAYER competitor also publishing the name:
 *
 *   INERT (this module)  win the name with a candidate whose invocation is
 *                        {modelInvocable:false, userInvocable:false}
 *     list       : x<-nested-filesystem(model=false,user=false)
 *     model sees : []            get(x) : undefined
 *     => the skill really is gone from both catalogs
 *
 *   OMIT                 stop publishing the name at all
 *     list       : x<-same-layer-competitor(model=true,user=true)
 *     model sees : [x]           get(x) : provider=same-layer-competitor, REAL BODY
 *     => we simply YIELDED the name; the competitor took it over and the skill
 *        stayed live. The user believes it is off. It is not.
 *
 * OMIT therefore fails SILENTLY exactly when it matters — when somebody else
 * also serves the name. Winning the name is the only thing that actually
 * suppresses it. Reproduce with `test/host-toggle.mjs` (case "same-layer
 * competitor") and `/tmp/deva-probe/tradeoff.mjs`.
 *
 * WHAT THIS DOES TO THE CATALOG, AND WHY THAT IS CORRECT
 * The name STAYS in `ctx.skills.list()` — carried by our suppression candidate
 * with both invocation flags false. That is the unavoidable, correct
 * consequence of winning the name, not a defect: every model-facing and
 * user-facing consumer filters by invocation policy, so both catalogs show
 * nothing. `get()` answers `undefined`, so the `skill` tool reports
 * `skill "X" is unknown or no longer available`. A UI must NOT judge "did the
 * toggle work?" by the name's presence in `list()`; it must read the invocation
 * flags and the provider, which is what {@link verifyDisabled} does.
 *
 * WHAT SUPPRESSION CANNOT DO
 * It cannot beat a NEARER layer. The registry merges `[global, ...scope chain]`
 * and a nearer layer wins a duplicate name OUTRIGHT — rank is only consulted
 * WITHIN one layer. A preset that mounts its own `skill-filesystem` into its own
 * scope keeps serving the name no matter what this plugin does. Such a skill is
 * reported `effective: false` with `shadowedBy` naming the provider that still
 * serves it, never as "disabled".
 *
 * CACHE INVALIDATION IS MANDATORY
 * `SkillRegistry` memoises collected catalogs per revision. Changing what
 * `list()` returns without calling the registration's `control.invalidate()`
 * leaves the OLD catalog in place — a probe that forgets it sees "nothing
 * changed" and falsely concludes suppression does not work.
 *
 * @module dsh-skill-mcp-panel/toggle
 */

/**
 * Rank of a suppression candidate. Lower wins. It must beat this plugin's own
 * discovery rank (default 300) and the built-in root rows (400/500) WITHIN THE
 * SAME LAYER. It deliberately does not impersonate a "real" skill rank, so an
 * operator reading the payload sees a suppression for what it is.
 */
export const SUPPRESS_RANK = 0

/** Invocation policy of a suppressed candidate: invisible to model and user. */
export const INVOCATION_OFF = Object.freeze({ modelInvocable: false, userInvocable: false })

/** Reason recorded when a nearer layer owns a name we tried to hide. */
export const SHADOW_NEARER_LAYER = 'nearer-layer'
/** Reason recorded when the name is still present but no provider can be named. */
export const SHADOW_UNNAMED = 'another-provider'

/**
 * Read the persisted disable table out of a resolved config.
 *
 * Stored as `skills: { '<name>': true }`. A missing or malformed table reads as
 * "nothing disabled" rather than throwing: a broken settings document must
 * never make the catalog unreadable.
 *
 * @param {object} config - resolved plugin config.
 * @returns {Set<string>} disabled skill names.
 */
export function readToggles(config) {
  const table = config?.skills
  const out = new Set()
  if (table === undefined || table === null || typeof table !== 'object' || Array.isArray(table)) return out
  for (const [key, value] of Object.entries(table)) {
    if (value === true) out.add(key)
  }
  return out
}

/** Stable, order-independent signature of a disable table (cache keys). */
export function togglesSignature(disabled) {
  return [...disabled].sort().join(',')
}

/**
 * Plan one toggle against the current disable table.
 *
 * Disabling writes `skills[name] = true`. Enabling UNSETS the key, so a
 * re-enabled skill leaves no residue in the settings document and the schema
 * default (`false`) carries the meaning.
 *
 * @param {Set<string>} disabled - current disable table.
 * @param {string} name - skill name.
 * @param {boolean} enabled - requested state.
 * @returns {{changed: boolean, already: boolean, op: {op: string, path: string[], value?: unknown}}}
 */
export function planToggle(disabled, name, enabled) {
  const isDisabled = disabled.has(name)
  if (enabled === false) {
    return { changed: !isDisabled, already: isDisabled, op: { op: 'set', path: ['skills', name], value: true } }
  }
  return { changed: isDisabled, already: !isDisabled, op: { op: 'unset', path: ['skills', name] } }
}

/**
 * The live disable table plus the discovery metadata a hidden name needs.
 *
 * The provider reads this synchronously inside `list()`, so a toggle applied at
 * time T is reflected in the very next catalog read (given an invalidate).
 */
export class Suppressor {
  /**
   * @param {object} [options]
   * @param {string} [options.providerName] - provider name this plugin registers.
   * @param {number} [options.rank] - rank for suppression candidates.
   */
  constructor(options = {}) {
    this.providerName = options.providerName ?? 'nested-filesystem'
    this.rank = Number.isFinite(options.rank) ? options.rank : SUPPRESS_RANK
    /** @type {Set<string>} */
    this.disabled = new Set()
    /** name -> discovery metadata, so a hidden skill can still be listed and restored. */
    this.known = new Map()
  }

  /**
   * Replace the disabled set.
   * @param {Iterable<string>} names - disabled skill names.
   * @param {Map<string, object>} [known] - metadata for those names, from discovery.
   */
  set(names, known) {
    this.disabled = new Set(names)
    if (known !== undefined) this.known = known
  }

  /** @returns {number} how many names are currently suppressed. */
  get size() {
    return this.disabled.size
  }

  /** @param {string} name - skill name. @returns {boolean} whether it is suppressed. */
  has(name) {
    return this.disabled.has(name)
  }

  /** @param {object} candidate - a provider candidate. @returns {boolean} whether it is suppressed. */
  omits(candidate) {
    return this.disabled.has(candidate?.name)
  }

  /**
   * Build the registry candidates that WIN every suppressed name.
   *
   * `description` must be a non-empty string or the registry rejects the
   * candidate, so a name that was never discovered still gets a readable one.
   *
   * @returns {object[]} candidates, sorted by name for deterministic output.
   */
  candidates() {
    const out = []
    for (const name of [...this.disabled].sort()) {
      const meta = this.known.get(name)
      const description = typeof meta?.description === 'string' && meta.description !== ''
        ? `Disabled in skill-mcp-panel: ${meta.description}`
        : 'Disabled in skill-mcp-panel.'
      out.push({
        name,
        description,
        invocation: { ...INVOCATION_OFF },
        source: 'custom',
        provider: this.providerName,
        rank: this.rank,
        ...(typeof meta?.path === 'string' ? { path: meta.path } : {}),
        locator: { suppressed: name, path: typeof meta?.path === 'string' ? meta.path : undefined },
        ...(typeof meta?.category === 'string'
          ? { metadata: { suppressedBy: 'skill-mcp-panel', category: meta.category } }
          : {}),
      })
    }
    return out
  }
}

/**
 * Enumerate the scope keys this process can actually see.
 *
 * `SkillRegistry` keeps scoped layers in a private `Map`; reading it is the only
 * way to answer "does a NEARER layer still serve this name?". The read is
 * guarded because it is an internal, not a published contract: if a future
 * registry renames or hides the field, discovery degrades to the unscoped view
 * instead of throwing.
 *
 * @param {object} ctx - Cordis context.
 * @returns {object[]} opaque scope keys (possibly empty).
 */
export function discoverScopes(ctx) {
  try {
    const scoped = ctx?.skills?.layers?.scoped
    if (scoped === undefined || typeof scoped.keys !== 'function') return []
    return [...scoped.keys()]
  } catch {
    return []
  }
}

/**
 * Read back the merged catalog for one view.
 *
 * @param {object} ctx - Cordis context.
 * @param {object} [scope] - opaque scope key; omitted reads the host view.
 * @returns {Promise<Map<string, object>>} name -> winning summary.
 */
export async function readCatalog(ctx, scope) {
  const options = scope === undefined ? {} : { scope }
  const list = await ctx.skills.list(options)
  const out = new Map()
  for (const summary of list ?? []) out.set(summary.name, summary)
  return out
}

/**
 * Read one name back from one view and report who really serves it.
 *
 * @param {object} ctx - Cordis context.
 * @param {string} name - skill name.
 * @param {object} [scope] - opaque scope key; omitted reads the host view.
 * @returns {Promise<{present: boolean, provider: string|null, modelInvocable: boolean, userInvocable: boolean, path: string|null}>}
 */
export async function readOne(ctx, name, scope) {
  const catalog = await readCatalog(ctx, scope)
  const summary = catalog.get(name)
  if (summary === undefined) {
    return { present: false, provider: null, modelInvocable: false, userInvocable: false, path: null }
  }
  return {
    present: true,
    provider: typeof summary.provider === 'string' ? summary.provider : null,
    modelInvocable: summary.invocation?.modelInvocable === true,
    userInvocable: summary.invocation?.userInvocable === true,
    path: typeof summary.path === 'string' ? summary.path : null,
  }
}

/**
 * Judge one name in one view: is it really suppressed, and if not, who serves it?
 *
 * A name counts as suppressed only when the winning summary is this plugin's
 * suppression candidate — same provider name AND both invocation flags false.
 * Presence in the catalog is NOT the test; a suppressed name is expected to be
 * present, carried by us.
 *
 * @param {object} options
 * @param {Map<string, object>} options.catalog - read-back catalog of one view.
 * @param {string} options.name - skill name.
 * @param {string} options.providerName - this plugin's provider name.
 * @returns {{hidden: boolean, present: boolean, provider: string|null, shadowedBy: string|null}}
 */
export function judgeHidden({ catalog, name, providerName }) {
  const summary = catalog.get(name)
  if (summary === undefined) {
    // Absent from this view entirely: nothing serves it here, so a disable is
    // trivially satisfied (e.g. the `error` duplicate policy withheld it).
    return { hidden: true, present: false, provider: null, shadowedBy: null }
  }
  const provider = typeof summary.provider === 'string' ? summary.provider : null
  const off = summary.invocation?.modelInvocable === false && summary.invocation?.userInvocable === false
  if (provider === providerName && off) return { hidden: true, present: true, provider, shadowedBy: null }
  return {
    hidden: false,
    present: true,
    provider,
    shadowedBy: provider ?? SHADOW_UNNAMED,
  }
}

/**
 * Verify a set of disabled names across every view this process can see.
 *
 * The host (unscoped) view decides `effective`; any discoverable scoped view
 * that still serves the name with a provider of its own flips the result to
 * "not effective" and names that provider. This is measured behaviour, not
 * theory: a nearer layer beats our rank outright.
 *
 * @param {object} options
 * @param {object} options.ctx - Cordis context.
 * @param {Iterable<string>} options.names - disabled skill names to judge.
 * @param {string} options.providerName - this plugin's provider name.
 * @param {object[]} [options.scopes] - scope keys to inspect; discovered when omitted.
 * @param {Map<string, object>} [options.hostCatalog] - pre-read host catalog.
 * @returns {Promise<Map<string, {effective: boolean, shadowedBy: string|null, provider: string|null, present: boolean}>>}
 */
export async function verifyDisabled({ ctx, names, providerName, scopes, hostCatalog }) {
  const wanted = [...names]
  const out = new Map()
  if (wanted.length === 0) return out

  const host = hostCatalog ?? await readCatalog(ctx, undefined)
  const views = []
  for (const key of scopes ?? discoverScopes(ctx)) {
    try {
      views.push({ key, catalog: await readCatalog(ctx, key) })
    } catch {
      // A view that cannot be read is not evidence of anything; skip it.
    }
  }

  for (const name of wanted) {
    const hostJudge = judgeHidden({ catalog: host, name, providerName })
    let verdict = {
      effective: hostJudge.hidden,
      shadowedBy: hostJudge.hidden ? null : hostJudge.shadowedBy,
      provider: hostJudge.provider,
      present: hostJudge.present,
    }
    for (const view of views) {
      const judge = judgeHidden({ catalog: view.catalog, name, providerName })
      if (judge.hidden) continue
      verdict = {
        effective: false,
        shadowedBy: judge.shadowedBy ?? SHADOW_NEARER_LAYER,
        provider: judge.provider ?? verdict.provider,
        present: true,
      }
      break
    }
    out.set(name, verdict)
  }
  return out
}

/**
 * Verify the ENABLED state of one name: present, served by this plugin, and
 * model-invocable again.
 *
 * @param {object} options
 * @param {Map<string, object>} options.catalog - the read-back host catalog.
 * @param {string} options.name - skill name.
 * @param {string} options.providerName - this plugin's provider name.
 * @returns {{present: boolean, provider: string|null, modelInvocable: boolean, ok: boolean}}
 */
export function verifyEnabled({ catalog, name, providerName }) {
  const summary = catalog.get(name)
  if (summary === undefined) return { present: false, provider: null, modelInvocable: false, ok: false }
  const provider = typeof summary.provider === 'string' ? summary.provider : null
  const modelInvocable = summary.invocation?.modelInvocable === true
  return { present: true, provider, modelInvocable, ok: provider === providerName && modelInvocable }
}

/**
 * Human-readable, non-euphemistic outcome text for an ApplyResult `detail`.
 *
 * @param {string} name - skill name.
 * @param {boolean} enabled - requested state.
 * @param {{effective?: boolean, shadowedBy?: string|null, present?: boolean, provider?: string|null, ok?: boolean}} verdict
 * @param {boolean} [changed] - whether anything was written.
 * @returns {string} outcome text.
 */
export function describeVerdict(name, enabled, verdict, changed = true) {
  if (enabled) {
    if (verdict?.ok === true) {
      return changed
        ? `"${name}" is enabled and served by "${verdict.provider}".`
        : `"${name}" is already enabled, served by "${verdict.provider}".`
    }
    if (verdict?.present === true) {
      return `"${name}" was enabled, but "${verdict.provider ?? 'another provider'}" currently serves that name.`
    }
    return changed
      ? `"${name}" was enabled, but no provider currently offers it — check the configured roots.`
      : `"${name}" is already enabled, but no provider currently offers it — check the configured roots.`
  }
  if (verdict?.effective === true) {
    return changed
      ? `"${name}" is disabled: neither the model nor the user catalog can reach it any more.`
      : `"${name}" is already disabled; neither the model nor the user catalog can reach it.`
  }
  // Not effective. The skill is live and somebody else owns it; say exactly who,
  // and never dress this up as a successful disable.
  const who = verdict?.shadowedBy ?? SHADOW_UNNAMED
  return changed
    ? `"${name}" is NOT disabled: it is still served by "${who}". A skill owned by a nearer registry layer cannot be suppressed from here, so it remains visible to the model.`
    : `"${name}" was already marked disabled, but it is NOT actually disabled: it is still served by "${who}", which this layer cannot override.`
}