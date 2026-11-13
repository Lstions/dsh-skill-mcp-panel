#!/usr/bin/env node
/**
 * Offline tests for lib/mcp.js — inventory, masking, validation, and the
 * result-status mapping.
 *
 * Everything here runs against fakes: no MCP server is spawned and no real
 * Loader is required. The live-mount behaviour is measured separately by
 * `test/mcp-probe.mjs` (real Cordis tree + real MCP stdio server) and
 * `test/mcp-live.mjs`.
 *
 * Usage: node test/mcp-inventory.mjs
 */
import { createMcpManager, normalizeConfig, describeTarget, redactUrl, parseMcpServers, SERVER_NAME_PATTERN } from '../lib/mcp.js'
import { OP, STATUS, SECRET_MASK } from '../lib/contract.js'

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

/**
 * A fake tool registry shaped like `dsh-tools`: `schemas()` returns the public
 * projection, `get(name)` the scope-aware lookup.
 */
function makeTools(names) {
	const definitions = new Map()
	for (const name of names) definitions.set(name, { name, description: `Description of ${name}`, parameters: {} })
	return {
		definitions,
		schemas() {
			return [...definitions.values()].map(({ name, description, parameters }) => ({ name, description, parameters }))
		},
		get(name) {
			return definitions.get(name)
		},
		add(name, description = `Description of ${name}`) {
			definitions.set(name, { name, description, parameters: {} })
		},
		remove(name) {
			definitions.delete(name)
		}
	}
}

/**
 * A fake Loader: `entries()` yields loader rows, `import()` returns a plugin
 * stub. Both are the only Loader surface lib/mcp.js touches.
 */
function makeLoader(rows, options = {}) {
	return {
		entries() {
			return rows.map((row) => ({
				id: row.id,
				options: { name: row.name, config: row.config, disabled: row.disabled, group: row.group },
				fiber: row.phase === undefined ? undefined : { state: row.phase }
			}))
		},
		async import(spec) {
			if (options.importFails) throw new Error(options.importFails)
			return options.module ?? { apply() {}, name: 'mcp-client', inject: ['tools'] }
		}
	}
}

/** Build a manager over a fake context. Every dep is overridable per test. */
function makeManager({ tools, loader, pluginManager, declared = [], config = {}, onWrite, writeThrows = false, onMount, ctxExtra = {}, module } = {}) {
	const state = { declared: declared.map((item) => structuredClone(item)) }
	let lastWrite
	const ctx = {
		logger: { info() {}, warn() {}, error() {} },
		get(name) {
			if (name === 'tools') return tools
			if (name === 'loader') return loader
			if (name === 'pluginManager') return pluginManager
			return undefined
		},
		plugin(plugin, pluginConfig) {
			// `registered` models the real client's generation: a mount publishes
			// tools and its disposal withdraws them. Without that, a test could
			// count tools for a server it had already removed.
			const registered = []
			const fiber = {
				config: pluginConfig,
				plugin,
				disposed: false,
				registered,
				async dispose() {
					fiber.disposed = true
					for (const name of registered) tools?.remove?.(name)
				}
			}
			onMount?.(pluginConfig, tools, registered)
			return fiber
		},
		...ctxExtra
	}
	const manager = createMcpManager({
		ctx,
		readDeclared: () => state.declared,
		writeDeclared: (next) => {
			if (writeThrows) throw new Error('disk is full')
			lastWrite = structuredClone(next)
			state.declared = structuredClone(next)
			onWrite?.(next)
		},
		readConfig: () => config
	})
	return { manager, state, getLastWrite: () => lastWrite, ctx, module }
}

const STDIO_DECL = {
	serverName: 'local-tools',
	enabled: true,
	config: { transport: 'stdio', command: 'node', args: ['server.mjs'], env: { GITHUB_TOKEN: 'ghp_realtoken', PLAIN: 'visible' }, cwd: '' }
}

// ---------------------------------------------------------------------------
section('external loader rows are discovered and marked declared=false')

{
	const tools = makeTools(['mcp__outer__search', 'mcp__outer__fetch', 'unrelated_tool'])
	const loader = makeLoader([
		{ id: '4', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'stdio', serverName: 'outer', command: 'npx', args: ['-y', 'outer-mcp'] }, phase: 2 },
		{ id: '5', name: '@deepseek-ai/dsh-skill-filesystem', config: {}, phase: 2 },
		{ id: '6', name: 'group-row', group: true, config: {}, phase: 2 }
	])
	const pluginManager = {
		async listPlugins() {
			return [{ entryId: '4', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: true, fiberPhase: 'active', patchId: 'p1' }]
		}
	}
	const { manager } = makeManager({ tools, loader, pluginManager })
	const inventory = await manager.describe()

	check('exactly one outer server found', inventory.servers.length, 1)
	const row = inventory.servers[0]
	check('serverName read from row.options.config', row.serverName, 'outer')
	check('declared=false for an outer row', row.declared, false)
	check('entryId carried from the loader', row.rowId, '4')
	check('phase projected from the fiber state', row.phase, 'active')
	check('toolCount counts only this server prefix', row.toolCount, 2)
	check('tools list', row.tools.map((t) => t.name), ['mcp__outer__fetch', 'mcp__outer__search'])
	check('managerAvailable', inventory.managerAvailable, true)
	check('a group row is skipped', inventory.servers.some((s) => s.serverName === 'group-row'), false)
	check('a non-mcp row is skipped', inventory.servers.some((s) => s.rowId === '5'), false)
}

{
	// No plugin manager at all: the rows must still be listed from the Loader.
	const tools = makeTools([])
	const loader = makeLoader([
		{ id: '9', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'streamable-http', serverName: 'remote' , url: 'https://example.test/mcp' }, disabled: true, phase: 4 }
	])
	const { manager } = makeManager({ tools, loader })
	const inventory = await manager.describe()
	check('outer row found without a plugin manager', inventory.servers.length, 1)
	check('effective enabled falls back to the row flag', inventory.servers[0].enabled, false)
	check('managerAvailable=false', inventory.managerAvailable, false)
	check('disposed fiber maps to phase null', inventory.servers[0].phase, null)
}

// ---------------------------------------------------------------------------
section('tool counts come from ctx.tools, not from configuration')

{
	const tools = makeTools([])
	const declared = [STDIO_DECL]
	const loader = makeLoader([])
	const { manager } = makeManager({ tools, declared, loader })
	const before = await manager.describe()
	check('a declared server with no live tools reports 0', before.servers[0].toolCount, 0)
	check('phase is null while not mounted', before.servers[0].phase, null)

	// The registry is the only thing that changes; the configuration is identical.
	tools.add('mcp__local-tools__one')
	tools.add('mcp__local-tools__two')
	tools.add('mcp__other__three')
	const after = await manager.describe()
	check('toolCount follows the registry', after.servers[0].toolCount, 2)
	check('a foreign prefix is not counted', after.servers[0].tools.map((t) => t.name), ['mcp__local-tools__one', 'mcp__local-tools__two'])
}

{
	// A registry with no enumerator must degrade, not throw.
	const bare = { get: () => undefined }
	const { manager } = makeManager({ tools: bare, declared: [STDIO_DECL], loader: makeLoader([]) })
	const inventory = await manager.describe()
	check('missing enumerator degrades to zero tools', inventory.servers[0].toolCount, 0)
}

{
	// No `tools` service at all.
	const { manager } = makeManager({ tools: undefined, declared: [STDIO_DECL], loader: makeLoader([]) })
	const inventory = await manager.describe()
	check('no tools service still describes servers', inventory.servers.length, 1)
	check('no tools service reports zero tools', inventory.servers[0].toolCount, 0)
}

// ---------------------------------------------------------------------------
section('serverName validation: invalid and duplicate names are refused, nothing written')

{
	const invalid = ['', 'has space', 'a'.repeat(33), 'bad/slash', 'emoji😀', 'semi;colon', null, undefined]
	for (const name of invalid) {
		const { manager, getLastWrite } = makeManager({ tools: makeTools([]), loader: makeLoader([]) })
		const outcome = await manager.apply({
			kind: OP.MCP_ADD,
			serverName: name,
			config: { transport: 'stdio', command: 'node' }
		})
		check(`invalid name ${JSON.stringify(name)} refused`, outcome.status, STATUS.REFUSED)
		check(`invalid name ${JSON.stringify(name)} wrote nothing`, getLastWrite(), undefined)
	}
}

{
	// Boundary: exactly 32 valid characters must be accepted, 33 rejected.
	const ok32 = 'a'.repeat(32)
	check('32 chars match the pattern', SERVER_NAME_PATTERN.test(ok32), true)
	check('33 chars do not match', SERVER_NAME_PATTERN.test('a'.repeat(33)), false)
	const { manager, state } = makeManager({ tools: makeTools([]), loader: makeLoader([]) })
	const outcome = await manager.apply({ kind: OP.MCP_ADD, serverName: ok32, config: { transport: 'stdio', command: 'node' }, enabled: false })
	check('a 32-char name is accepted', outcome.status, STATUS.APPLIED)
	check('the declaration was written', state.declared.length, 1)
}

{
	const { manager, getLastWrite } = makeManager({ tools: makeTools([]), declared: [STDIO_DECL], loader: makeLoader([]) })
	const outcome = await manager.apply({
		kind: OP.MCP_ADD,
		serverName: 'local-tools',
		config: { transport: 'stdio', command: 'other' }
	})
	check('duplicate declared name refused', outcome.status, STATUS.REFUSED)
	check('duplicate refusal mentions the name', outcome.detail.includes('local-tools'), true)
	check('duplicate refusal wrote nothing', getLastWrite(), undefined)
}

{
	// Duplicate against an OUTER row: the name is live under another layer.
	const tools = makeTools([])
	const loader = makeLoader([{ id: '1', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'stdio', serverName: 'taken', command: 'x' }, phase: 2 }])
	const { manager, getLastWrite } = makeManager({ tools, loader })
	const outcome = await manager.apply({ kind: OP.MCP_ADD, serverName: 'taken', config: { transport: 'stdio', command: 'node' } })
	check('duplicate against an outer row refused', outcome.status, STATUS.REFUSED)
	check('outer duplicate wrote nothing', getLastWrite(), undefined)
}

{
	// A bad transport must be refused with no write, and the declarations file
	// must be untouched.
	const { manager, getLastWrite } = makeManager({ tools: makeTools([]), loader: makeLoader([]) })
	const outcome = await manager.apply({ kind: OP.MCP_ADD, serverName: 'x', config: { transport: 'carrier-pigeon' } })
	check('unknown transport refused', outcome.status, STATUS.REFUSED)
	check('unknown transport wrote nothing', getLastWrite(), undefined)

	const noCommand = await manager.apply({ kind: OP.MCP_ADD, serverName: 'y', config: { transport: 'stdio' } })
	check('stdio without command refused', noCommand.status, STATUS.REFUSED)

	const badUrl = await manager.apply({ kind: OP.MCP_ADD, serverName: 'z', config: { transport: 'streamable-http', url: 'not a url' } })
	check('http with a malformed url refused', badUrl.status, STATUS.REFUSED)
	check('nothing was written by any refusal', getLastWrite(), undefined)
}

// ---------------------------------------------------------------------------
section('secret masking: output never carries a real secret')

{
	const tools = makeTools([])
	const { manager } = makeManager({ tools, declared: [STDIO_DECL], loader: makeLoader([]) })
	const inventory = await manager.describe()
	const row = inventory.servers[0]
	const serialized = JSON.stringify(inventory)
	check('the real token never appears in the payload', serialized.includes('ghp_realtoken'), false)
	check('the token key is still listed', Object.keys(row.config).sort(), ['GITHUB_TOKEN', 'PLAIN'])
	check('the token value is masked', row.config.GITHUB_TOKEN, SECRET_MASK)
	check('a non-secret value passes through', row.config.PLAIN, 'visible')
}

{
	// An HTTP server: headers must be masked the same way.
	const declared = [
		{
			serverName: 'remote',
			enabled: true,
			config: {
				transport: 'streamable-http',
				url: 'https://user:sup3rs3cret@mcp.example.test/mcp?apiKey=querysecret&page=2',
				headers: { Authorization: 'Bearer abc123realtoken', 'X-Trace': 'plain-value' }
			}
		}
	]
	const { manager } = makeManager({ tools: makeTools([]), declared, loader: makeLoader([]) })
	const inventory = await manager.describe()
	const row = inventory.servers[0]
	const serialized = JSON.stringify(inventory)
	check('the bearer token never appears', serialized.includes('abc123realtoken'), false)
	check('the header key is still listed', Object.keys(row.config).sort(), ['Authorization', 'X-Trace'])
	check('the header value is masked', row.config.Authorization, SECRET_MASK)
	check('a non-secret header passes through', row.config['X-Trace'], 'plain-value')
	check('url userinfo is redacted in target', serialized.includes('sup3rs3cret'), false)
	check('url secret query parameter is redacted', serialized.includes('querysecret'), false)
	check('a non-secret query parameter survives', row.target.includes('page=2'), true)
}

// ---------------------------------------------------------------------------
section('masked write-back preserves the real secret')

{
	const tools = makeTools([])
	const { manager, state } = makeManager({ tools, declared: [STDIO_DECL], loader: makeLoader([]) })

	// The browser echoes the masked dict back, having edited only the command.
	const outcome = await manager.apply({
		kind: OP.MCP_CONFIGURE,
		serverName: 'local-tools',
		config: {
			transport: 'stdio',
			command: 'node',
			args: ['server.mjs'],
			env: { GITHUB_TOKEN: SECRET_MASK, PLAIN: 'visible' }
		}
	})
	check('configure succeeded', outcome.status === STATUS.APPLIED || outcome.status === STATUS.RESTART_REQUIRED, true)
	check('the real token survived the masked write', state.declared[0].config.env.GITHUB_TOKEN, 'ghp_realtoken')
	check('the non-secret value was not corrupted', state.declared[0].config.env.PLAIN, 'visible')
}

{
	// A genuinely NEW value must overwrite, i.e. unmasking must not be a no-op.
	const tools = makeTools([])
	const { manager, state } = makeManager({ tools, declared: [STDIO_DECL], loader: makeLoader([]) })
	await manager.apply({
		kind: OP.MCP_CONFIGURE,
		serverName: 'local-tools',
		config: { transport: 'stdio', command: 'node', args: [], env: { GITHUB_TOKEN: 'ghp_brandnew' } }
	})
	check('a new secret replaces the old one', state.declared[0].config.env.GITHUB_TOKEN, 'ghp_brandnew')
}

{
	// Headers round-trip the same way.
	const declared = [
		{ serverName: 'remote', enabled: true, config: { transport: 'streamable-http', url: 'https://h.test/mcp', headers: { Authorization: 'Bearer keepme' } } }
	]
	const { manager, state } = makeManager({ tools: makeTools([]), declared, loader: makeLoader([]) })
	await manager.apply({
		kind: OP.MCP_CONFIGURE,
		serverName: 'remote',
		config: { transport: 'streamable-http', url: 'https://h.test/mcp2', headers: { Authorization: SECRET_MASK } }
	})
	check('a masked header keeps the live value', state.declared[0].config.headers.Authorization, 'Bearer keepme')
	check('the url change was applied', state.declared[0].config.url, 'https://h.test/mcp2')
}

// ---------------------------------------------------------------------------
section('degradation: missing services never throw')

{
	const cases = [
		['no tools, no loader, no manager', { tools: undefined, loader: undefined, pluginManager: undefined }],
		['no loader', { tools: makeTools([]), loader: undefined, pluginManager: undefined }],
		['no declared store', { tools: makeTools([]), loader: makeLoader([]), declared: undefined }]
	]
	for (const [label, options] of cases) {
		const { manager } = makeManager(options)
		let threw = null
		try {
			const inventory = await manager.describe()
			if (!Array.isArray(inventory.servers)) threw = 'servers is not an array'
			const outcome = await manager.apply({ kind: OP.MCP_TOGGLE, serverName: 'nope', enabled: false })
			if (outcome.status !== STATUS.REFUSED) threw = `expected refused, got ${outcome.status}`
			manager.refresh()
			await manager.dispose()
		} catch (error) {
			threw = String(error)
		}
		check(`${label}: no exception`, threw, null)
	}
}

{
	// Disabling without a plugin manager must refuse with a reason, not crash.
	const tools = makeTools([])
	const loader = makeLoader([{ id: '7', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'stdio', serverName: 'outer', command: 'x' }, phase: 2 }])
	const { manager } = makeManager({ tools, loader })
	const outcome = await manager.apply({ kind: OP.MCP_TOGGLE, serverName: 'outer', enabled: false })
	check('toggle without a plugin manager is refused', outcome.status, STATUS.REFUSED)
	check('the refusal explains why', outcome.detail.includes('plugin manager'), true)
}

{
	// A readOnlyReason must disable the control AND be explained.
	const tools = makeTools([])
	const loader = makeLoader([{ id: '8', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'stdio', serverName: 'locked', command: 'x' }, phase: 2 }])
	const pluginManager = {
		async listPlugins() {
			return [{ entryId: '8', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: true, fiberPhase: 'active', readOnlyReason: 'management-required' }]
		},
		async setPluginEnabled() {
			throw new Error('must not be called for a read-only row')
		}
	}
	const { manager } = makeManager({ tools, loader, pluginManager })
	const inventory = await manager.describe()
	check('readOnlyReason is surfaced on the row', inventory.servers[0].readOnlyReason, 'management-required')
	check('a read-only row is not addressable', inventory.servers[0].addressable, false)
	const outcome = await manager.apply({ kind: OP.MCP_TOGGLE, serverName: 'locked', enabled: false })
	check('toggling a read-only row is refused', outcome.status, STATUS.REFUSED)
	check('the refusal names the reason', outcome.detail.includes('management-required'), true)
}

// ---------------------------------------------------------------------------
section('plugin manager result mapping')

{
	const mapping = [
		['applied', STATUS.APPLIED],
		['restart-required', STATUS.RESTART_REQUIRED],
		['overridden', STATUS.REFUSED],
		['failed', STATUS.REFUSED],
		['cancelled', STATUS.REFUSED],
		['something-new', STATUS.REFUSED]
	]
	for (const [application, expected] of mapping) {
		const tools = makeTools([])
		const loader = makeLoader([{ id: '3', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'stdio', serverName: 'outer', command: 'x' }, phase: 2 }])
		const pluginManager = {
			async listPlugins() {
				return [{ entryId: '3', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: false, fiberPhase: null, patchId: 'p' }]
			},
			async setPluginEnabled() {
				return { changed: true, application, stage: 'enable', target: '3', error: { code: 'operation-error', diagnostic: 'boom' } }
			}
		}
		const { manager } = makeManager({ tools, loader, pluginManager })
		const outcome = await manager.apply({ kind: OP.MCP_TOGGLE, serverName: 'outer', enabled: true })
		check(`application "${application}" -> ${expected}`, outcome.status, expected)
		if (expected === STATUS.REFUSED && application === 'failed') {
			check('a failed change carries the diagnostic', outcome.detail.includes('boom'), true)
		}
		if (application === 'overridden') {
			check('an overridden change is explained', outcome.detail.includes('higher-priority layer'), true)
		}
		if (application === 'restart-required') {
			check('a restart is explained', outcome.detail.includes('restart'), true)
		}
	}
}

{
	// A throwing plugin manager must be refused, not propagated.
	const tools = makeTools([])
	const loader = makeLoader([{ id: '2', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'stdio', serverName: 'outer', command: 'x' }, phase: 2 }])
	const pluginManager = {
		async listPlugins() {
			return [{ entryId: '2', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: true, fiberPhase: 'active', patchId: 'p' }]
		},
		async setPluginEnabled() {
			throw new Error('remote exploded')
		}
	}
	const { manager } = makeManager({ tools, loader, pluginManager })
	const outcome = await manager.apply({ kind: OP.MCP_TOGGLE, serverName: 'outer', enabled: false })
	check('a throwing manager is refused', outcome.status, STATUS.REFUSED)
	check('the throw is reported', outcome.detail.includes('remote exploded'), true)
}

// ---------------------------------------------------------------------------
section('unknown operations and batch semantics')

{
	const { manager } = makeManager({ tools: makeTools([]), loader: makeLoader([]) })
	const outcome = await manager.apply({ kind: 'mcp.nonsense' })
	check('an unknown op is refused', outcome.status, STATUS.REFUSED)
	check('the op kind is echoed back', outcome.kind, 'mcp.nonsense')
	const empty = await manager.apply(undefined)
	check('a missing op is refused, not thrown', empty.status, STATUS.REFUSED)

	const batch = await manager.applyBatch([
		{ kind: OP.MCP_ADD, serverName: 'one', config: { transport: 'stdio', command: 'node' }, enabled: false },
		{ kind: OP.MCP_ADD, serverName: 'one', config: { transport: 'stdio', command: 'node' }, enabled: false },
		{ kind: 'bogus' }
	])
	check('one result per operation', batch.length, 3)
	check('the first add applied', batch[0].status, STATUS.APPLIED)
	check('the duplicate in the same batch was refused', batch[1].status, STATUS.REFUSED)
	check('the bogus op was refused', batch[2].status, STATUS.REFUSED)
	check('a non-array batch yields no results', (await manager.applyBatch(undefined)).length, 0)
}

// ---------------------------------------------------------------------------
section('removal refuses an outer row and accepts a declared one')

{
	const tools = makeTools(['mcp__outer__t'])
	const loader = makeLoader([{ id: '1', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'stdio', serverName: 'outer', command: 'x' }, phase: 2 }])
	const { manager } = makeManager({ tools, loader })
	const outcome = await manager.apply({ kind: OP.MCP_REMOVE, serverName: 'outer' })
	check('an outer row cannot be removed', outcome.status, STATUS.REFUSED)
	check('the refusal explains ownership', outcome.detail.includes('outer composition layer'), true)
}

{
	const { manager, state } = makeManager({ tools: makeTools([]), declared: [STDIO_DECL], loader: makeLoader([]) })
	const outcome = await manager.apply({ kind: OP.MCP_REMOVE, serverName: 'local-tools' })
	check('a declared server is removed', outcome.status, STATUS.APPLIED)
	check('the declaration is gone', state.declared.length, 0)
	const again = await manager.apply({ kind: OP.MCP_REMOVE, serverName: 'local-tools' })
	check('removing twice is refused the second time', again.status, STATUS.REFUSED)
}

{
	// Configuring an outer row is refused: it is not ours to rewrite.
	const tools = makeTools([])
	const loader = makeLoader([{ id: '1', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'stdio', serverName: 'outer', command: 'x' }, phase: 2 }])
	const { manager } = makeManager({ tools, loader })
	const outcome = await manager.apply({ kind: OP.MCP_CONFIGURE, serverName: 'outer', config: { transport: 'stdio', command: 'y' } })
	check('an outer row cannot be configured here', outcome.status, STATUS.REFUSED)
}

// ---------------------------------------------------------------------------
section('JSON import: documents copied out of other MCP clients')

{
	// The exact shape a user copies from Claude Desktop / Cursor / Claude Code.
	const document = JSON.stringify({
		mcpServers: {
			'bing-search': { command: 'npx', args: ['-y', 'bing-cn-mcp'] },
			playwright: { command: 'npx', args: ['@playwright/mcp@latest', '--headless'] }
		}
	})
	const parsed = parseMcpServers(document)
	check('both servers are parsed', parsed.servers.map((server) => server.serverName), ['bing-search', 'playwright'])
	check('the first is normalised to stdio', parsed.servers[0].config, {
		transport: 'stdio',
		command: 'npx',
		args: ['-y', 'bing-cn-mcp'],
		env: {},
		cwd: ''
	})
	check('the second keeps its flags', parsed.servers[1].config.args, ['@playwright/mcp@latest', '--headless'])
	check('no errors are reported', parsed.errors, [])
	check('entries preserve document order', parsed.entries.map((entry) => entry.serverName), ['bing-search', 'playwright'])
}

{
	// VS Code (`servers`) plus the `http` type spelling.
	const vscode = parseMcpServers({
		servers: {
			remote: { type: 'http', url: 'https://mcp.example.test/mcp', headers: { Authorization: 'Bearer x' } }
		}
	})
	check('the "servers" wrapper is accepted', vscode.servers[0].serverName, 'remote')
	check('type "http" maps onto streamable-http', vscode.servers[0].config.transport, 'streamable-http')
	check('a header survives the import', vscode.servers[0].config.headers, { Authorization: 'Bearer x' })

	const bare = parseMcpServers({ plain: { command: 'node', args: 'server.mjs' } })
	check('a bare name map is accepted', bare.servers[0].serverName, 'plain')
	check('a single string arg is wrapped', bare.servers[0].config.args, ['server.mjs'])

	const typed = parseMcpServers({ local: { type: 'stdio', command: 'node' } })
	check('an explicit stdio type is honoured', typed.servers[0].config.transport, 'stdio')
	check('omitted args default to an empty list', typed.servers[0].config.args, [])

	// A remote entry without a type is inferred from `url`, which is what
	// Cursor documents rely on.
	const inferred = parseMcpServers({ cursorish: { url: 'https://c.test/mcp' } })
	check('a url-only entry is inferred as streamable-http', inferred.servers[0].config.transport, 'streamable-http')
}

{
	const off = parseMcpServers({
		off: { command: 'node', disabled: true },
		off2: { command: 'node', enabled: false },
		on: { command: 'node' }
	})
	check('disabled:true declares the server disabled', off.servers[0].enabled, false)
	check('enabled:false declares the server disabled', off.servers[1].enabled, false)
	check('an entry without a flag is enabled', off.servers[2].enabled, true)
}

{
	// Refusals must name the problem and never throw.
	const cases = [
		['an empty document', '', /empty/],
		['malformed JSON', '{"mcpServers": ', /not valid JSON/],
		['two documents pasted in a row', '{"mcpServers": {}}\n{"mcpServers": {}}', /one document at a time/],
		['an array', '[{"name":"x"}]', /not an array/],
		['a server without a name', { command: 'npx' }, /server name is required/],
		['an empty map', { mcpServers: {} }, /no servers were found/],
		['a wrapper that is not an object', { mcpServers: [] }, /"mcpServers" must be an object/],
		['an illegal name', { 'bad.name': { command: 'npx' } }, /not a valid serverName/],
		['the sse transport', { x: { type: 'sse', url: 'https://x.test/sse' } }, /"sse" transport/],
		['an unknown transport', { x: { type: 'carrier-pigeon', command: 'npx' } }, /unsupported transport/],
		['neither command nor url', { x: {} }, /neither "command"/],
		['non-string args', { x: { command: 'npx', args: ['-y', 3] } }, /args must contain strings/],
		['a null env value', { x: { command: 'npx', env: { A: null } } }, /env\.A must be a string/],
		['a malformed url', { x: { url: 'not a url' } }, /not a valid absolute URL/]
	]
	for (const [label, input, pattern] of cases) {
		const parsed = parseMcpServers(input)
		check(`${label}: refused`, parsed.servers.length === 0 && parsed.errors.length === 1, true)
		check(`${label}: the reason is actionable`, pattern.test(parsed.errors[0]?.error ?? ''), true)
	}
}

{
	// Partial success is deliberate: one bad key must not discard the good ones.
	const mixed = parseMcpServers({ good: { command: 'node' }, 'bad name': { command: 'node' } })
	check('a valid entry survives a sibling error', mixed.servers.map((server) => server.serverName), ['good'])
	check('the bad entry is reported by name', mixed.errors[0].serverName, 'bad name')
	check('entries keep document order', mixed.entries.map((entry) => entry.serverName), ['good', 'bad name'])
}

// ---------------------------------------------------------------------------
section('JSON import: one persist, one result per server, honest statuses')

/** A mount that publishes the same one tool per server, so no wait is needed. */
function mountPublishesOneTool(config, tools, registered) {
	const name = `mcp__${config.serverName}__ping`
	tools.add(name)
	registered?.push(name)
}

{
	const tools = makeTools([])
	const { manager, state, getLastWrite } = makeManager({
		tools,
		loader: makeLoader([]),
		onMount: mountPublishesOneTool
	})
	const results = await manager.apply({
		kind: OP.MCP_IMPORT,
		json: JSON.stringify({
			mcpServers: {
				'bing-search': { command: 'npx', args: ['-y', 'bing-cn-mcp'] },
				playwright: { command: 'npx', args: ['@playwright/mcp@latest', '--headless'] }
			}
		})
	})

	check('one result per pasted server', results.length, 2)
	check('both are applied', results.map((result) => result.status), [STATUS.APPLIED, STATUS.APPLIED])
	check('results are addressed by server name', results.map((result) => result.target), ['bing-search', 'playwright'])
	check('the live tool count is reported', results[0].detail.includes('1 tool'), true)
	check('the whole document is persisted once', getLastWrite().length, 2)
	check('both declarations are stored', state.declared.map((item) => item.serverName), ['bing-search', 'playwright'])
	check('the stored config is normalised', state.declared[0].config.args, ['-y', 'bing-cn-mcp'])
	const inventory = await manager.describe()
	check('imported servers appear in the inventory', inventory.servers.map((server) => server.serverName), ['bing-search', 'playwright'])
	check('the imported servers are declared', inventory.servers.every((server) => server.declared === true), true)
}

{
	// A name that already exists must not be silently overwritten.
	const { manager, getLastWrite, state } = makeManager({ tools: makeTools([]), declared: [STDIO_DECL], loader: makeLoader([]) })
	const results = await manager.apply({ kind: OP.MCP_IMPORT, json: { 'local-tools': { command: 'node' } } })
	check('an already-declared name is unchanged', results[0].status, STATUS.UNCHANGED)
	check('the existing declaration is untouched', state.declared[0].config.command, 'node')
	check('nothing was written', getLastWrite(), undefined)
}

{
	// A name an outer layer owns cannot be declared here.
	const loader = makeLoader([{ id: '1', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'stdio', serverName: 'taken', command: 'x' }, phase: 2 }])
	const { manager, getLastWrite } = makeManager({ tools: makeTools([]), loader })
	const results = await manager.apply({ kind: OP.MCP_IMPORT, json: { taken: { command: 'node' } } })
	check('an outer-layer name is refused', results[0].status, STATUS.REFUSED)
	check('the refusal names the owning layer', results[0].detail.includes('outer composition layer'), true)
	check('an outer collision wrote nothing', getLastWrite(), undefined)
}

{
	// A mixed document: valid, invalid and disabled entries, one result each.
	const tools = makeTools([])
	const { manager, state } = makeManager({ tools, loader: makeLoader([]), onMount: mountPublishesOneTool })
	const results = await manager.apply({
		kind: OP.MCP_IMPORT,
		json: {
			good: { command: 'node' },
			'bad/name': { command: 'node' },
			off: { command: 'node', disabled: true }
		}
	})
	check('three results, in document order', results.map((result) => result.target), ['good', 'bad/name', 'off'])
	check('the valid server was added', results[0].status, STATUS.APPLIED)
	check('the invalid name was refused', results[1].status, STATUS.REFUSED)
	check('a disabled entry is declared, not mounted', results[2].status, STATUS.APPLIED)
	check('only the valid entries were stored', state.declared.map((item) => item.serverName), ['good', 'off'])
	check('the disabled entry is stored disabled', state.declared[1].enabled, false)
	check('a disabled entry registered no tools', tools.schemas().some((schema) => schema.name.startsWith('mcp__off__')), false)
}

{
	// A failed save must refuse every entry it accepted, and mount nothing.
	const tools = makeTools([])
	const { manager } = makeManager({ tools, loader: makeLoader([]), writeThrows: true, onMount: mountPublishesOneTool })
	const results = await manager.apply({ kind: OP.MCP_IMPORT, json: { a: { command: 'node' }, b: { command: 'node' } } })
	check('a failed persist refuses every entry', results.map((result) => result.status), [STATUS.REFUSED, STATUS.REFUSED])
	check('the write failure is reported', results[0].detail.includes('disk is full'), true)
	check('nothing was mounted after a failed save', tools.schemas().length, 0)
}

{
	// A missing document is a refusal, not a crash.
	const { manager, getLastWrite } = makeManager({ tools: makeTools([]), loader: makeLoader([]) })
	const results = await manager.apply({ kind: OP.MCP_IMPORT })
	check('a missing document is refused', results[0].status, STATUS.REFUSED)
	check('a missing document wrote nothing', getLastWrite(), undefined)
}

{
	// The batch contract stays flat: an import contributes its results in place.
	const { manager } = makeManager({ tools: makeTools([]), loader: makeLoader([]), onMount: mountPublishesOneTool })
	const batch = await manager.applyBatch([
		{ kind: OP.MCP_IMPORT, json: { one: { command: 'node' }, two: { command: 'node' } } },
		{ kind: 'mcp.nonsense' }
	])
	check('an import contributes one result per server', batch.length, 3)
	check('the results are the import ones', batch.slice(0, 2).map((result) => result.target), ['one', 'two'])
	check('the following op still gets its own result', batch[2].kind, 'mcp.nonsense')
}

// ---------------------------------------------------------------------------
section('pure helpers')

{
	check('describeTarget for stdio', describeTarget({ transport: 'stdio', command: 'npx', args: ['-y', 'srv'] }), 'npx -y srv')
	check('describeTarget for http', describeTarget({ transport: 'streamable-http', url: 'https://a.test/mcp' }), 'https://a.test/mcp')
	check('redactUrl strips userinfo', redactUrl('https://u:p@a.test/mcp').includes('p@'), false)
	check('redactUrl masks a secret query', redactUrl('https://a.test/mcp?token=abc').includes('abc'), false)
	check('redactUrl keeps a plain query', redactUrl('https://a.test/mcp?page=2').includes('page=2'), true)
	check(
		'normalizeConfig drops unknown keys',
		Object.keys(normalizeConfig({ transport: 'stdio', command: 'n', bogus: 1 }).config).sort(),
		['args', 'command', 'cwd', 'env', 'transport']
	)
	check(
		'normalizeConfig accepts a single string arg',
		normalizeConfig({ transport: 'stdio', command: 'n', args: 'one' }).config.args,
		['one']
	)
	check('normalizeConfig rejects a bad timeout', normalizeConfig({ transport: 'stdio', command: 'n', toolCallTimeoutMs: -5 }).error !== null, true)
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
