/**
 * Shared offline harness for dsh-skill-mcp-panel tests.
 *
 * `targetKey` is the realpath, which is exactly the identity contract the local
 * `ctx.fs` backend provides. That is what lets the tests prove symlinked and
 * overlapping roots dedupe by file identity rather than by path text.
 */
import { readdir, readFile, stat, realpath } from 'node:fs/promises'
import { join } from 'node:path'

/** A filesystem service backed by node:fs with realpath identity. */
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
        return {
          type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other',
          version: 'v',
        }
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
 * A minimal Cordis context sufficient for `apply()`.
 *
 * `ctx.inject(['settings'], cb)` is deliberately a no-op unless the caller opts
 * in, so tests exercise the composition-base path, which is byte-identical to
 * what the settings fallback hands back when no settings provider is present.
 */
export function makeCtx(fsService, options = {}) {
  const logs = []
  const eventHandlers = new Map()
  const ctx = {
    logger: {
      info: (message) => logs.push(['info', message]),
      warn: (message) => logs.push(['warn', message]),
      error: (message) => logs.push(['error', message]),
    },
    get: (name) => (name === 'fs' ? fsService : undefined),
    inject: (names, callback) => {
      if (Array.isArray(names) && names.includes('settings') && options.settings !== undefined) {
        callback(options.settings)
      }
    },
    on: (event, handler) => {
      eventHandlers.set(event, handler)
      return () => eventHandlers.delete(event)
    },
    effect: (callback) => {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    skills: {
      registerProvider: (create) => {
        const control = { invalidate: () => { control.invalidated += 1 }, invalidated: 0 }
        const provider = create(control)
        captured = { provider, control }
        return () => {}
      },
    },
  }
  let captured
  return {
    ctx,
    logs,
    eventHandlers,
    get captured() {
      return captured
    },
  }
}

/** Build one `SKILL.md` body with optional extra frontmatter lines. */
export function skillFile(name, extras = '') {
  return `---\nname: ${name}\ndescription: "Description for ${name}."\nversion: 1.0.0\nmetadata:\n  hermes:\n    tags: [a, b]\n${extras}---\n\n# ${name}\n\nBody of ${name}.\n`
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
  return { results, check }
}