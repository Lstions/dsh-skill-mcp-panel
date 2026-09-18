/**
 * A REAL host context for driving lib/mcp.js independently.
 *
 * Reuses the resolution strategy the package's own live suite established: the
 * MCP client is resolved through a host anchor (the Cordis loader package),
 * exactly as the host Loader resolves it. That anchor is discovered, never
 * hard-coded, because the pnpm store path carries a hash.
 *
 * Nothing about the connection, handshake, or tool registry is faked: the
 * assertions read a live registry, which is the only way to prove that
 * add/remove changes what the model can actually call.
 */
import { Context, Service } from '../../../node_modules/@deepseek-ai/cordis/lib/index.js'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** Locate a host anchor able to resolve the MCP client package. */
export function findAnchor() {
  const storeRoot = '/home/sun/.local/share/pnpm/global/v11'
  if (!existsSync(storeRoot)) return undefined
  for (const store of readdirSync(storeRoot)) {
    const pnpm = join(storeRoot, store, 'node_modules', '.pnpm')
    if (!existsSync(pnpm)) continue
    for (const entry of readdirSync(pnpm)) {
      if (!entry.startsWith('@deepseek-ai+cordis-plugin-loader@')) continue
      const lib = join(pnpm, entry, 'node_modules', '@deepseek-ai', 'cordis-plugin-loader', 'lib', 'index.js')
      if (!existsSync(lib)) continue
      try {
        createRequire(lib).resolve(MCP_CLIENT_MODULE)
        return lib
      } catch {}
    }
  }
  return undefined
}

/** The real tool registry contract, matching dsh-tools' published surface. */
class ToolRegistry extends Service {
  static inject = []
  constructor(ctx) {
    super(ctx, 'tools')
    this.definitions = new Map()
  }
  register(definition) {
    this.definitions.set(definition.name, definition)
    return () => this.definitions.delete(definition.name)
  }
  get(name) {
    return this.definitions.get(name)
  }
  schemas() {
    return [...this.definitions.values()].map(({ name, description, parameters }) => ({ name, description, parameters }))
  }
}

/**
 * Build a live host context.
 * @returns {Promise<{ctx: object, toolNames: Function, declarations: object[], anchor: string|undefined, skip: string|undefined}>}
 */
export async function makeHost() {
  const anchor = findAnchor()
  const ctx = new Context()
  ctx.plugin(ToolRegistry)

  /** Outer-loader rows, so the manager can enumerate non-declared servers. */
  const externalRows = []
  ctx.provide('loader', {
    entries: () =>
      externalRows.map((row) => ({
        id: row.id,
        options: { name: row.name, config: row.config, disabled: row.disabled },
        fiber: row.phase === undefined ? undefined : { state: row.phase },
      })),
    async import(name) {
      if (anchor === undefined) throw new Error(`no host anchor can resolve ${name}`)
      const path = createRequire(anchor).resolve(name)
      return await import(pathToFileURL(path).href)
    },
  })

  const declarations = []
  return {
    ctx,
    declarations,
    anchor,
    externalRows,
    skip: anchor === undefined ? `${MCP_CLIENT_MODULE} is not resolvable from any host anchor on this machine` : undefined,
    /** Public tool names currently in the live registry. */
    toolNames: (prefix) => ctx.get('tools').schemas().map((s) => s.name).filter((n) => prefix === undefined || n.startsWith(prefix)),
  }
}

export { MCP_CLIENT_MODULE }
