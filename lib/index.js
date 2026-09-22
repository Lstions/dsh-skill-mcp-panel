/**
 * dsh-skill-mcp-panel — a recursive, multi-root skill provider with a live
 * management channel (skill toggles, conflict reporting, MCP inventory).
 *
 * WHY THIS EXISTS
 * The built-in `@deepseek-ai/dsh-skill-filesystem` provider scans a skill root
 * exactly one level deep: `discoverRoot()` treats a direct child directory as a
 * skill only if it contains `SKILL.md`, and otherwise hands off — it never looks
 * inside. A conventional, categorised skill tree
 * (`<root>/<category>/<skill>/SKILL.md`) therefore contributes nothing: the
 * category directories contain no `SKILL.md`, and every real skill sits one
 * level deeper, unseen. Its watcher is depth-1 for the same reason, so nested
 * edits never invalidate the catalog either.
 *
 * This plugin registers an ADDITIONAL provider on the same `skills` registry.
 * The built-in one keeps running, so nothing is lost: skills that were already
 * visible stay visible, and this provider adds the nested ones. The registry
 * merges providers by name, so a genuine duplicate resolves by rank instead of
 * being dropped.
 *
 * WHY IT IS A HOST ROW, NOT A PRESET ROW
 * `skills` is a host+per-scope layered registry. A provider registered from the
 * host composition lands in the GLOBAL layer, so every session — including
 * subagents and every agent preset — sees the nested catalog. Registering this
 * from one preset would hide it from all the others. The same fact bounds what
 * this plugin can do: a NEARER (preset) layer wins a duplicate name outright,
 * so a skill owned by a preset CANNOT be disabled from here. That is reported
 * honestly rather than papered over — see `lib/toggle.js`.
 *
 * THE MANAGEMENT CHANNEL
 * The harness gives a browser on a non-loopback address a memory-only settings
 * scope, so `settingsScope` cards are empty over a LAN. This row therefore also
 * publishes `GET /skill-mcp-panel/state` and `POST /skill-mcp-panel/apply` on the
 * harness web server (`lib/http.js`), which work identically on loopback and on
 * a LAN address. Reads mask secrets; writes require a same-origin JSON request.
 * Endpoints are deliberately NOT under `/api`, which is the gateway's RPC face.
 *
 * CONFIGURATION
 * The row's composition `config` is the base layer, and `ctx.settings`
 * namespace `skill-mcp-panel` (edited from Settings → Plugins) layers over it, so
 * roots, policy, the skill disable table and the MCP declarations all change
 * live without editing the composition.
 *
 * @module dsh-skill-mcp-panel
 */

import { watch } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { OP, STATUS, WRITE_ACCESS } from './contract.js'
import { createHttpRoutes, refusal } from './http.js'
import { createMcpManager } from './mcp.js'
import { createStateBuilder } from './state.js'
import {
  Suppressor,
  describeVerdict,
  planToggle,
  readCatalog,
  readToggles,
  verifyDisabled,
  verifyEnabled,
} from './toggle.js'

export const name = 'skill-mcp-panel'
export const inject = ['skills']

/** @typedef {{ name: string, description: string, body: string, invocation: { modelInvocable: boolean, userInvocable: boolean } }} ParsedSkill */

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Durable settings namespace edited from Settings → Plugins. */
export const SETTINGS_NAMESPACE = 'skill-mcp-panel'

/**
 * How a name provided by more than one file is resolved.
 *
 * - `first-wins` — the first root (then the shallowest path) keeps the name.
 *   This is the historic behaviour and the safest default: it never changes
 *   which file a name already resolved to.
 * - `error` — the name is withheld entirely and reported as a conflict, so a
 *   caller can never silently act on the wrong instructions.
 */
const DUPLICATE_POLICIES = ['first-wins', 'error']

/** Provider precedence within the registry layer; lower wins. The built-in root rows use 400/500. */
const DEFAULT_RANK = 300
const DEFAULT_MAX_DEPTH = 4
const DEFAULT_DEBOUNCE_MS = 250

/**
 * Settings/config schema.
 *
 * EVERY FIELD IS `.volatile()`, AND THAT IS LOAD-BEARING.
 *
 * `dsh-settings` refuses to write through a plugin whose schema declares no
 * volatile field: `SettingsService.write` calls `volatileForm(schema)` and
 * throws `Plugin entry "<ns>" has no volatile fields` when it returns
 * undefined, then rejects any path that is not under a volatile node with
 * `Config field "<path>" is not volatile`. A non-volatile field is therefore
 * READ-ONLY at runtime — it can be displayed, but never saved, and the failure
 * arrives as an opaque `The operation failed: ... has no volatile fields`
 * refusal rather than a schema error.
 *
 * Volatile means "safe to change without remounting this plugin". That is
 * exactly this plugin's situation: `currentConfig()` re-reads the settings
 * document on every access, the provider re-reads it per `list()`, and the
 * watcher re-reads roots, so an edit takes effect on the next read with no
 * remount. Fields whose change DOES require rebuilding something (the watcher,
 * the provider registration) are still volatile or not on that basis alone:
 * the plugin rebuilds them itself in response to the change.
 *
 * `.volatile()` needs schemastery >= 3.18.3; 3.18.2 has no such method and
 * silently renders the whole entry unwritable.
 *
 * `z.union` of two `z.const` members renders as an enum in the generated client
 * form while staying a plain string at runtime, which is what the browser card
 * needs to offer a select without any client-side schema knowledge.
 *
 * `skills` is the persisted disable table: `{ '<name>': true }`. Enabling a
 * skill UNSETS its key, so the schema default (`false`) carries the meaning and
 * a re-enabled skill leaves no residue in the settings document.
 */
export const Config = z.object({
  providerName: z.string().min(1).default('nested-filesystem').volatile(),
  /** Skill roots to scan; a bare string is accepted for a single root. */
  roots: z.union([z.string(), z.array(z.string())]).default([]).volatile(),
  /** Category nesting levels to descend below each root. */
  maxDepth: z.number().min(1).max(12).default(DEFAULT_MAX_DEPTH).volatile(),
  /** Precedence within this layer; lower wins. */
  rank: z.number().default(DEFAULT_RANK).volatile(),
  /** Descend into dot-directories such as `.archive` / `.system`. */
  includeHidden: z.boolean().default(false).volatile(),
  /** Also read flat `<root>/*.md` skills, matching the built-in layout. */
  includeFlatRootFiles: z.boolean().default(true).volatile(),
  /** Refresh the catalog when the filesystem changes. */
  watch: z.boolean().default(true).volatile(),
  watchDebounceMs: z.number().min(50).default(DEFAULT_DEBOUNCE_MS).volatile(),
  /** How a skill name provided by several files is resolved. */
  duplicatePolicy: z.union([z.const('first-wins'), z.const('error')]).default('first-wins').volatile(),
  /** Persisted skill disable table: `{ '<name>': true }` means "disabled". */
  skills: z.dict(z.boolean()).default({}).volatile(),
  /** Who may write through the plugin's own HTTP endpoint. */
  writeAccess: z.union([z.const('same-origin'), z.const('loopback')]).default(WRITE_ACCESS.SAME_ORIGIN).volatile(),
  /** MCP servers this plugin declares and owns (see `lib/mcp.js`). */
  mcpServers: z.array(z.any()).default([]).volatile(),
})

/**
 * Unwrap schemastery's volatility holders into plain values.
 *
 * A schema field declaring `.volatile()` is represented at runtime as a holder
 * with `get()` (read the live value) and a `Symbol(cosmokit.volatile.write)`
 * hook (publish an edit). Registry code that expects a number or an array must
 * therefore unwrap first; skipping it is a silent failure, not a type error.
 *
 * `dsh-settings` does exactly this in its own `plainConfig`, and this function
 * is the local equivalent. Nested objects and arrays are walked because a
 * volatile field may itself hold a structure (`roots`, `skills`, `mcpServers`).
 *
 * @param value - a resolved config value, possibly a volatile holder.
 * @returns the same value with every holder replaced by its contents.
 */
function unwrapVolatile(value) {
  if (value === null || typeof value !== 'object') return value
  if (typeof value.get === 'function') return unwrapVolatile(value.get())
  if (Array.isArray(value)) return value.map(unwrapVolatile)
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unwrapVolatile(child)]))
}

/** Normalise `roots`, expanding `~` and resolving to absolute paths, preserving order. */
function normaliseRoots(value) {
  const list = Array.isArray(value) ? value : value === undefined || value === '' ? [] : [value]
  const out = []
  for (const item of list) {
    if (typeof item !== 'string' || item.trim() === '') continue
    const trimmed = item.trim()
    const expanded = trimmed === '~'
      ? homedir()
      : trimmed.startsWith('~/')
        ? resolve(homedir(), trimmed.slice(2))
        : resolve(trimmed)
    if (!out.includes(expanded)) out.push(expanded)
  }
  return out
}

/**
 * Read one top-level scalar out of a frontmatter block.
 * Only the keys this provider needs are read, and nested mapping keys such as
 * `metadata.hermes.tags` are skipped because they are indented. Block scalars
 * (`|`, `>`, and their chomping variants) are folded into one line.
 */
function topLevelScalar(lines, key) {
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    if (raw === '') continue
    const first = raw.charAt(0)
    if (first === ' ' || first === '\t') continue
    const separator = raw.indexOf(':')
    if (separator <= 0) continue
    if (raw.slice(0, separator).trim() !== key) continue
    const rest = raw.slice(separator + 1).trim()
    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-' || rest === '|+' || rest === '>+') {
      const parts = []
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j]
        const indent = line.charAt(0)
        if (line.trim() !== '' && indent !== ' ' && indent !== '\t') break
        parts.push(line.trim())
      }
      return parts.join(' ').trim()
    }
    return unquote(rest)
  }
  return undefined
}

/** Strip matching quotes; YAML single-quoted scalars escape a quote by doubling it. */
function unquote(value) {
  if (value.length >= 2) {
    const first = value.charAt(0)
    const last = value.charAt(value.length - 1)
    if (first === '"' && last === '"') return value.slice(1, -1)
    if (first === "'" && last === "'") return value.slice(1, -1).split("''").join("'")
  }
  return value
}

/**
 * Parse a `SKILL.md` into the fields the registry needs.
 * Returns `undefined` for anything that is not a usable skill, so one malformed
 * file can never break discovery of the rest.
 * @param {string} text - full file contents.
 * @returns {ParsedSkill | undefined}
 */
function parseSkill(text) {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  if (!source.startsWith('---')) return undefined
  const firstBreak = source.indexOf('\n')
  if (firstBreak < 0) return undefined
  const closing = findFrontmatterEnd(source, firstBreak + 1)
  if (closing === undefined) return undefined

  const lines = source.slice(firstBreak + 1, closing.start).split(/\r?\n/)
  const skillName = topLevelScalar(lines, 'name')
  const description = topLevelScalar(lines, 'description')
  if (skillName === undefined || description === undefined) return undefined
  if (skillName === '' || description === '' || !NAME_PATTERN.test(skillName)) return undefined

  return {
    name: skillName,
    description,
    body: source.slice(closing.bodyStart).trim(),
    invocation: {
      modelInvocable: topLevelScalar(lines, 'disable-model-invocation') !== 'true',
      userInvocable: topLevelScalar(lines, 'user-invocable') !== 'false',
    },
  }
}

/** Locate the closing `---` line of the opening frontmatter block. */
function findFrontmatterEnd(text, from) {
  let lineStart = from
  while (lineStart <= text.length) {
    const nextBreak = text.indexOf('\n', lineStart)
    const lineEnd = nextBreak < 0 ? text.length : nextBreak
    if (text.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      return { start: lineStart, bodyStart: nextBreak < 0 ? text.length : nextBreak + 1 }
    }
    if (nextBreak < 0) return undefined
    lineStart = nextBreak + 1
  }
  return undefined
}

/**
 * Provider that turns a nested, multi-root skill tree into registry candidates.
 *
 * Discovery reads through `ctx.fs`, so identity is the backend's canonical
 * `targetKey`. That is what makes duplicate handling correct rather than
 * textual: two roots that are the same directory (`~/.agents/skills` is
 * commonly a symlink to `~/.hermes/skills`) share a `targetKey`, so the same
 * file reached twice is recognised as one skill instead of a conflict.
 *
 * HOW DISABLING WORKS
 * A disabled name is WON by a suppression candidate (rank 0, both invocation
 * flags false) and `get()` answers `undefined` for it. Winning the name is the
 * only thing that actually suppresses it: simply not publishing it would yield
 * the name to any same-layer competitor, which then serves the skill the user
 * believes they turned off. See `lib/toggle.js` for the measured comparison.
 * The provider never writes to or deletes a skill file: a toggle changes only
 * what this provider advertises.
 */
class NestedSkillProvider {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx
   * @param {object} options - resolved config plus the live settings source.
   */
  constructor(ctx, options) {
    this.ctx = ctx
    this.options = options
    /** Diagnostics from the most recent `list()`, read by the client surface. */
    this.lastReport = { skills: 0, duplicates: [], skipped: [], roots: [], errors: [], duplicatePolicy: 'first-wins' }
    /**
     * Structured result of the most recent scan: which files claim each name
     * and which roots were reachable. Read by `lib/state.js` to build conflicts
     * and root rows without re-walking the tree.
     */
    this.lastIndex = { byName: new Map(), roots: [] }
    /** The live disable table; toggles flow in through the settings `onChange`. */
    this.suppressor = new Suppressor({ providerName: 'nested-filesystem' })
  }

  get name() {
    return this.config.providerName
  }

  get config() {
    return this.options.config()
  }

  /**
   * Discover every skill below every configured root.
   * A root that is missing or unreadable is skipped, never fatal.
   *
   * Suppression candidates for disabled names are APPENDED to the real
   * candidates: the registry then has our candidate winning that name with both
   * invocation flags false, and every model-facing and user-facing consumer
   * filters it out. See `lib/toggle.js` for why winning the name is the only
   * mechanism that works.
   *
   * @returns {Promise<object[]>} registry candidates.
   */
  async list() {
    const fs = this.ctx.get('fs')
    const config = this.config
    const report = {
      skills: 0,
      duplicates: [],
      skipped: [],
      roots: config.roots.slice(),
      errors: [],
      duplicatePolicy: config.duplicatePolicy,
    }
    const index = { byName: new Map(), roots: [] }
    this.lastReport = report
    this.lastIndex = index
    this.suppressor.providerName = config.providerName
    // Re-read the disable table on EVERY scan, rather than trusting a settings
    // notification to have arrived.
    //
    // `syncToggles()` is event-driven: 0.1.6 announced an edit through the
    // `installSection` hooks and 0.1.7 emits `settings/document-updated`. Making
    // the switch depend on that plumbing is fragile, and a missed notification is
    // INVISIBLE — the value persists, the page reads it back, and the skill stays
    // in the catalog because the suppressor still holds the previous table. That
    // is exactly the "I turned it off and nothing changed" report.
    //
    // The config getter is live (volatile holders are re-read), so this costs one
    // property walk per scan and removes the dependency. `control.invalidate()`
    // is still required to drop the registry's collect cache, and stays in
    // `syncToggles()`.
    this.suppressor.set(readToggles(config))
    if (fs === undefined || config.roots.length === 0) {
      // With no roots there is still discovery metadata to hand the suppressor
      // for names the settings table already disables.
      this.suppressor.set(readToggles(config), this.#knownFrom(index))
      return this.suppressor.size > 0 ? this.suppressor.candidates() : []
    }

    /** name -> the winning entry recorded in `index.byName`. */
    const winners = new Map()
    /** canonical path -> root that already supplied it. Overlapping roots are not conflicts. */
    const seenFiles = new Map()
    const candidates = []

    for (let rootIndex = 0; rootIndex < config.roots.length; rootIndex += 1) {
      const root = config.roots[rootIndex]
      const target = await this.#resolveDirectory(fs, root, report)
      const rootEntry = { path: root, exists: target !== undefined, skillCount: 0 }
      index.roots.push(rootEntry)
      if (target === undefined) continue
      await this.#walk(fs, target, 0, {
        rootIndex, root, winners, seenFiles, candidates, report, index, rootEntry,
      }, true, [])
    }

    for (const [skillName, entry] of winners) {
      if (entry.conflict) report.duplicates.push({ name: skillName, paths: entry.paths })
    }

    // Suppression candidates go last: they must coexist with the real ones, and
    // the registry decides the winner by rank (ours is lowest, so it wins).
    this.suppressor.set(readToggles(config), this.#knownFrom(index))
    const suppressions = this.suppressor.candidates()
    const visible = candidates.filter((candidate) => !this.suppressor.omits(candidate))
    report.skills = visible.length
    report.suppressed = suppressions.length

    if (report.duplicates.length > 0) {
      const detail = report.duplicates
        .slice(0, 5)
        .map((entry) => `${entry.name} (${entry.paths.length} files)`)
        .join(', ')
      const more = report.duplicates.length > 5 ? ` (+${report.duplicates.length - 5} more)` : ''
      this.ctx.logger.warn(
        `skill-mcp-panel: ${report.duplicates.length} duplicated skill name(s) [policy ${config.duplicatePolicy}]: ${detail}${more}`,
      )
    }
    if (report.skipped.length > 0) {
      this.ctx.logger.warn(`skill-mcp-panel: skipped ${report.skipped.length} unreadable or invalid skill file(s)`)
    }
    return [...visible, ...suppressions]
  }

  /** name -> discovery metadata, for names the settings table already disables. */
  #knownFrom(index) {
    const known = new Map()
    for (const [name, entry] of index.byName) {
      if (entry.winner !== undefined) known.set(name, entry.winner)
    }
    return known
  }

  /**
   * Load a winning candidate's body from its locator.
   *
   * A suppressed candidate answers `undefined`, so the `skill` tool reports the
   * name as unknown rather than loading an empty or stale body.
   *
   * @param {object} candidate - candidate previously returned by {@link list}.
   * @returns {Promise<object | undefined>} the full definition, or undefined if it vanished.
   */
  async get(candidate) {
    if (candidate === undefined || candidate === null) return undefined
    if (this.suppressor.omits(candidate)) return undefined
    const fs = this.ctx.get('fs')
    if (fs === undefined) return undefined
    const locator = candidate.locator
    const text = await this.#readText(fs, locator?.path ?? candidate.path)
    if (text === undefined) return undefined
    const parsed = parseSkill(text)
    if (parsed === undefined) return undefined
    return {
      name: parsed.name,
      description: parsed.description,
      invocation: parsed.invocation,
      source: 'custom',
      provider: this.name,
      resourceBase: { kind: 'directory', path: locator.directory },
      path: locator.path,
      content: parsed.body,
    }
  }

  async #resolveDirectory(fs, path, report) {
    try {
      const target = await fs.resolve(path)
      const info = await fs.stat(target)
      if (info !== undefined && info.type === 'directory') return { target, key: target.targetKey }
      report.errors.push({ path, message: 'not a directory' })
      return undefined
    } catch (error) {
      report.errors.push({ path, message: String(error) })
      return undefined
    }
  }

  async #readText(fs, path) {
    try {
      const target = await fs.resolve(path)
      return await fs.readText(target)
    } catch {
      return undefined
    }
  }

  async #listDir(fs, target) {
    try {
      return await fs.listDir(target)
    } catch {
      return undefined
    }
  }

  /**
   * Walk one directory.
   *
   * A directory holding `SKILL.md` is a skill and is NOT descended into, so a
   * skill's own bundled resources can never be mistaken for skills. Every other
   * directory is a category and is descended into until `maxDepth`.
   */
  async #walk(fs, directory, level, state, isRoot, trail) {
    const entries = await this.#listDir(fs, directory.target)
    if (entries === undefined) return

    if (!isRoot) {
      // `trail` is the path from the root to THIS directory. A directory that
      // holds `SKILL.md` IS a skill, so the category is everything above it.
      const category = trail.slice(0, -1).join('/')
      for (const entry of entries) {
        if (entry.name === 'SKILL.md' && entry.type === 'file') {
          await this.#collect(fs, entry, directory, level, state, category)
          return
        }
      }
    } else if (this.config.includeFlatRootFiles) {
      for (const entry of entries) {
        if (entry.type !== 'file' || entry.name === 'DESCRIPTION.md') continue
        if (!entry.name.endsWith('.md')) continue
        await this.#collect(fs, entry, directory, level, state)
      }
    }

    if (level >= this.config.maxDepth) return
    for (const entry of entries) {
      if (entry.type !== 'directory') continue
      if (!this.config.includeHidden && entry.name.startsWith('.')) continue
      const child = { target: entry.target, displayPath: entry.target.displayPath }
      await this.#walk(fs, child, level + 1, state, false, [...trail, entry.name])
    }
  }

  /**
   * Parse one candidate file and record it as a name winner, a duplicate, or a
   * skip.
   *
   * Dedupe is by canonical `targetKey` first: the same file reached through two
   * roots is one skill and is never reported as a conflict. Only genuinely
   * distinct files claiming one name are duplicates, and those follow the
   * configured policy.
   */
  async #collect(fs, entry, directory, level, state, category) {
    const path = entry.target.displayPath
    const canonical = entry.target.targetKey

    if (state.seenFiles.has(canonical)) return
    state.seenFiles.set(canonical, path)

    const text = await this.#readText(fs, path)
    if (text === undefined) {
      state.report.skipped.push(path)
      return
    }
    const parsed = parseSkill(text)
    if (parsed === undefined) {
      state.report.skipped.push(path)
      return
    }
    if (!parsed.invocation.modelInvocable) return

    // The category comes from the WALK, never from prefix-matching the path
    // against the root: `ctx.fs` returns a realpath'd displayPath, so a
    // symlinked root (`~/.agents/skills` -> `~/.hermes/skills`) would never
    // match its own configured root and every category would come out empty.
    const record = {
      path, canonical, root: state.root, rootIndex: state.rootIndex,
      category, rank: this.config.rank, description: parsed.description,
    }

    let indexed = state.index.byName.get(parsed.name)
    if (indexed === undefined) {
      indexed = { entries: [], winner: record, conflict: false, withheld: false }
      state.index.byName.set(parsed.name, indexed)
    }
    indexed.entries.push(record)
    state.rootEntry.skillCount += 1

    const existing = state.winners.get(parsed.name)
    if (existing === undefined) {
      state.winners.set(parsed.name, {
        path,
        paths: [path],
        depth: level,
        rootIndex: state.rootIndex,
        directory: directory.displayPath,
        entry,
        conflict: false,
      })
      state.candidates.push(this.#candidate(parsed, path, directory.displayPath, entry, state.rootIndex, level))
      return
    }

    existing.paths.push(path)
    // `first-wins` keeps the earlier winner; `error` withholds the name
    // entirely. Both must withdraw a name already published this pass.
    if (existing.conflict) return
    existing.conflict = true
    indexed.conflict = true
    if (this.config.duplicatePolicy === 'error') {
      indexed.withheld = true
      const at = state.candidates.findIndex((candidate) => candidate.name === parsed.name)
      if (at !== -1) state.candidates.splice(at, 1)
    }
  }

  #candidate(parsed, path, directory, entry, rootIndex, depth) {
    return {
      name: parsed.name,
      description: parsed.description,
      invocation: parsed.invocation,
      source: 'custom',
      provider: this.name,
      rank: this.config.rank,
      // Ranking data the registry ignores; used only for this provider's own
      // diagnostics and deterministic ordering.
      locator: { path, directory, rootIndex, depth },
      resourceBase: { kind: 'directory', path: directory },
      path,
    }
  }
}

/**
 * Watch every configured root recursively and invalidate the registry cache on
 * change. Recursive watching is required because a nested provider is only
 * correct if a deep `SKILL.md` edit refreshes the catalog; without it the model
 * keeps a stale description for the rest of the session.
 */
class RootWatcher {
  constructor(ctx, invalidate, options) {
    this.ctx = ctx
    this.invalidate = invalidate
    this.roots = options.roots
    this.debounceMs = options.debounceMs
    /** root path -> watcher handle. A Map, not an array, so `reconcile` can drop removed roots. */
    this.watchers = new Map()
    this.timer = undefined
    this.closed = false
  }

  /** (Re)watch a root set, closing any watchers for roots no longer configured. */
  reconcile(roots, debounceMs) {
    if (this.closed) return
    this.debounceMs = debounceMs
    const wanted = new Set(roots)
    for (const [root, watcher] of this.watchers) {
      if (wanted.has(root)) continue
      try {
        watcher.close()
      } catch {}
      this.watchers.delete(root)
    }
    for (const root of roots) {
      if (this.watchers.has(root)) continue
      this.#watchRoot(root)
    }
    this.roots = roots.slice()
  }

  #watchRoot(root) {
    try {
      const watcher = watch(root, { recursive: true, persistent: false }, () => this.#schedule())
      watcher.on('error', (error) => {
        this.ctx.logger.warn(`skill-mcp-panel: watcher for ${root} failed: ${String(error)}`)
        try {
          watcher.close()
        } catch {}
        this.watchers.delete(root)
      })
      this.watchers.set(root, watcher)
    } catch (error) {
      this.ctx.logger.warn(`skill-mcp-panel: cannot watch ${root}: ${String(error)}`)
    }
  }

  #schedule() {
    if (this.closed) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.closed) return
      this.invalidate()
    }, this.debounceMs)
  }

  /**
   * Drop any pending debounce and invalidate the registry now.
   * Used for authoritative tool-driven writes and settings changes, where
   * waiting for the OS watcher would let one model step read a stale catalog.
   */
  refresh() {
    if (this.closed) return
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.invalidate()
  }

  /** Close every watcher and drop any pending invalidation. */
  dispose() {
    this.closed = true
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    for (const watcher of this.watchers.values()) {
      try {
        watcher.close()
      } catch {}
    }
    this.watchers.clear()
  }
}

/**
 * Strip the raw config to schema-valid, defaulted values or throw naming the field.
 *
 * UNWRAP FIRST, AND UNWRAP TWICE. The host may hand this plugin the config it
 * already resolved, in which every volatile field is a holder rather than a
 * value; validating that and wrapping it again yields a holder-of-a-holder, so a
 * single `.get()` still returns a holder instead of the value.
 *
 * The failure is silent and expensive: a holder stringifies to `{}`, so `roots`
 * becomes an empty object and `mcpServers` stops being an array. Discovery then
 * finds nothing and the MCP section reports no servers, with nothing thrown.
 * That is exactly how the volatile change first broke the host suites.
 */
function resolveConfig(raw) {
  return unwrapVolatile(Config(unwrapVolatile(raw ?? {})))
}

/** Operation kinds this module handles itself; everything else MCP owns. */
const MCP_KINDS = new Set([OP.MCP_TOGGLE, OP.MCP_CONFIGURE, OP.MCP_ADD, OP.MCP_REMOVE])

/**
 * Register the recursive provider on `ctx.skills`, the settings namespace, the
 * management HTTP channel, and the MCP manager.
 *
 * The provider is registered into the calling context's layer, so mounting this
 * row from the host composition publishes it globally while mounting it from an
 * agent preset would scope it to that preset alone.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} entryConfig - the row's `config` block, used as the settings base layer.
 * @returns {object} the live pieces (provider, state builder, applyOps, http, mcp).
 *   Cordis ignores a plugin's return value, so this changes nothing about
 *   mounting; it lets tests drive the real pipeline instead of a look-alike.
 */
export function apply(ctx, entryConfig = {}) {
  const base = resolveConfig(entryConfig)
  const normalisedBase = { ...base, roots: normaliseRoots(base.roots) }

  /**
   * Resolve the current config, unwrapping live fields and normalising roots.
   *
   * UNWRAPPING IS MANDATORY, and it is the price of `meta.volatile`. A volatile
   * field is not a plain value: schemastery wraps it in a holder whose real
   * value is reached through `.get()`, and which also carries the write hook the
   * settings service uses to publish an edit. Reading `config.maxDepth` directly
   * therefore yields an object, not a number — the failure is silent and wild
   * (a number comparison quietly takes the wrong branch, `roots` becomes `{}`
   * and discovery finds nothing) rather than a thrown type error.
   *
   * WHERE THE LIVE VALUES COME FROM depends on the settings API:
   *
   *   0.1.6  `installSection` calls `setSource(...)`, and that getter becomes
   *          the single source of truth.
   *   0.1.7  there is no `setSource`: the service edits this plugin's OWN
   *          resolved config in place, so the holder inside `entryConfig` IS the
   *          live value and must be re-read on every access. A snapshot taken at
   *          mount time is why a write could report `applied`, persist to
   *          `cordis.patch.yml`, and still leave the plugin reading the old
   *          value — the config never changed as far as the plugin could see.
   *
   * Memoising on a cheap signature keeps repeated reads inside one `list()`
   * call from rebuilding, without freezing the value across an edit.
   */
  let source = () => ({ ...normalisedBase, ...unwrapVolatile(entryConfig ?? {}) })
  let cachedSignature
  let cachedConfig
  function currentConfig() {
    const raw = source()
    const signature = JSON.stringify(raw)
    if (signature !== cachedSignature) {
      cachedSignature = signature
      cachedConfig = { ...raw, roots: normaliseRoots(raw.roots) }
    }
    return cachedConfig
  }

  const provider = new NestedSkillProvider(ctx, { config: currentConfig })
  let watcher
  /** The registry registration's control handle; `invalidate` is mandatory after a toggle. */
  let control
  /** The live settings provider, when this deployment has one. */
  let settingsService

  /** True only when a writable settings provider can persist a change. */
  function isWritable() {
    return settingsService !== undefined && settingsService.writable === true
  }

  /** The effective write-access mode, defaulted when no settings provider exists. */
  function readWriteAccess() {
    const configured = currentConfig().writeAccess
    return configured === WRITE_ACCESS.LOOPBACK ? WRITE_ACCESS.LOOPBACK : WRITE_ACCESS.SAME_ORIGIN
  }

  /** The live disable table. */
  function readDisabled() {
    return readToggles(currentConfig())
  }

  /**
   * Push the disable table into the provider and drop the registry's cached
   * catalog.
   *
   * WITHOUT THE INVALIDATE THE TOGGLE APPEARS TO DO NOTHING: `SkillRegistry`
   * memoises collected catalogs per revision, so a changed `list()` alone is
   * invisible until the registration invalidates. This is the single place that
   * happens, so no toggle path can forget it.
   */
  function syncToggles() {
    const config = currentConfig()
    provider.suppressor.providerName = config.providerName
    provider.suppressor.set(readDisabled())
    control?.invalidate()
  }

  /** Re-derive the watch set and refresh the catalog after a config change. */
  function syncWatcher() {
    if (watcher === undefined) return
    const config = currentConfig()
    watcher.reconcile(config.roots, config.watchDebounceMs)
    watcher.refresh()
  }

  // ── settings ──────────────────────────────────────────────────────────────
  //
  // The 0.1.7 settings service REPLACED the old `installSection` API, and the
  // difference is not cosmetic:
  //
  //   old   installSection(ctx, ns, Config, base, {validate, setSource, onChange})
  //   new   configure({ auto: false }, fiber)  +  values read from `config.x.get()`
  //
  // A plugin's editable values now live in its own resolved Config, where each
  // `.volatile()` field is a live holder; the service projects a form over the
  // entry named by its COMPOSITION ID (`skill-mcp-panel`), and persists an edit
  // through the profile's Cordis patch rather than a side settings file.
  //
  // Calling the removed method is not a loud failure: it throws inside
  // `ctx.inject(['settings'], …)`, which kills only that child context, so the
  // provider, the HTTP channel and the page all keep working while every write
  // is refused. That is precisely the "I can look but I cannot change anything"
  // symptom. Mount with the new call when it exists and fall back to the old one
  // so the plugin still works on 0.1.6.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsService = settingsCtx.settings ?? settingsCtx.get?.('settings')
    if (typeof settingsService?.configure === 'function') {
      // The supported 0.1.7+ path. `auto: false` says this plugin ships its own
      // management surface, so the harness must not also generate a form page
      // for it; the values remain editable through `settings.write`.
      settingsCtx.effect(() => settingsService.configure({ auto: false }, ctx.fiber))
      watchSettingsDocument(settingsCtx)
      return
    }
    if (typeof settingsService?.installSection === 'function') {
      // 0.1.6 compatibility: the section API that layers a namespace over the row.
      settingsService.installSection(ctx, SETTINGS_NAMESPACE, Config, base, {
        validate: (value) => {
          if (!DUPLICATE_POLICIES.includes(value.duplicatePolicy)) {
            throw new Error(`skill-mcp-panel: duplicatePolicy must be one of ${DUPLICATE_POLICIES.join(', ')}`)
          }
          normaliseRoots(value.roots)
        },
        setSource: (nextSource) => {
          source = nextSource
          syncWatcher()
          syncToggles()
        },
        onChange: () => {
          syncWatcher()
          syncToggles()
        },
      })
      return
    }
    ctx.logger?.warn?.(
      'skill-mcp-panel: this settings service has neither configure() nor installSection(); ' +
        'configuration stays read-only from the management page',
    )
  })

  // ── the skill provider ────────────────────────────────────────────────────
  ctx.skills.registerProvider((registration) => {
    control = registration
    const config = currentConfig()
    if (config.watch && watcher === undefined) {
      watcher = new RootWatcher(ctx, registration.invalidate, {
        roots: config.roots,
        debounceMs: config.watchDebounceMs,
      })
      watcher.reconcile(config.roots, config.watchDebounceMs)
    }
    return provider
  })

  // ── react to a settings write ─────────────────────────────────────────────
  //
  // On 0.1.7 the settings service publishes an edit as
  // `settings/document-updated` (id, revision) after it rewrites the profile
  // patch. WITHOUT THIS SUBSCRIPTION A TOGGLE IS SILENTLY INERT: the value is
  // persisted and the page reads it back, but nothing tells the provider to
  // re-read the disable table or invalidate the registry's collect cache, so the
  // skill stays in the catalog — which is exactly what "I flipped the switch and
  // nothing happened" looks like.
  //
  // The old `installSection` hooks used to provide this (`onChange`), so this
  // replaces them rather than duplicating them. It is registered only when the
  // 0.1.7 path is taken, so a 0.1.6 host does not run both.
  function watchSettingsDocument(settingsCtx) {
    settingsCtx.on?.('settings/document-updated', (id) => {
      // Any entry may change; only this plugin's own config affects discovery.
      if (id !== undefined && id !== ctx.fiber?.id && id !== 'skill-mcp-panel') return
      syncWatcher()
      syncToggles()
      // The management page caches the state document it last read, so its
      // revision must move or the next read would serve the pre-edit snapshot.
      // `state` is assigned below; the guard keeps an early event harmless.
      stateRef?.invalidate()
    })
  }

  /** Forward reference to the state builder, which is constructed further down. */
  let stateRef

  // A disable table already present in the composition config must be live
  // before the first catalog read.
  syncToggles()

  ctx.effect(() => () => {
    watcher?.dispose()
    watcher = undefined
  }, 'skill-mcp-panel watchers')

  // A tool-driven write or edit is an authoritative change the OS watcher may
  // coalesce or miss; invalidate immediately for paths inside a configured root.
  ctx.on('fs/observed', (target, _observation, actor) => {
    if (watcher === undefined) return
    const toolName = actor !== undefined && typeof actor === 'object' && 'name' in actor ? actor.name : undefined
    if (toolName !== 'write' && toolName !== 'edit') return
    const path = typeof target?.displayPath === 'string' ? target.displayPath : undefined
    if (path === undefined) return
    if (currentConfig().roots.some((root) => path === root || path.startsWith(`${root}/`))) watcher.refresh()
  })

  // ── MCP inventory manager (owned by lib/mcp.js) ───────────────────────────
  // The factory is called through a fence so a failure there degrades the MCP
  // section instead of taking skill management down with it (N6).
  let mcpManager
  try {
    mcpManager = createMcpManager({
      ctx,
      readDeclared: () => {
        const declared = currentConfig().mcpServers
        return Array.isArray(declared) ? declared : []
      },
      writeDeclared: (next) => writeSettings([{ op: 'set', path: ['mcpServers'], value: next }]),
      readConfig: currentConfig,
      log: (message) => ctx.logger.info(message),
    })
  } catch (error) {
    ctx.logger.warn(`skill-mcp-panel: the MCP manager could not be created: ${String(error)}`)
  }
  const fallbackInventory = { servers: [], managerAvailable: false, mcpClientAvailable: false }
  async function readMcp() {
    if (mcpManager === undefined) return fallbackInventory
    try {
      return await mcpManager.describe()
    } catch (error) {
      ctx.logger.warn(`skill-mcp-panel: reading the MCP inventory failed: ${String(error)}`)
      return fallbackInventory
    }
  }

  ctx.effect(() => () => {
    try {
      mcpManager?.dispose()
    } catch {}
  }, 'skill-mcp-panel mcp manager')

  // ─ state + HTTP channel ──────────────────────────────────────────────────
  const state = createStateBuilder({
    ctx,
    provider,
    readConfig: currentConfig,
    readDisabled,
    readMcp,
    readWriteAccess,
    isWritable,
    log: (message) => ctx.logger.warn(message),
  })
  stateRef = state


  /**
   * Persist settings ops through the live provider.
   * @param {object[]} ops - path ops for the `settings.mutate` contract.
   */
  async function writeSettings(ops) {
    await settingsService.mutate(SETTINGS_NAMESPACE, ops)
  }

  /** Read back one name and describe whether a disable really took effect. */
  async function verifyOne(name, enabled) {
    if (enabled) {
      const catalog = await readCatalog(ctx, undefined)
      return verifyEnabled({ catalog, name, providerName: currentConfig().providerName })
    }
    const verdicts = await verifyDisabled({
      ctx,
      names: [name],
      providerName: currentConfig().providerName,
    })
    return verdicts.get(name) ?? { effective: false, shadowedBy: 'another-provider', provider: null, present: false }
  }

  /** Apply one skill enable/disable operation, verifying the outcome by read-back. */
  async function applySkillToggle(op) {
    const kind = OP.SKILL_TOGGLE
    const name = typeof op?.name === 'string' && op.name !== ''
      ? op.name
      : typeof op?.target === 'string' && op.target !== '' ? op.target : undefined
    if (name === undefined) {
      return refusal(kind, 'Refused: "name" must be a non-empty skill name.')
    }
    if (typeof op?.enabled !== 'boolean') {
      return refusal(kind, `Refused: "enabled" must be true or false for "${name}".`, name)
    }
    if (!isWritable()) {
      return refusal(kind, 'Refused: no writable settings provider is present, so a toggle could not be persisted.', name)
    }

    const plan = planToggle(readDisabled(), name, op.enabled)
    if (!plan.changed) {
      const verdict = await verifyOne(name, op.enabled)
      return {
        kind,
        ok: true,
        status: STATUS.UNCHANGED,
        detail: describeVerdict(name, op.enabled, verdict, false),
        target: name,
      }
    }

    await writeSettings([plan.op])
    // Drop the registry cache BEFORE reading back, or the verdict is computed
    // from the catalog that still contains the skill we just switched off.
    syncToggles()
    state.invalidate()
    const verdict = await verifyOne(name, op.enabled)
    // The write landed; whether the OUTCOME landed is a separate question and
    // is answered only by the read-back. A disable that a nearer layer defeats
    // reports ok:false with a detail that says so in plain words.
    const achieved = op.enabled ? verdict.ok === true : verdict.effective === true
    return {
      kind,
      ok: achieved,
      status: STATUS.APPLIED,
      detail: describeVerdict(name, op.enabled, verdict, true),
      target: name,
    }
  }

  /** Apply a bulk skill operation as ONE settings write (F3.5). */
  async function applySkillBulk(op) {
    const rows = []
    if (Array.isArray(op?.skills)) {
      for (const item of op.skills) {
        if (item !== null && typeof item === 'object' && typeof item.name === 'string') {
          rows.push({ name: item.name, enabled: item.enabled === true })
        }
      }
    } else if (Array.isArray(op?.names)) {
      for (const item of op.names) {
        if (typeof item === 'string' && item !== '') rows.push({ name: item, enabled: op.enabled === true })
      }
    }
    if (rows.length === 0) {
      return [refusal(OP.SKILL_BULK, 'Refused: supply "skills" ([{name, enabled}]) or "names" with "enabled".')]
    }
    if (!isWritable()) {
      return rows.map((row) => refusal(OP.SKILL_BULK, 'Refused: no writable settings provider is present, so toggles could not be persisted.', row.name))
    }

    const disabled = readDisabled()
    const plans = []
    const results = []
    for (const row of rows) {
      const plan = planToggle(disabled, row.name, row.enabled)
      if (!plan.changed) {
        results.push({ row, plan, skipped: true })
        continue
      }
      plans.push(plan.op)
      results.push({ row, plan, skipped: false })
    }

    if (plans.length > 0) {
      await writeSettings(plans)
      syncToggles()
      state.invalidate()
    }

    // Verify EVERY row, including the skipped ones. A row that was already in
    // the requested state still has to be reported from the read-back: skipping
    // it would leave the verdict undefined and the detail would claim the skill
    // is "still served by another-provider" when it is in fact already off.
    const hostCatalog = await readCatalog(ctx, undefined)
    const disableNames = results.filter((entry) => entry.row.enabled === false).map((entry) => entry.row.name)
    const verdicts = disableNames.length > 0
      ? await verifyDisabled({ ctx, names: disableNames, providerName: currentConfig().providerName, hostCatalog })
      : new Map()

    return results.map(({ row, skipped }) => {
      const verdict = row.enabled
        ? verifyEnabled({ catalog: hostCatalog, name: row.name, providerName: currentConfig().providerName })
        : verdicts.get(row.name) ?? { effective: false, shadowedBy: null, provider: null, present: false }
      const achieved = row.enabled ? verdict.ok === true : verdict.effective === true
      return {
        kind: OP.SKILL_BULK,
        ok: skipped ? true : achieved,
        status: skipped ? STATUS.UNCHANGED : STATUS.APPLIED,
        detail: describeVerdict(row.name, row.enabled, verdict, !skipped),
        target: row.name,
      }
    })
  }

  /** Validate and persist one baseline configuration field (F7). */
  async function applyConfigSet(op) {
    const kind = OP.CONFIG_SET
    const key = Array.isArray(op?.path) ? op.path[0] : op?.key
    const value = op?.value
    if (typeof key !== 'string' || key === '') return refusal(kind, 'Refused: "path" or "key" must name a configuration field.')
    if (key === 'skills' || key === 'mcpServers') {
      return refusal(kind, `Refused: "${key}" is managed through its own operations, not config.set.`, key)
    }
    if (!Object.hasOwn(Config.dict ?? {}, key) && !(key in base)) {
      return refusal(kind, `Refused: "${key}" is not a configurable field.`, key)
    }
    if (!isWritable()) return refusal(kind, 'Refused: no writable settings provider is present.', key)

    let candidate
    try {
      candidate = resolveConfig({ ...currentConfig(), [key]: value })
    } catch (error) {
      return refusal(kind, `Refused: ${String(error.message ?? error)}`, key)
    }
    if (key === 'roots') candidate = { ...candidate, roots: normaliseRoots(candidate.roots) }
    if (JSON.stringify(candidate[key]) === JSON.stringify(currentConfig()[key])) {
      return { kind, ok: true, status: STATUS.UNCHANGED, detail: `"${key}" already has that value.`, target: key }
    }

    await writeSettings([{ op: 'set', path: [key], value: key === 'roots' ? candidate.roots : candidate[key] }])
    state.invalidate()
    return { kind, ok: true, status: STATUS.APPLIED, detail: `"${key}" is now in force; discovery re-reads it immediately.`, target: key }
  }

  /** Remove a baseline override so the row default applies again. */
  async function applyConfigUnset(op) {
    const kind = OP.CONFIG_UNSET
    const key = Array.isArray(op?.path) ? op.path[0] : op?.key
    if (typeof key !== 'string' || key === '') return refusal(kind, 'Refused: "path" or "key" must name a configuration field.')
    if (key === 'skills' || key === 'mcpServers') {
      return refusal(kind, `Refused: "${key}" is managed through its own operations.`, key)
    }
    if (!isWritable()) return refusal(kind, 'Refused: no writable settings provider is present.', key)
    await writeSettings([{ op: 'unset', path: [key] }])
    state.invalidate()
    return { kind, ok: true, status: STATUS.APPLIED, detail: `"${key}" was reset to the row default.`, target: key }
  }

  /**
   * Apply a batch of operations, one result each, in order.
   * @param {object[]} ops - operations carrying a `kind` from {@link OP}.
   * @returns {Promise<object[]>} {@link import('./contract.js').ApplyResult} values.
   */
  async function applyOps(ops) {
    const results = []
    for (const op of Array.isArray(ops) ? ops : []) {
      const kind = op?.kind
      try {
        if (kind === OP.SKILL_TOGGLE) {
          results.push(await applySkillToggle(op))
        } else if (kind === OP.SKILL_BULK) {
          results.push(...await applySkillBulk(op))
        } else if (kind === OP.CONFIG_SET) {
          results.push(await applyConfigSet(op))
        } else if (kind === OP.CONFIG_UNSET) {
          results.push(await applyConfigUnset(op))
        } else if (MCP_KINDS.has(kind)) {
          if (mcpManager === undefined) {
            results.push(refusal(kind, 'Refused: the MCP manager is unavailable in this host.'))
          } else {
            results.push(await mcpManager.apply(op))
          }
        } else {
          results.push(refusal(kind, `Unknown operation kind ${JSON.stringify(kind)}.`))
        }
      } catch (error) {
        results.push(refusal(kind, `The operation failed: ${String(error.message ?? error)}`, op?.name ?? op?.target))
      }
    }
    return results
  }

  const http = createHttpRoutes({
    ctx,
    buildState: () => state.build(),
    applyOps,
    readWriteAccess,
    isWritable,
    log: (message) => ctx.logger.info(message),
  })

  // ── start-up diagnostics ──────────────────────────────────────────────────
  const initial = currentConfig()
  if (initial.roots.length === 0) {
    ctx.logger.warn('skill-mcp-panel: no roots configured; the row is mounted but contributes nothing')
  } else {
    ctx.logger.info(
      `skill-mcp-panel: provider "${initial.providerName}" watching ${initial.roots.length} root(s) at depth ${initial.maxDepth}: ${initial.roots.join(', ')}`,
    )
  }

  // Cordis ignores a plugin's return value; exposing the live pieces costs
  // nothing and lets a test drive the REAL apply pipeline and state builder
  // instead of re-assembling an equivalent one that could drift from it.
  return {
    provider,
    state,
    http,
    mcp: mcpManager,
    applyOps,
    readWriteAccess,
    isWritable,
    readMcp,
    currentConfig,
  }
}