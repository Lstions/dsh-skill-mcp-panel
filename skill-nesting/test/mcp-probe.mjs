/**
 * LIVE-MOUNT PROBE for lib/mcp.js.
 *
 * Question 1: can a plugin mount `@deepseek-ai/dsh-mcp-client` at runtime via
 *             `ctx.loader.import(spec)` + `ctx.plugin(module, config)`?
 * Question 2: do the server's tools really appear in the real tool registry,
 *             and do they disappear when the fiber is disposed?
 *
 * This runs a real Cordis tree (the local `@deepseek-ai/cordis` dependency) with
 * a minimal `tools` service and a loader stub that resolves the bare specifier
 * from the HOST anchor exactly as the real Loader does (`import(name)` with the
 * loader package as the base). A REAL MCP stdio server (JSON-RPC over
 * newline-delimited stdio) is spawned as the fixture, so nothing about the
 * connection, the handshake, or the tool registration is mocked.
 *
 * Usage: node test/mcp-probe.mjs [loaderAnchorPath]
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SPEC = '@deepseek-ai/dsh-mcp-client'
const serverPath = resolve(import.meta.dirname, 'mcp-fixture-server.mjs')

/**
 * Find an anchor that can resolve the MCP client package, mirroring how the
 * host's Loader resolves it: pnpm's hoisted `.pnpm/node_modules` directory
 * beside the running install.
 */
function findAnchor(explicit) {
	if (explicit !== undefined) return explicit
	const candidates = []
	// The real Loader module: `import(name)` resolves from the loader package's
	// own location, which reaches the install's hoisted `.pnpm/node_modules`.
	const storeRoot = '/home/sun/.local/share/pnpm/global/v11'
	if (existsSync(storeRoot)) {
		for (const store of readdirSync(storeRoot)) {
			const pnpm = join(storeRoot, store, 'node_modules', '.pnpm')
			if (!existsSync(pnpm)) continue
			for (const entry of readdirSync(pnpm)) {
				if (!entry.startsWith('@deepseek-ai+cordis-plugin-loader@')) continue
				const lib = join(pnpm, entry, 'node_modules', '@deepseek-ai', 'cordis-plugin-loader', 'lib', 'index.js')
				if (existsSync(lib)) candidates.push(lib)
			}
		}
	}
	for (const candidate of candidates) {
		try {
			createRequire(candidate).resolve(SPEC)
			return candidate
		} catch {}
	}
	return undefined
}

const anchor = findAnchor(process.argv[2])
const report = { spec: SPEC, anchor, resolved: null, mounted: null, tools: [], afterDispose: [], error: null }

/** Minimal stand-in for the real tool registry: register/get/schemas/unregister. */
class ToolRegistry extends Service {
	static inject = []
	constructor(ctx) {
		super(ctx, 'tools')
		this.definitions = new Map()
		this.log = []
	}
	register(definition) {
		this.definitions.set(definition.name, definition)
		this.log.push(`register ${definition.name}`)
		return () => {
			this.definitions.delete(definition.name)
			this.log.push(`unregister ${definition.name}`)
		}
	}
	get(name) {
		return this.definitions.get(name)
	}
	schemas() {
		return [...this.definitions.values()].map(({ name, description, parameters }) => ({ name, description, parameters }))
	}
	names() {
		return [...this.definitions.keys()].sort()
	}
}

const ctx = new Context()
ctx.plugin(ToolRegistry)

// Stand-in for the host's loader service. `import()` resolves from the HOST
// anchor, which is what makes a package invisible to the plugin itself (it
// lives outside this package's dependency closure) reachable at runtime.
const loaderStub = {
	async import(name) {
		const require = createRequire(anchor)
		const path = require.resolve(name)
		report.resolved = path
		return await import(pathToFileURL(path).href)
	}
}
ctx.provide('loader', loaderStub)

try {
	const module = await ctx.loader.import(SPEC)
	report.exports = Object.keys(module)
	report.hasDefault = 'default' in module
	// mcp-client is a NAMESPACE plugin: named `apply`/`inject`/`Config`, no
	// default export. Cordis accepts any object carrying `apply`.
	const plugin = module.default ?? module
	const config = {
		transport: 'stdio',
		serverName: 'probe',
		command: process.execPath,
		args: [serverPath],
		env: {},
		cwd: ''
	}
	const fork = ctx.plugin(plugin, config)
	await fork
	report.mounted = true

	const tools = ctx.get('tools')
	report.tools = tools.names()
	report.toolSchema = tools.schemas().map((schema) => schema.name)

	// Dispose the fiber: the MCP connection must close and its tools unregister.
	await fork.dispose()
	report.afterDispose = tools.names()
	report.registryLog = tools.log
} catch (error) {
	report.error = { code: error?.code ?? null, message: String(error?.message ?? error) }
}

console.log(JSON.stringify(report, null, 2))
process.exit(0)
