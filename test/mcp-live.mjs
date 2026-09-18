#!/usr/bin/env node
/**
 * LIVE end-to-end tests for lib/mcp.js.
 *
 * This drives the REAL manager against a REAL Cordis tree, the REAL
 * `@deepseek-ai/dsh-mcp-client` package (resolved through a Loader stub exactly
 * as the host Loader resolves it), and a REAL MCP stdio server child process.
 * Nothing about the connection, the handshake, or the tool registry is faked —
 * the assertions read the live registry, which is the only way to prove that
 * add/remove actually changes what the model can call.
 *
 * Skipped, with an explicit notice, when no anchor can resolve the MCP client
 * package: an environment without the package must not fail the suite, but the
 * skip is printed so it can never be mistaken for a pass.
 *
 * Usage: node test/mcp-live.mjs
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createMcpManager, MCP_CLIENT_MODULE } from '../lib/mcp.js'
import { OP, STATUS } from '../lib/contract.js'

let failures = 0
function check(label, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected)
	if (!ok) failures += 1
	console.log(
		`${ok ? 'PASS' : 'FAIL'}  ${label}` +
			(ok ? '' : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`)
	)
	return ok
}
function section(name) {
	console.log(`\n=== ${name} ===`)
}

const FIXTURE = resolve(import.meta.dirname, 'mcp-fixture-server.mjs')

/**
 * Locate a module that can resolve the MCP client, mirroring the host Loader:
 * `import(name)` resolves from the Loader package's own location, which reaches
 * the install's hoisted `.pnpm/node_modules`.
 */
function findAnchor() {
	const candidates = []
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
			createRequire(candidate).resolve(MCP_CLIENT_MODULE)
			return candidate
		} catch {}
	}
	return undefined
}

/** The real tool registry contract: register/get/schemas, exactly as dsh-tools. */
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

const anchor = findAnchor()
if (anchor === undefined) {
	console.log(`SKIP  ${MCP_CLIENT_MODULE} is not resolvable from any host anchor on this machine.`)
	console.log('      The live mount cannot be tested here; test/mcp-inventory.mjs still covers the offline surface.')
	process.exit(0)
}

const ctx = new Context()
ctx.plugin(ToolRegistry)

/**
 * Loader rows reported to the manager. A direct `ctx.plugin()` call creates no
 * Loader entry, so an outer-layer row is modelled by declaring it here with the
 * same fields a real Loader entry carries — which is exactly what the profile
 * patch produces. The stub also resolves every import from the host anchor.
 */
const externalRows = []
ctx.provide('loader', {
	entries: () =>
		externalRows.map((row) => ({
			id: row.id,
			options: { name: row.name, config: row.config, disabled: row.disabled },
			fiber: row.phase === undefined ? undefined : { state: row.phase }
		})),
	async import(name) {
		const path = createRequire(anchor).resolve(name)
		return await import(pathToFileURL(path).href)
	}
})

/** Declarations live in this array, standing in for the settings namespace. */
let declared = []
const manager = createMcpManager({
	ctx,
	readDeclared: () => declared,
	writeDeclared: (next) => {
		declared = next
	}
})

const stdioConfig = () => ({ transport: 'stdio', command: process.execPath, args: [FIXTURE], env: {}, cwd: '' })

// ---------------------------------------------------------------------------
section('live add: the server mounts and its tools reach the real registry')

const added = await manager.apply({ kind: OP.MCP_ADD, serverName: 'live', config: stdioConfig() })
check('add reports applied', added.status, STATUS.APPLIED)
check('the declaration was persisted', declared.length, 1)
check('the tool really registered', ctx.get('tools').schemas().map((s) => s.name), ['mcp__live__ping'])
check('the result states the tool count', added.detail.includes('1 tool'), true)

const inventory = await manager.describe()
const liveRow = inventory.servers.find((server) => server.serverName === 'live')
check('describe lists the live server', liveRow !== undefined, true)
check('declared=true for an owned server', liveRow.declared, true)
check('toolCount read from the registry', liveRow.toolCount, 1)
check('phase is active', liveRow.phase, 'active')
check('mcpClientAvailable is true', inventory.mcpClientAvailable, true)

// ---------------------------------------------------------------------------
section('live toggle off/on: tools really leave and return')

const off = await manager.apply({ kind: OP.MCP_TOGGLE, serverName: 'live', enabled: false })
check('disable reports applied', off.status, STATUS.APPLIED)
check('the tool is gone from the registry', ctx.get('tools').schemas().length, 0)
check('the declaration was persisted as disabled', declared[0].enabled, false)
const describedOff = await manager.describe()
check('toolCount follows the registry down', describedOff.servers[0].toolCount, 0)
check('enabled=false is reported', describedOff.servers[0].enabled, false)

const on = await manager.apply({ kind: OP.MCP_TOGGLE, serverName: 'live', enabled: true })
check('re-enable reports applied', on.status, STATUS.APPLIED)
check('the tool is back', ctx.get('tools').schemas().map((s) => s.name), ['mcp__live__ping'])
const unchanged = await manager.apply({ kind: OP.MCP_TOGGLE, serverName: 'live', enabled: true })
check('a redundant toggle is unchanged', unchanged.status, STATUS.UNCHANGED)

// ---------------------------------------------------------------------------
section('live configure: the old instance is disposed, not leaked')

const reconfigured = await manager.apply({ kind: OP.MCP_CONFIGURE, serverName: 'live', config: stdioConfig() })
check('configure reports applied', reconfigured.status, STATUS.APPLIED)
// Exactly one registration: a leaked old instance would leave the name occupied
// and the MCP client reserves a serverName per scope, so a second live mount
// would have failed outright.
check('exactly one tool after reconfiguration', ctx.get('tools').schemas().map((s) => s.name), ['mcp__live__ping'])

// ---------------------------------------------------------------------------
section('live remove: the old instance is disposed and its tools disappear')

const removed = await manager.apply({ kind: OP.MCP_REMOVE, serverName: 'live' })
check('remove reports applied', removed.status, STATUS.APPLIED)
check('the declaration is gone', declared.length, 0)
check('the tool is gone from the registry', ctx.get('tools').schemas().map((s) => s.name), [])
const afterRemove = await manager.describe()
check('describe no longer lists it', afterRemove.servers.some((s) => s.serverName === 'live'), false)

// ---------------------------------------------------------------------------
section('live external row: discovered as declared=false with its real tools')

// Mount a second server OUTSIDE the manager, exactly as an outer composition
// layer would, and confirm the manager sees it without owning it.
const require2 = createRequire(anchor)
const module2 = await import(pathToFileURL(require2.resolve(MCP_CLIENT_MODULE)).href)
const externalConfig = {
	transport: 'stdio',
	serverName: 'external',
	command: process.execPath,
	args: [FIXTURE],
	env: {},
	cwd: ''
}
// The row an outer layer's composition would carry for this server.
externalRows.push({ id: 'outer-row-1', name: MCP_CLIENT_MODULE, config: externalConfig, phase: 2 })
const externalFiber = ctx.plugin(module2.default ?? module2, externalConfig)
await externalFiber
// Give the external instance's first tools/list a moment to land.
for (let i = 0; i < 100 && !ctx.get('tools').get('mcp__external__ping'); i += 1) {
	await new Promise((r) => setTimeout(r, 25))
}
check('the external server registered its tool', Boolean(ctx.get('tools').get('mcp__external__ping')), true)

const withExternal = await manager.describe()
const externalRow = withExternal.servers.find((server) => server.serverName === 'external')
check('the external server is listed', externalRow !== undefined, true)
check('declared=false for an external server', externalRow.declared, false)
check('its tools are counted from the registry', externalRow.toolCount, 1)
check('the manager did not claim ownership', declared.length, 0)

const refusedRemove = await manager.apply({ kind: OP.MCP_REMOVE, serverName: 'external' })
check('an external server cannot be removed by this plugin', refusedRemove.status, STATUS.REFUSED)
check('the external server is still live', Boolean(ctx.get('tools').get('mcp__external__ping')), true)

// ---------------------------------------------------------------------------
section('live add of a DEAD server: never reported as applied')

// The MCP client's schema defaults failOnStartupError to false, under which a
// command that does not exist still settles the fiber with zero tools. Awaiting
// the fiber alone would therefore report `applied` for a server that never ran;
// the manager overrides the flag so the failure is observable. This test is the
// regression guard for that override.
{
	const before = declared.length
	const outcome = await manager.apply({
		kind: OP.MCP_ADD,
		serverName: 'dead',
		config: { transport: 'stdio', command: '/nonexistent/definitely-not-a-binary-xyz', args: [], env: {}, cwd: '' }
	})
	check('a dead server is NOT reported as applied', outcome.status === STATUS.APPLIED, false)
	check('a dead server reports restart-required', outcome.status, STATUS.RESTART_REQUIRED)
	check('the failure reason is carried in the detail', outcome.detail.includes('initial connection'), true)
	check('the declaration is still persisted for the next start', declared.length, before + 1)
	check('the dead server contributed no tools', ctx.get('tools').schemas().some((s) => s.name.startsWith('mcp__dead__')), false)

	// The persisted config keeps the user's chosen value; only the live instance
	// forced the flag on.
	const stored = declared.find((item) => item.serverName === 'dead')
	check('the persisted config is not mutated by the live override', stored.config.failOnStartupError, undefined)

	const cleanup = await manager.apply({ kind: OP.MCP_REMOVE, serverName: 'dead' })
	check('the dead declaration can be removed', cleanup.status, STATUS.APPLIED)
}

{
	// A dead streamable-http endpoint must fail the same observable way.
	const outcome = await manager.apply({
		kind: OP.MCP_ADD,
		serverName: 'deadhttp',
		config: { transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp', headers: {} }
	})
	check('a dead http server is NOT reported as applied', outcome.status === STATUS.APPLIED, false)
	check('a dead http server reports restart-required', outcome.status, STATUS.RESTART_REQUIRED)
	await manager.apply({ kind: OP.MCP_REMOVE, serverName: 'deadhttp' })
}

// ---------------------------------------------------------------------------
section('live dispose: every owned mount is released')

await manager.dispose()
await externalFiber.dispose()
check('dispose released the owned tools', ctx.get('tools').schemas().some((s) => s.name.startsWith('mcp__live__')), false)

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
