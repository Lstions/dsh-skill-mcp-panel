/**
 * dsh-skill-nesting — a recursive, multi-root skill provider.
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
 * from one preset would hide it from all the others.
 *
 * CONFIGURATION
 * The row's composition `config` is the base layer, and `ctx.settings`
 * namespace `skill-nesting` (edited from Settings → Plugins) layers over it, so
 * roots and policy change live without editing the composition. Changes are
 * picked up through the registration below, which re-derives and re-watches.
 *
 * @module dsh-skill-nesting
 */

import { watch } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'

export const name = 'skill-nesting'
export const inject = ['skills']

/** @typedef {{ name: string, description: string, body: string, invocation: { modelInvocable: boolean, userInvocable: boolean } }} ParsedSkill */

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Durable settings namespace edited from Settings → Plugins. */
export const SETTINGS_NAMESPACE = 'skill-nesting'

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
 * `z.union` of two `z.const` members renders as an enum in the generated client
 * form while staying a plain string at runtime, which is what the browser card
 * needs to offer a select without any client-side schema knowledge.
 */
export const Config = z.object({
  providerName: z.string().min(1).default('nested-filesystem'),
  /** Skill roots to scan; a bare string is accepted for a single root. */
  roots: z.union([z.string(), z.array(z.string())]).default([]),
  /** Category nesting levels to descend below each root. */
  maxDepth: z.number().min(1).max(12).default(DEFAULT_MAX_DEPTH),
  /** Precedence within this layer; lower wins. */
  rank: z.number().default(DEFAULT_RANK),
  /** Descend into dot-directories such as `.archive` / `.system`. */
  includeHidden: z.boolean().default(false),
  /** Also read flat `<root>/*.md` skills, matching the built-in layout. */
  includeFlatRootFiles: z.boolean().default(true),
  /** Refresh the catalog when the filesystem changes. */
  watch: z.boolean().default(true),
  watchDebounceMs: z.number().min(50).default(DEFAULT_DEBOUNCE_MS),
  /** How a skill name provided by several files is resolved. */
  duplicatePolicy: z.union([z.const('first-wins'), z.const('error')]).default('first-wins'),
})

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
    this.lastReport = { skills: 0, duplicates: [], skipped: [], roots: [], errors: [] }
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
    this.lastReport = report
    if (fs === undefined || config.roots.length === 0) return []

    /** name -> { path, rootIndex, depth, canonical } of the winning entry. */
    const winners = new Map()
    /** canonical path -> root that already supplied it. Overlapping roots are not conflicts. */
    const seenFiles = new Map()
    const conflicts = new Set()
    const candidates = []

    for (let rootIndex = 0; rootIndex < config.roots.length; rootIndex += 1) {
      const root = config.roots[rootIndex]
      const target = await this.#resolveDirectory(fs, root, report)
      if (target === undefined) continue
      await this.#walk(fs, target, 0, { rootIndex, root, winners, seenFiles, conflicts, candidates, report }, true)
    }

    for (const [skillName, paths] of [...winners].filter(([, entry]) => entry.conflict).map(([n, e]) => [n, e.paths])) {
      report.duplicates.push({ name: skillName, paths })
    }
    report.skills = candidates.length

    if (report.duplicates.length > 0) {
      const detail = report.duplicates
        .slice(0, 5)
        .map((entry) => `${entry.name} (${entry.paths.length} files)`)
        .join(', ')
      const more = report.duplicates.length > 5 ? ` (+${report.duplicates.length - 5} more)` : ''
      this.ctx.logger.warn(
        `skill-nesting: ${report.duplicates.length} duplicated skill name(s) [policy ${config.duplicatePolicy}]: ${detail}${more}`,
      )
    }
    if (report.skipped.length > 0) {
      this.ctx.logger.warn(`skill-nesting: skipped ${report.skipped.length} unreadable or invalid skill file(s)`)
    }
    return candidates
  }

  /**
   * Load a winning candidate's body from its locator.
   * @param {object} candidate - candidate previously returned by {@link list}.
   * @returns {Promise<object | undefined>} the full definition, or undefined if it vanished.
   */
  async get(candidate) {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return undefined
    const locator = candidate.locator
    const text = await this.#readText(fs, locator.path)
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
  async #walk(fs, directory, level, state, isRoot) {
    const entries = await this.#listDir(fs, directory.target)
    if (entries === undefined) return

    if (!isRoot) {
      for (const entry of entries) {
        if (entry.name === 'SKILL.md' && entry.type === 'file') {
          await this.#collect(fs, entry, directory, level, state)
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
      await this.#walk(fs, child, level + 1, state, false)
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
  async #collect(fs, entry, directory, level, state) {
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
    if (this.config.duplicatePolicy === 'error') {
      const index = state.candidates.findIndex((candidate) => candidate.name === parsed.name)
      if (index !== -1) state.candidates.splice(index, 1)
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
        this.ctx.logger.warn(`skill-nesting: watcher for ${root} failed: ${String(error)}`)
        try {
          watcher.close()
        } catch {}
        this.watchers.delete(root)
      })
      this.watchers.set(root, watcher)
    } catch (error) {
      this.ctx.logger.warn(`skill-nesting: cannot watch ${root}: ${String(error)}`)
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

/** Strip the raw config to schema-valid, defaulted values or throw naming the field. */
function resolveConfig(raw) {
  return Config(raw ?? {})
}

/**
 * Register the recursive provider on `ctx.skills`.
 *
 * The provider is registered into the calling context's layer, so mounting this
 * row from the host composition publishes it globally while mounting it from an
 * agent preset would scope it to that preset alone.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} entryConfig - the row's `config` block, used as the settings base layer.
 */
export function apply(ctx, entryConfig = {}) {
  const base = resolveConfig(entryConfig)
  const normalisedBase = { ...base, roots: normaliseRoots(base.roots) }

  /**
   * The live config source.
   *
   * `setSource` hands over a GETTER, not a value: the settings service swaps it
   * on detach (back to the composition entry) and re-resolves it on every
   * document commit. Sampling it once at install time — the easy mistake — makes
   * every later edit from the Settings card invisible, so the getter is retained
   * and called on each read.
   */
  let source = () => normalisedBase
  let cachedRaw
  let cachedConfig
  /** Resolve the current config, normalising roots and memoising per raw object. */
  function currentConfig() {
    const raw = source()
    if (raw !== cachedRaw) {
      cachedRaw = raw
      cachedConfig = { ...raw, roots: normaliseRoots(raw.roots) }
    }
    return cachedConfig
  }

  const provider = new NestedSkillProvider(ctx, { config: currentConfig })
  let watcher

  /** Re-derive the watch set and refresh the catalog after a config change. */
  function syncWatcher() {
    if (watcher === undefined) return
    const config = currentConfig()
    watcher.reconcile(config.roots, config.watchDebounceMs)
    watcher.refresh()
  }

  // The settings namespace layers over the composition row: `installSection`
  // registers the row's config as the base and falls back to it if the settings
  // provider detaches, so this plugin works with or without `ctx.settings`.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, Config, base, {
      validate: (value) => {
        if (!DUPLICATE_POLICIES.includes(value.duplicatePolicy)) {
          throw new Error(`skill-nesting: duplicatePolicy must be one of ${DUPLICATE_POLICIES.join(', ')}`)
        }
        normaliseRoots(value.roots)
      },
      setSource: (nextSource) => {
        source = nextSource
        syncWatcher()
      },
      onChange: syncWatcher,
    })
  })

  ctx.skills.registerProvider((control) => {
    const config = currentConfig()
    if (config.watch && watcher === undefined) {
      watcher = new RootWatcher(ctx, control.invalidate, {
        roots: config.roots,
        debounceMs: config.watchDebounceMs,
      })
      watcher.reconcile(config.roots, config.watchDebounceMs)
    }
    return provider
  })

  ctx.effect(() => () => {
    watcher?.dispose()
    watcher = undefined
  }, 'skill-nesting watchers')

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

  const initial = currentConfig()
  if (initial.roots.length === 0) {
    ctx.logger.warn('skill-nesting: no roots configured; the row is mounted but contributes nothing')
  } else {
    ctx.logger.info(
      `skill-nesting: provider "${initial.providerName}" watching ${initial.roots.length} root(s) at depth ${initial.maxDepth}: ${initial.roots.join(', ')}`,
    )
  }
}