/**
 * @lstions/dsh-skill-mcp-panel — MCP server inventory, toggling, and lifecycle.
 *
 * WHY THIS MODULE EXISTS
 * MCP servers reach this harness as `@deepseek-ai/dsh-mcp-client` rows, and a
 * row can arrive from two places: a layer this plugin owns (its own settings
 * declarations) or an outer composition layer — most commonly the profile's
 * `cordis.patch.yml`, which wiring a hand-edited file inserts. A settings card
 * that listed only its own rows would hide exactly the servers a user is most
 * likely to have added by hand, so `describe()` reports BOTH and marks which is
 * which with `declared`.
 *
 * ============================================================================
 * LIVE-MOUNT FINDINGS (measured, not assumed)
 * ============================================================================
 *
 * 1. A plugin CANNOT import the MCP client itself.
 *
 *      $ node -e "import('@deepseek-ai/dsh-mcp-client')"
 *      Error [ERR_MODULE_NOT_FOUND]: Cannot find package
 *      '@deepseek-ai/dsh-mcp-client'
 *
 *    The package is not in this plugin's dependency closure; pnpm only links
 *    the packages a package declares. The host's Loader resolves from ITS own
 *    location instead, where the install's hoisted `.pnpm/node_modules` is
 *    reachable:
 *
 *      $ node -e "createRequire('<...>/cordis-plugin-loader/lib/index.js')
 *                 .resolve('@deepseek-ai/dsh-mcp-client')"
 *      -> .../@deepseek-ai+dsh-mcp-client@0.1.6-alpha.2.../lib/index.js
 *
 *    So the module is obtained through `ctx.loader.import(spec)` and mounted
 *    with `ctx.plugin(module, config)`. Measured end to end by
 *    `node test/mcp-probe.mjs`, which runs a real Cordis tree, mounts the real
 *    MCP client against a real MCP stdio server, and reads the real registry:
 *
 *      { "resolved": ".../dsh-mcp-client/lib/index.js",
 *        "mounted": true,
 *        "tools": ["mcp__probe__ping"],
 *        "afterDispose": [],
 *        "exports": ["Config","apply","createMcpToolDefinition","inject","name"],
 *        "hasDefault": false,
 *        "registryLog": ["register mcp__probe__ping",
 *                         "unregister mcp__probe__ping"] }
 *
 *    Two consequences are load-bearing below:
 *
 *    - `applied` is only ever reported after the mount settles AND the expected
 *      tools are observed registered. Anything less is `restart-required`.
 *    - **mcp-client is a namespace plugin with NO default export.** Cordis
 *      accepts any object carrying `apply`, so the MODULE ITSELF is passed to
 *      `ctx.plugin`. Passing `module.default` yields `undefined` and Cordis
 *      rejects it as an invalid plugin.
 *
 * 2. `ctx.plugin()` disposes correctly: the fiber returned by `ctx.plugin` is
 *    awaitable (it resolves once injects are ready and async `apply` settles)
 *    and `await fiber.dispose()` closes the connection and unregisters every
 *    tool the server contributed — see `unregister mcp__probe__ping` above.
 *    That is what makes edit/remove safe without a restart.
 *
 * 3. `ctx.loader.create()` is deliberately NEVER used. A dynamic Loader entry
 *    is written back to disk by the root Include's `write()`, and the profile's
 *    `cordis.yml` is an empty `[]` baseline: a runtime-added row would be
 *    persisted into the user's own composition file as a side effect of opening
 *    a settings card. No measurement was needed to reject this — the write path
 *    is unconditional in the Loader — so every live change here goes through
 *    `ctx.plugin()` (an in-memory fiber) plus a settings declaration, and the
 *    settings namespace is the only thing that persists.
 *
 * 4. DISPOSAL IS ASYNCHRONOUS AND MUST BE OBSERVED. `fiber.dispose()` returns a
 *    promise; the tools survive until it settles. Reporting success before that
 *    would hand the caller a state that is briefly wrong, so `#disposeMount`
 *    awaits it.
 *
 * 5. `failOnStartupError` MUST BE FORCED ON FOR A LIVE MOUNT — this is the
 *    difference between an honest `applied` and a lie. Measured directly:
 *
 *      failOnStartupError=false (the schema default), command=/nonexistent:
 *        -> settled, tools=0          <-- the mount "succeeds" while dead
 *      failOnStartupError=true,  command=/nonexistent:
 *        -> REJECTED: mcp-client(...): initial connection or tool
 *           synchronization failed, tools=0
 *      failOnStartupError=true,  valid server:
 *        -> settled, tools=["mcp__ok__ping"]   <-- still mounts fine
 *
 *    So with the default, a server whose command does not exist produces a
 *    settled fiber and an empty registry: awaiting the fiber alone would report
 *    `applied` for a server that never ran. Every live mount here therefore
 *    overrides the flag to `true`, which costs nothing for a healthy server and
 *    converts a silent dead mount into an observable rejection.
 *
 *    The override applies to the LIVE instance only. What is persisted keeps the
 *    value the user chose, because the persisted config governs the NEXT host
 *    start, where their tolerance preference genuinely applies — a different
 *    question from "did the mount I just performed work?".
 *
 * 6. A SUCCESSFUL MOUNT ALREADY HAS ITS TOOLS. The client completes its initial
 *    `tools/list` and registers the generation BEFORE the fiber settles, so a
 *    settled fiber with `failOnStartupError: true` is registry-backed evidence.
 *    `#awaitTools` is a bounded safety net for slow servers, never the source of
 *    the claim.
 *
 * @module @lstions/dsh-skill-mcp-panel/mcp
 */

import { accessSync, constants as fsConstants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

import {
	credentialRefs,
	hasCredentialTemplate,
	maskDict,
	templateSyntaxError,
	unmaskDict,
	OP,
	STATUS,
	SECRET_KEY_PATTERN,
	SECRET_MASK
} from './contract.js'

/**
 * Module specifier of the MCP client bridge, as it appears in composition rows
 * and in the Loader's `options.name`.
 */
export const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** Valid `serverName`, matching the MCP client's own schema exactly. */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Transport kinds this module understands. */
export const TRANSPORTS = Object.freeze(['stdio', 'streamable-http'])

/**
 * Keys of the per-transport connection options, used to build the `config`
 * object handed to the MCP client and to mask secrets on the way out.
 */
const STDIO_KEYS = Object.freeze(['command', 'args', 'env', 'cwd'])
const HTTP_KEYS = Object.freeze(['url', 'headers'])
/** Options shared by both transports. */
const COMMON_KEYS = Object.freeze(['toolCallTimeoutMs', 'failOnStartupError', 'expandTemplates', 'reconnect'])

/** Fiber states mirrored from Cordis, so `phase` never depends on internals. */
const FIBER_PHASE = Object.freeze({
	0: 'pending',
	1: 'loading',
	2: 'active',
	3: 'failed',
	4: null,
	5: 'unloading'
})

/**
 * Build an `ApplyResult` (see `contract.js`).
 * @param {string} kind - the requested {@link OP}.
 * @param {string} status - one of `STATUS`.
 * @param {string} detail - human-readable outcome.
 * @param {string} [target] - name or row id the operation addressed.
 * @returns {object} an ApplyResult.
 */
function result(kind, status, detail, target) {
	const out = { kind, ok: status === STATUS.APPLIED || status === STATUS.UNCHANGED, status, detail }
	if (target !== undefined) out.target = target
	return out
}

/** Coerce a possibly-absent value to a trimmed string, or `''`. */
function text(value) {
	return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim()
}

/** Upper bound on a user note, so one paste cannot fill the settings document. */
export const NOTE_MAX_LENGTH = 200

/**
 * Normalise the optional human note stored beside a server.
 *
 * The note is management metadata, not connection data: it never reaches the MCP
 * client, and it is what lets a list of similarly named servers (several
 * `npx` entries, say) stay distinguishable. Absent means "no note", which is
 * different from a note that was cleared — both are stored as `''`.
 *
 * @param {unknown} value - the submitted note.
 * @returns {{note: string, error: string|null}}
 */
export function normalizeNote(value) {
	if (value === undefined || value === null) return { note: '', error: null }
	if (typeof value !== 'string') return { note: '', error: 'a note must be a string' }
	const note = value.trim()
	if (note.length > NOTE_MAX_LENGTH) {
		return { note: '', error: `a note may be at most ${NOTE_MAX_LENGTH} characters` }
	}
	return { note, error: null }
}

/**
 * Resolve an executable the way the host will when it spawns the MCP server.
 *
 * THE FAILURE THIS PREVENTS: a server whose command does not exist is persisted
 * first and only fails when the client tries to spawn it, leaving the panel with
 * a row that can never produce tools ("saved, takes effect after restart" and no
 * tools, forever). The spawn uses THIS process's PATH — the same PATH the MCP
 * client has, because it spawns from the host — so resolving here is the honest
 * pre-flight.
 *
 * @param {string} command - the configured command: a bare name or a path.
 * @param {NodeJS.ProcessEnv} [env] - environment whose PATH/PATHEXT to use.
 * @returns {{path: string|null, error: string|null}}
 */
export function resolveCommand(command, env = process.env) {
	const raw = text(command)
	if (raw === '') return { path: null, error: 'command is empty' }
	const windows = process.platform === 'win32'
	const hasSeparator = raw.includes('/') || (windows && raw.includes('\\'))
	const extensions = windows
		? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((entry) => entry !== '')
		: ['']
	const candidates = []
	if (hasSeparator || isAbsolute(raw)) {
		candidates.push(raw)
	} else {
		// Windows setups may expose PATH as `Path`; both are consulted before giving up.
		for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
			if (dir === '') continue
			for (const extension of extensions) candidates.push(join(dir, raw + extension))
		}
	}
	for (const candidate of candidates) {
		try {
			if (!statSync(candidate).isFile()) continue
			accessSync(candidate, fsConstants.X_OK)
			return { path: candidate, error: null }
		} catch {}
	}
	return {
		path: null,
		error: hasSeparator || isAbsolute(raw)
			? 'command "' + raw + '" does not exist or is not executable'
			: 'command "' + raw + '" was not found on PATH'
	}
}

/**
 * Flatten an error and its `cause` chain into one actionable sentence.
 *
 * The MCP client wraps the real failure ("initial connection or tool
 * synchronization failed") and keeps the reason in `cause`: a spawn ENOENT, a
 * package download error, a handshake timeout. Reporting only the wrapper told
 * the user nothing about why their server had no tools, so the chain is walked
 * (bounded, cycle-safe) and joined.
 *
 * @param {unknown} error - a thrown value.
 * @returns {string} every distinct message, outermost first.
 */
export function describeFailure(error) {
	const messages = []
	const seen = new Set()
	const add = (value) => {
		if (value === null || value === undefined) return
		const message = typeof value?.message === 'string' ? value.message.trim() : String(value).trim()
		if (message !== '' && !seen.has(message)) {
			seen.add(message)
			messages.push(message)
		}
		if (Array.isArray(value?.errors)) for (const inner of value.errors) add(inner)
	}
	let current = error
	for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
		add(current)
		current = current?.cause
	}
	return messages.join(': ') || 'unknown error'
}

/**
 * Normalise one submitted connection config into the exact shape the MCP client
 * schema accepts, dropping unknown keys so a stray UI field can never make the
 * mount fail validation.
 *
 * Secrets are reconciled against `current` here: `unmaskDict` restores any value
 * the browser echoed back as {@link SECRET_MASK} from the live configuration, so
 * saving a form the user never touched cannot overwrite a real token with the
 * mask.
 *
 * @param {object} raw - submitted config, secrets possibly masked.
 * @param {object} [current] - the live config holding real values.
 * @returns {{config: object, error: string|null}} the normalised config or a reason.
 */
export function normalizeConfig(raw, current = {}) {
	const source = raw !== null && typeof raw === 'object' ? raw : {}
	const transport = text(source.transport)
	if (!TRANSPORTS.includes(transport)) {
		return { config: null, error: `transport must be one of ${TRANSPORTS.join(', ')}` }
	}
	const config = { transport }

	if (transport === 'stdio') {
		const command = text(source.command)
		if (command === '') return { config: null, error: 'command is required for a stdio server' }
		config.command = command
		const args = Array.isArray(source.args)
			? source.args.filter((item) => typeof item === 'string')
			: typeof source.args === 'string' && source.args.trim() !== ''
				? [source.args.trim()]
				: []
		config.args = args
		const env = unmaskDict(source.env, current?.env)
		config.env = {}
		for (const [key, value] of Object.entries(env)) {
			if (typeof value === 'string') config.env[key] = value
		}
		config.cwd = text(source.cwd)
	} else {
		const url = text(source.url)
		if (url === '') return { config: null, error: 'url is required for a streamable-http server' }
		try {
			new URL(url)
		} catch {
			return { config: null, error: `url is not a valid absolute URL: ${url}` }
		}
		// The browser is shown a redacted URL (userinfo dropped, secret query
		// values masked). If it echoes that redacted form back unchanged, keep the
		// stored URL — otherwise "edit the note" would silently drop credentials
		// the user never touched.
		const currentUrl = text(current?.url)
		config.url = currentUrl !== '' && url === redactUrl(currentUrl) ? currentUrl : url
		const headers = unmaskDict(source.headers, current?.headers)
		config.headers = {}
		for (const [key, value] of Object.entries(headers)) {
			if (typeof value === 'string') config.headers[key] = value
		}
	}

	for (const key of COMMON_KEYS) {
		const value = source[key]
		if (value === undefined || value === null) continue
		if (key === 'toolCallTimeoutMs') {
			const ms = Number(value)
			if (!Number.isFinite(ms) || ms <= 0) return { config: null, error: 'toolCallTimeoutMs must be a positive number' }
			config.toolCallTimeoutMs = ms
		} else if (key === 'failOnStartupError') {
			config.failOnStartupError = Boolean(value)
		} else if (key === 'expandTemplates') {
			config.expandTemplates = Boolean(value)
		} else if (value !== null && typeof value === 'object') {
			config.reconnect = value
		}
	}

	// A credential template only works when the client expands it; asking the
	// user to set a second flag would be a trap (the literal token would be sent
	// to the server as the header value). Any well-formed token turns expansion
	// on by itself, and then every template occurrence must be a token — the same
	// rule the client enforces at mount time, checked before anything is saved.
	const templateStrings = configTemplateStrings(config)
	if (templateStrings.some((entry) => hasCredentialTemplate(entry.value))) config.expandTemplates = true
	if (config.expandTemplates === true) {
		for (const entry of templateStrings) {
			const error = templateSyntaxError(entry.value, entry.path)
			if (error !== null) return { config: null, error }
		}
	}
	return { config, error: null }
}

/**
 * Every transport string that can carry a credential template, with its
 * configuration path. Mirrors the MCP client's own list (it resolves exactly
 * these strings), so a token anywhere else is not silently ignored.
 *
 * @param {object} config - a normalised transport config.
 * @returns {Array<{path: string, value: string}>}
 */
export function configTemplateStrings(config) {
	if (config === null || typeof config !== 'object') return []
	const entries = []
	if (config.transport === 'stdio') {
		entries.push({ path: 'command', value: config.command ?? '' })
		for (const [index, arg] of (Array.isArray(config.args) ? config.args : []).entries()) {
			entries.push({ path: 'args[' + index + ']', value: arg })
		}
		entries.push({ path: 'cwd', value: config.cwd ?? '' })
		for (const [key, value] of Object.entries(config.env ?? {})) {
			entries.push({ path: 'env.' + key, value: String(value) })
		}
	} else {
		entries.push({ path: 'url', value: config.url ?? '' })
		for (const [key, value] of Object.entries(config.headers ?? {})) {
			entries.push({ path: 'headers.' + key, value: String(value) })
		}
	}
	return entries
}

/**
 * The display target of a server: the command line for stdio, the URL for HTTP.
 *
 * The URL form is redacted before display. A masked `config` still carries the
 * raw URL — masking covers the `headers` dictionary, not a URL a user pasted a
 * token into — so a credential embedded as userinfo or as a secret-looking query
 * parameter would otherwise leak through the one field the card shows verbatim.
 * A command line is shown as-is: it is the thing the user needs to read, and
 * `env` (where stdio secrets actually live) is masked separately.
 *
 * @param {object} config - a resolved server config.
 * @returns {string}
 */
export function describeTarget(config) {
	if (config?.transport === 'streamable-http') return redactUrl(text(config.url))
	const command = text(config?.command)
	if (command === '') return ''
	const args = Array.isArray(config?.args) ? config.args : []
	return [command, ...args].join(' ')
}

/**
 * Strip credentials and secret-looking query values from a URL for display.
 * An unparseable value is returned unchanged rather than hidden, so a
 * malformed URL stays visible as the problem it is.
 *
 * @param {string} value - the raw URL.
 * @returns {string} a display-safe URL.
 */
export function redactUrl(value) {
	if (value === '') return ''
	let url
	try {
		url = new URL(value)
	} catch {
		return value
	}
	if (url.username !== '' || url.password !== '') {
		url.username = ''
		url.password = ''
	}
	for (const key of [...url.searchParams.keys()]) {
		if (SECRET_KEY_PATTERN.test(key)) url.searchParams.set(key, SECRET_MASK)
	}
	return url.toString()
}

/**
 * Wrapper keys a pasted document may use around its server map.
 *
 * `mcpServers` is the Claude Desktop / Claude Code / Cursor spelling and
 * `servers` is the VS Code `.vscode/mcp.json` one. Both are accepted because
 * the failure mode of guessing wrong is a document that looks valid to its
 * author and yields "no servers were found" here.
 */
const IMPORT_WRAPPERS = Object.freeze(['mcpServers', 'servers'])

/**
 * Transport names accepted from a pasted document, lower-cased.
 *
 * The MCP client schema accepts exactly `stdio` and `streamable-http`; the other
 * spellings are what clients in the wild write (`http` in Claude Code and VS
 * Code). `sse` is deliberately ABSENT: the client has no SSE transport, and
 * mapping it onto streamable-http would promise a connection that cannot be
 * established.
 */
const TRANSPORT_ALIASES = Object.freeze({
	stdio: 'stdio',
	http: 'streamable-http',
	'streamable-http': 'streamable-http',
	streamablehttp: 'streamable-http',
	'streamable_http': 'streamable-http'
})

/**
 * Coerce one pasted dictionary (`env` / `headers`) to `Record<string, string>`.
 *
 * Scalar values are stringified because hand-written JSON often carries a
 * number (a port) where the schema wants a string; a null, array, or nested
 * object is REFUSED rather than silently dropped, because dropping an
 * environment variable changes what the server runs with.
 *
 * @param {unknown} value - the submitted dictionary, or undefined.
 * @param {string} where - dotted path used in the error message.
 * @returns {{dict: object|null, error: string|null}}
 */
function importStringDict(value, where) {
	if (value === undefined || value === null) return { dict: {}, error: null }
	if (typeof value !== 'object' || Array.isArray(value)) {
		return { dict: null, error: `${where} must be an object of string values` }
	}
	const dict = {}
	for (const [key, item] of Object.entries(value)) {
		if (typeof item === 'string') dict[key] = item
		else if (typeof item === 'number' || typeof item === 'boolean') dict[key] = String(item)
		else return { dict: null, error: `${where}.${key} must be a string` }
	}
	return { dict, error: null }
}

/**
 * Read one server entry of a pasted document.
 *
 * The accepted shape is the one every MCP client shares: `command`/`args`/
 * `env`/`cwd` for stdio, `url`/`headers` for a remote server, plus an optional
 * `type` (or `transport`) discriminator. Unknown keys are ignored — clients add
 * their own (`alwaysAllow`, `autoApprove`, `inputs`), and refusing them would
 * reject documents that are valid everywhere else.
 *
 * A NAME PROBLEM IS NOT A PARSE FAILURE. The name is exactly what the review
 * step lets the user fix, so an invalid key still yields its normalised
 * configuration plus a `nameError`; only the connection fields themselves can
 * leave `config` null. That distinction is what makes "paste a raw server
 * object, then name it" work instead of failing as malformed.
 *
 * @param {string|null} serverName - the map key, or null for a nameless raw entry.
 * @param {unknown} entry - the entry's value.
 * @returns {{serverName: string|null, config: object|null, enabled: boolean, nameError: string|null, configError: string|null}}
 */
function parseImportedEntry(serverName, entry) {
	const label = serverName === null ? 'this entry' : `"${serverName}"`
	if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
		return {
			serverName,
			config: null,
			enabled: true,
			nameError: null,
			configError: `${label} must be an object describing that server`
		}
	}

	const declaredTransport = text(entry.type ?? entry.transport).toLowerCase()
	let transport
	let configError = null
	if (declaredTransport === '') {
		// No discriminator: infer from the fields the document actually carries,
		// which is what Claude Desktop and Cursor documents rely on.
		if (text(entry.url) !== '') transport = 'streamable-http'
		else if (text(entry.command) !== '') transport = 'stdio'
		else configError = `${label} has neither "command" (stdio) nor "url" (streamable-http)`
	} else if (declaredTransport === 'sse') {
		configError = `${label} asks for the "sse" transport, which this host does not support: use "streamable-http" or "stdio"`
	} else if (Object.prototype.hasOwnProperty.call(TRANSPORT_ALIASES, declaredTransport)) {
		transport = TRANSPORT_ALIASES[declaredTransport]
	} else {
		configError = `${label} declares the unsupported transport "${declaredTransport}"`
	}

	if (configError === null) {
		if (entry.args !== undefined && entry.args !== null && !Array.isArray(entry.args) && typeof entry.args !== 'string') {
			configError = `${label}.args must be an array of strings`
		} else if (Array.isArray(entry.args) && entry.args.some((item) => typeof item !== 'string')) {
			configError = `${label}.args must contain strings only`
		}
	}
	for (const key of ['enabled', 'disabled']) {
		if (configError === null && entry[key] !== undefined && typeof entry[key] !== 'boolean') {
			configError = `${label}.${key} must be a boolean`
		}
	}
	// `disabled` is the spelling some clients use; `enabled` wins when both are
	// present because it is the more explicit statement of intent.
	const enabled = entry.enabled !== undefined ? entry.enabled : entry.disabled !== true

	const env = importStringDict(entry.env, `${label}.env`)
	const headers = importStringDict(entry.headers, `${label}.headers`)
	if (configError === null && env.error !== null) configError = env.error
	if (configError === null && headers.error !== null) configError = headers.error

	let config = null
	if (configError === null) {
		const raw = { transport }
		if (transport === 'stdio') {
			raw.command = entry.command
			raw.args = entry.args
			raw.env = env.dict
			raw.cwd = entry.cwd
		} else {
			raw.url = entry.url
			raw.headers = headers.dict
		}
		for (const key of COMMON_KEYS) {
			if (entry[key] !== undefined) raw[key] = entry[key]
		}

		// `normalizeConfig` stays the single schema gate: the import path must
		// accept exactly what an equivalent form submission accepts, and one
		// validator means the two can never disagree about what is storable.
		const normalized = normalizeConfig(raw, {})
		config = normalized.config
		configError = normalized.error === null ? null : `${label} is invalid: ${normalized.error}`
	}

	const nameError =
		serverName !== null && !SERVER_NAME_PATTERN.test(serverName)
			? `"${serverName}" is not a valid serverName: it must match ${SERVER_NAME_PATTERN} (1-32 characters of A-Z, a-z, 0-9, "_" or "-")`
			: null
	return { serverName, config, enabled, nameError, configError }
}

/**
 * A parse result holding one document-level error.
 * @param {string} error
 * @returns {{entries: object[]}}
 */
function importFailure(error) {
	return {
		entries: [{ serverName: null, config: null, enabled: true, nameError: null, configError: error }]
	}
}

/**
 * Parse a pasted MCP configuration document.
 *
 * Accepted documents, in order of preference:
 *
 *     { "mcpServers": { "bing-search": { "command": "npx", "args": ["-y", "bing-cn-mcp"] } } }
 *     { "servers":     { … } }                       // VS Code .vscode/mcp.json
 *     { "bing-search": { … } }                       // the bare map, same result
 *     { "command": "npx", "args": [ … ] }            // ONE raw server, still unnamed
 *
 * The last form is what "copy the server object itself" produces. It parses to a
 * single entry with `serverName: null` so the review step can ask for a name,
 * instead of rejecting a paste the user copied verbatim.
 *
 * The function never throws: a document that cannot be used comes back as one
 * entry with a reason a human can act on, because the caller is a settings page
 * that must render the problem rather than crash on it.
 *
 * Entries are judged on their own, so one bad key does not discard the servers
 * the user actually wanted, and every entry yields exactly one preview row and
 * one import result downstream.
 *
 * @param {string|object} input - raw JSON text, or an already-parsed document.
 * @returns {{entries: Array<{serverName: string|null, config: object|null, enabled: boolean, nameError: string|null, configError: string|null}>}}
 *   `entries` preserves document order.
 */
export function parseMcpServers(input) {
	let document
	if (typeof input === 'string') {
		const source = input.replace(/^\uFEFF/, '').trim()
		if (source === '') return importFailure('the JSON text is empty')
		try {
			document = JSON.parse(source)
		} catch (error) {
			const reason = String(error?.message ?? error)
			// Two documents pasted one after another is a real paste (a user
			// collecting examples), and "unexpected character after JSON" does not
			// tell them what to do about it.
			const hint = /after JSON/i.test(reason)
				? ' — paste one document at a time, or merge the servers into a single "mcpServers" object'
				: ''
			return importFailure(`the text is not valid JSON: ${reason}${hint}`)
		}
	} else if (input !== null && typeof input === 'object') {
		document = input
	} else {
		return importFailure('no JSON document was supplied')
	}
	if (Array.isArray(document)) return importFailure('the document must be an object keyed by server name, not an array')

	let map = document
	for (const wrapper of IMPORT_WRAPPERS) {
		if (!Object.prototype.hasOwnProperty.call(document, wrapper)) continue
		const value = document[wrapper]
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			return importFailure(`"${wrapper}" must be an object keyed by server name`)
		}
		map = value
		break
	}
	// A single server object pasted without its name: still importable, but the
	// name has to come from the caller — the page asks for it, and the headless
	// import path refuses it with that instruction.
	if (typeof map.command === 'string' || typeof map.url === 'string') {
		return { entries: [parseImportedEntry(null, map)] }
	}

	const pairs = Object.entries(map)
	if (pairs.length === 0) return importFailure('no servers were found in the document')
	return { entries: pairs.map(([serverName, entry]) => parseImportedEntry(serverName, entry)) }
}


/**
 * A minimal in-memory settings-like store used only when `deps` omits the
 * read/write callbacks. It keeps the module usable in isolation (and in tests)
 * without a settings provider, which is a required degradation case.
 */
function memoryDeclarations() {
	/** @type {object[]} */
	let declared = []
	return {
		read: () => declared,
		write: (next) => {
			declared = Array.isArray(next) ? next : []
		}
	}
}

/**
 * Build the MCP manager.
 *
 * Every dependency is optional at runtime: a missing settings provider, a
 * missing plugin manager, or a missing MCP client package degrades to a
 * reported capability flag rather than a thrown exception, because this object
 * is constructed while a settings card is being served and a throw there would
 * take down the whole state endpoint.
 *
 * @param {object} deps
 * @param {import('@deepseek-ai/cordis').Context} deps.ctx - the plugin's own context.
 * @param {() => object[]} [deps.readDeclared] - servers declared by this plugin.
 * @param {(next: object[]) => void|Promise<void>} [deps.writeDeclared] - persist declarations.
 * @param {() => object} [deps.readConfig] - the resolved plugin config. Accepted
 *   for interface compatibility with the host module's call site; the MCP
 *   surface currently derives everything it needs from the declarations and the
 *   live Loader rows, so it is deliberately not read here. Rejected rather than
 *   silently ignored would be worse: a caller passing it must not break.
 * @param {(message: string) => void} [deps.log] - optional diagnostics sink.
 * @returns {{describe: Function, apply: Function, applyBatch: Function, refresh: Function, dispose: Function}}
 */
export function createMcpManager(deps = {}) {
	const ctx = deps.ctx
	const fallback = memoryDeclarations()
	const readDeclared = typeof deps.readDeclared === 'function' ? deps.readDeclared : fallback.read
	const writeDeclared = typeof deps.writeDeclared === 'function' ? deps.writeDeclared : fallback.write
	const log = typeof deps.log === 'function' ? deps.log : (message) => ctx?.logger?.info?.(message)
	// Injectable so tests can run on a host whose PATH does not carry the
	// commands a fixture uses; production resolves against the real PATH.
	const resolveExecutable = typeof deps.resolveCommand === 'function' ? deps.resolveCommand : resolveCommand

	/**
	 * Live MCP fibers this plugin created, keyed by serverName. A Map (not the
	 * declarations array) is the source of truth for what is mounted NOW, since
	 * a declaration can exist without a successful mount.
	 */
	const mounts = new Map()
	/** Cached module namespace from `ctx.loader.import`; `false` marks a failed lookup. */
	let clientModule
	/** Last inventory, used only for the `refresh()` contract and diagnostics. */
	let lastInventory = null
	let disposed = false

	/** The tool registry, or undefined when the host does not publish one. */
	function toolsRegistry() {
		try {
			return ctx?.get?.('tools')
		} catch {
			return undefined
		}
	}

	/** The plugin manager Remote, or undefined when management is unavailable. */
	function pluginManager() {
		try {
			return ctx?.get?.('pluginManager')
		} catch {
			return undefined
		}
	}

	/** The Loader service, or undefined outside a Loader-hosted tree. */
	function loader() {
		try {
			return ctx?.get?.('loader') ?? ctx?.loader
		} catch {
			return undefined
		}
	}

	/**
	 * Enumerate every live tool belonging to one MCP server.
	 *
	 * Tool names are read from the REAL registry, never inferred from
	 * configuration: a server that failed to connect, or whose generation swap
	 * was rolled back, must report zero tools even though its row exists.
	 *
	 * `ctx.tools.schemas()` is the public projection of visible definitions
	 * (`dsh-tools`), and `get(name)` the scope-aware lookup; both are used so a
	 * registry exposing only one of them still answers.
	 *
	 * @param {string} serverName
	 * @returns {{tools: object[], schemas: Map<string, object>}}
	 */
	function toolsFor(serverName) {
		const prefix = `mcp__${serverName}__`
		const tools = []
		const schemas = new Map()
		const registry = toolsRegistry()
		if (registry === undefined) return { tools, schemas }

		const collected = []
		try {
			if (typeof registry.schemas === 'function') {
				for (const schema of registry.schemas() ?? []) {
					if (typeof schema?.name === 'string') collected.push(schema)
				}
			}
		} catch (error) {
			log(`skill-mcp-panel: could not read ctx.tools.schemas(): ${String(error)}`)
		}
		// A registry may expose `get` without an enumerator; names are then read
		// off the schema list only, which is the same public projection.
		for (const schema of collected) {
			if (!schema.name.startsWith(prefix)) continue
			const definition = typeof registry.get === 'function' ? registry.get(schema.name) : undefined
			const description = text(definition?.description ?? schema.description)
			tools.push({ name: schema.name, description })
			schemas.set(schema.name, { name: schema.name, description })
		}
		tools.sort((a, b) => a.name.localeCompare(b.name))
		return { tools, schemas }
	}

	/**
	 * Wait until a cordis service exists, or give up.
	 *
	 * Services become available asynchronously: the credentials store loads its
	 * file in `Service.init`, so a credential-templated server restored at boot
	 * can race it. Without this wait the pre-flight saw no provider, refused the
	 * mount, and the server stayed disconnected until someone toggled it — the
	 * declaration was right, the boot order was not.
	 *
	 * @param {string} serviceName - service key looked up with `ctx.get`.
	 * @param {number} [timeoutMs] - how long to wait before giving up.
	 * @returns {Promise<boolean>} whether the service exists now.
	 */
	async function waitForService(serviceName, timeoutMs = 5000) {
		if (ctx?.get?.(serviceName) !== undefined) return true
		const deadline = Date.now() + timeoutMs
		while (Date.now() < deadline && !disposed) {
			await new Promise((resolve) => setTimeout(resolve, 50))
			if (ctx?.get?.(serviceName) !== undefined) return true
		}
		return ctx?.get?.(serviceName) !== undefined
	}

	/**
	 * Resolve every credential template in a config BEFORE anything is written.
	 *
	 * The host's MCP client expands credential templates from its `credentials`
	 * service at mount time. A missing provider or an unconfigured reference would
	 * therefore become a server that is saved but can never connect — exactly the
	 * dead row this panel keeps learning to avoid. Checking here names the missing
	 * reference while the user is still looking at the form.
	 *
	 * @param {object} config - a normalised transport config.
	 * @returns {Promise<string|null>} the problem, or null when every reference resolves.
	 */
	async function credentialProblem(config) {
		if (config?.expandTemplates !== true) return null
		const references = [...new Set(configTemplateStrings(config).flatMap((entry) => credentialRefs(entry.value)))]
		if (references.length === 0) return null
		const provider = ctx?.get?.('credentials')
		if (provider === undefined || typeof provider.resolve !== 'function') {
			return 'this host has no credentials provider, so ' + references.map((ref) => '"' + ref + '"').join(', ') + ' cannot be resolved'
		}
		const missing = []
		for (const ref of references) {
			let resolved
			try {
				resolved = await provider.resolve(ref)
			} catch (error) {
				return 'credential "' + ref + '" could not be read: ' + String(error?.message ?? error)
			}
			if (resolved === undefined || resolved === null || typeof resolved.value !== 'string' || resolved.value === '') {
				missing.push(ref)
			}
		}
		if (missing.length > 0) {
			return 'credential ' + missing.map((ref) => '"' + ref + '"').join(', ') + ' is not configured — store it in the harness credentials and retry'
		}
		return null
	}

	/**
	 * Load the MCP client module through the Loader, caching the outcome.
	 *
	 * The Loader resolves from the host anchor, which is the only place the
	 * package is reachable (see the module header). A failure is cached as
	 * `false` so a broken install is not re-imported on every keystroke of a
	 * settings form.
	 *
	 * @returns {Promise<object|false>} the module namespace, or `false` when unavailable.
	 */
	async function loadClientModule() {
		if (clientModule !== undefined) return clientModule
		const service = loader()
		if (service === undefined || typeof service.import !== 'function') {
			clientModule = false
			return clientModule
		}
		try {
			const module = await service.import(MCP_CLIENT_MODULE)
			clientModule = module ?? false
		} catch (error) {
			log(`skill-mcp-panel: ${MCP_CLIENT_MODULE} is not available: ${String(error)}`)
			clientModule = false
		}
		return clientModule
	}

	/** Whether the MCP client package can be reached at all (cached probe). */
	async function clientAvailable() {
		return (await loadClientModule()) !== false
	}

	/**
	 * Read non-group Loader entries whose module is the MCP client.
	 *
	 * These are the rows an OUTER layer inserted — the profile patch, a bundle,
	 * or the host composition — and they are exactly the servers this plugin
	 * does not own but must still show. `row.options.config` carries the row's
	 * own config; `pluginManager.listPlugins()` supplies the addressable
	 * `entryId`, effective `enabled`, and any `readOnlyReason`.
	 *
	 * @returns {Promise<{rows: object[], entries: Map<string, object>, managerAvailable: boolean}>}
	 */
	async function readLoaderRows() {
		const out = { rows: [], entries: new Map(), managerAvailable: false }
		const manager = pluginManager()
		let plugins = []
		if (manager !== undefined && typeof manager.listPlugins === 'function') {
			out.managerAvailable = true
			try {
				plugins = (await manager.listPlugins()) ?? []
			} catch (error) {
				log(`skill-mcp-panel: pluginManager.listPlugins() failed: ${String(error)}`)
			}
		}
		for (const plugin of plugins) {
			if (plugin === null || typeof plugin !== 'object') continue
			out.entries.set(String(plugin.entryId), plugin)
		}

		const service = loader()
		if (service === undefined || typeof service.entries !== 'function') return out
		let iterable
		try {
			iterable = service.entries()
		} catch (error) {
			log(`skill-mcp-panel: could not enumerate loader entries: ${String(error)}`)
			return out
		}
		for (const entry of iterable ?? []) {
			const options = entry?.options
			if (options === undefined || options === null) continue
			if (options.group) continue
			if (options.name !== MCP_CLIENT_MODULE) continue
			let entryId = null
			try {
				entryId = entry.id ?? null
			} catch {
				entryId = null
			}
			const info = entryId === null ? undefined : out.entries.get(String(entryId))
			// `enabled` from the inventory is the EFFECTIVE state (it accounts for
			// a disabled ancestor group); the row's raw `disabled` flag is the
			// fallback when no manager is published.
			const enabled = info !== undefined ? info.enabled !== false : !options.disabled
			out.rows.push({
				entryId,
				moduleName: options.name,
				config: options.config ?? {},
				enabled,
				fiberPhase: entry.fiber === undefined ? null : (FIBER_PHASE[entry.fiber.state] ?? null),
				readOnlyReason: text(info?.readOnlyReason) || null,
				addressable: info !== undefined && info.readOnlyReason === undefined && Boolean(info.patchId)
			})
		}
		return out
	}

	/**
	 * Coerce a stored transport onto the contract's enum.
	 *
	 * A declaration or a loader row is read from a composition file a human can
	 * edit, so an unexpected or missing transport is projected rather than leaked
	 * into the payload as an unknown string. `stdio` is the fallback because its
	 * display derives from fields that are harmless when absent.
	 *
	 * @param {unknown} value - the raw transport.
	 * @returns {'stdio'|'streamable-http'}
	 */
	function transportOf(value) {
		const candidate = text(value)
		return TRANSPORTS.includes(candidate) ? candidate : 'stdio'
	}

	/**
	 * The full transport config with secret-bearing values masked.
	 *
	 * The contract's `McpServerRow.config` is a transport configuration, not just
	 * the env/headers dictionary: the edit form reads `config.transport`,
	 * `config.url` and `config.command` from it, so projecting only the secret
	 * dict left an edit form that defaulted to stdio and dropped the URL.
	 *
	 * @param {object} config - a stored or loader-row transport config.
	 * @returns {object} the same shape, with env/header values masked.
	 */
	function maskedConfigOf(config) {
		const masked = { ...config }
		if (config?.env !== undefined) masked.env = maskDict(config.env)
		if (config?.headers !== undefined) masked.headers = maskDict(config.headers)
		// A URL can carry secrets in userinfo or a secret-looking query parameter;
		// the display target is already redacted, and the config shown to the
		// browser must not be a second, raw copy. Saving the redacted form
		// unchanged restores the raw value (see normalizeConfig).
		if (config?.url !== undefined) masked.url = redactUrl(text(config.url))
		return masked
	}

	/**
	 * One `McpServerRow` for an outer-loader server, with the live tool count.
	 * @param {object} row - a record from {@link readLoaderRows}.
	 * @returns {object} an McpServerRow.
	 */
	function loaderRowToServer(row) {
		const config = row.config !== null && typeof row.config === 'object' ? row.config : {}
		const serverName = text(config.serverName)
		const transport = transportOf(config.transport)
		const { tools } = serverName === '' ? { tools: [] } : toolsFor(serverName)
		return {
			rowId: row.entryId,
			serverName,
			transport,
			target: describeTarget(config),
			enabled: row.enabled,
			declared: false,
			// A note is our own management metadata; an outer row's configuration is
			// not ours to annotate, so it reads as "no note" rather than pretending.
			note: '',
			phase: row.fiberPhase ?? null,
			toolCount: tools.length,
			tools,
			addressable: row.addressable,
			readOnlyReason: row.readOnlyReason,
			editable: false,
			config: maskedConfigOf(config)
		}
	}

	/**
	 * One `McpServerRow` for a server this plugin declared.
	 *
	 * A declaration that matches no live loader row is still listed — that is
	 * precisely the "persisted, restart pending" state the UI must show — and
	 * its `phase` is null while its tools read as zero.
	 *
	 * `rowId` is null by contract for a declared server: it is not a Loader
	 * entry, because `ctx.loader.create()` is deliberately never used (see
	 * LIVE-MOUNT FINDINGS #3). It is addressed by `serverName` everywhere, and
	 * never persisted, which is exactly what keeps the user's `cordis.yml` clean.
	 *
	 * @param {object} declaration - a stored declaration.
	 * @param {object|undefined} live - the mounted fiber, when one exists.
	 * @returns {object} an McpServerRow.
	 */
	function declarationToServer(declaration, live) {
		const config = declaration.config ?? {}
		const { tools } = toolsFor(declaration.serverName)
		return {
			rowId: null,
			serverName: declaration.serverName,
			transport: transportOf(config.transport),
			target: describeTarget(config),
			enabled: declaration.enabled !== false,
			declared: true,
			note: text(declaration.note),
			phase: live === undefined ? null : 'active',
			toolCount: tools.length,
			tools,
			addressable: true,
			readOnlyReason: null,
			editable: true,
			config: maskedConfigOf(config)
		}
	}

	/**
	 * The full inventory: declared servers plus outer-layer rows.
	 *
	 * A serverName present in both is reported ONCE as declared, because this
	 * plugin's own instance is the one it manages; an outer row of the same name
	 * cannot coexist with it in the live tree anyway (the MCP client reserves
	 * the namespace per scope).
	 *
	 * @returns {Promise<{servers: object[], managerAvailable: boolean, mcpClientAvailable: boolean}>}
	 */
	async function describe() {
		const managerAvailable = pluginManager() !== undefined
		const mcpClientAvailable = await clientAvailable()
		const servers = []
		const seen = new Set()

		let declared = []
		try {
			declared = readDeclared() ?? []
		} catch (error) {
			log(`skill-mcp-panel: could not read MCP declarations: ${String(error)}`)
		}
		for (const declaration of declared) {
			if (declaration === null || typeof declaration !== 'object') continue
			const serverName = text(declaration.serverName)
			if (serverName === '') continue
			if (seen.has(serverName)) continue
			seen.add(serverName)
			servers.push(declarationToServer({ ...declaration, serverName }, mounts.get(serverName)))
		}

		const loaderRows = await readLoaderRows()
		for (const row of loaderRows.rows) {
			const serverName = text(row.config?.serverName)
			if (serverName !== '' && seen.has(serverName)) continue
			if (serverName !== '') seen.add(serverName)
			servers.push(loaderRowToServer(row))
		}

		servers.sort((a, b) => a.serverName.localeCompare(b.serverName))
		const inventory = { servers, managerAvailable, mcpClientAvailable }
		lastInventory = inventory
		return inventory
	}

	/**
	 * Mount one server live, through the Loader-provided MCP client module.
	 *
	 * `failOnStartupError` is forced to `true` for the live instance so a dead
	 * server rejects instead of settling silently — see LIVE-MOUNT FINDINGS #5.
	 * Without this the fiber settles for a command that does not exist and the
	 * caller is told `applied` about a server that never started.
	 *
	 * @param {string} serverName
	 * @param {object} config - a normalised transport config.
	 * @returns {Promise<{ok: boolean, error: string|null}>}
	 */
	async function mount(serverName, config) {
		// Pre-flight the spawn the client is about to perform. This covers every
		// path that mounts (add, import, toggle, startup restore) with one check,
		// and it is the difference between "the command is missing" and a generic
		// connection failure an hour later.
		if (config?.transport === 'stdio') {
			const resolved = resolveExecutable(config.command)
			if (resolved.error !== null) return { ok: false, error: resolved.error }
		}
		if (config?.expandTemplates === true) {
			// The credential store is a service that finishes loading its file
			// asynchronously; a boot-time restore can reach this line first.
			await waitForService('credentials')
			const credentialError = await credentialProblem(config)
			if (credentialError !== null) return { ok: false, error: credentialError }
		}
		const module = await loadClientModule()
		if (module === false) return { ok: false, error: `${MCP_CLIENT_MODULE} is not available` }
		if (typeof ctx?.plugin !== 'function') return { ok: false, error: 'ctx.plugin is unavailable' }

		// mcp-client is a NAMESPACE plugin (no default export): the module itself
		// is the plugin object. See LIVE-MOUNT FINDINGS #1.
		const plugin = module.default ?? module
		let fiber
		try {
			fiber = ctx.plugin(plugin, { ...config, serverName, failOnStartupError: true })
			await fiber
		} catch (error) {
			// The wrapper message alone ("initial connection or tool
			// synchronization failed") hides the real reason, which the client keeps
			// in `cause`. Without it the panel reported a server with no tools and
			// no explanation of why.
			return { ok: false, error: describeFailure(error) }
		}
		if (typeof fiber?.dispose !== 'function') {
			// A settled fiber without a disposer cannot be un-mounted; refuse it
			// rather than leak a connection this module could never close.
			return { ok: false, error: 'the mounted fiber exposed no disposer' }
		}
		mounts.set(serverName, fiber)
		return { ok: true, error: null }
	}

	/**
	 * Dispose the live mount for one server and wait for it to settle.
	 *
	 * The await matters: `fiber.dispose()` is asynchronous and the server's tools
	 * stay registered until it resolves, so a caller that returned early would
	 * report a removal the registry has not performed yet.
	 *
	 * @param {string} serverName
	 * @returns {Promise<{removed: boolean, error: string|null}>}
	 */
	async function disposeMount(serverName) {
		const fiber = mounts.get(serverName)
		if (fiber === undefined) return { removed: false, error: null }
		mounts.delete(serverName)
		try {
			await fiber.dispose()
			return { removed: true, error: null }
		} catch (error) {
			return { removed: true, error: String(error?.message ?? error) }
		}
	}

	/**
	 * Read the tools a freshly mounted server registered.
	 *
	 * This is a BOUNDED POLL, not the source of the success claim. The client's
	 * `apply()` awaits `connection.ready`, and the initial `tools/list` sync runs
	 * (`enqueueSync`) before that promise resolves — so a settled fiber mounted
	 * with `failOnStartupError: true` has already registered its generation.
	 * Reading immediately is therefore normally enough; the short loop only
	 * covers a registry whose visibility lags registration by a microtask.
	 *
	 * The timeout is deliberately tiny and the count is reported as observed:
	 * a server that legitimately exposes zero tools must NOT be reported as a
	 * failed mount, and one that exposes tools must not be reported as empty.
	 *
	 * @param {string} serverName
	 * @param {number} [timeoutMs]
	 * @returns {Promise<number>} the observed tool count (0 when the server has none).
	 */
	async function awaitTools(serverName, timeoutMs = 500) {
		const deadline = Date.now() + timeoutMs
		let count = toolsFor(serverName).tools.length
		while (count === 0 && Date.now() < deadline && !disposed) {
			await new Promise((resolve) => setTimeout(resolve, 10))
			count = toolsFor(serverName).tools.length
		}
		return count
	}

	/**
	 * Enable or disable one MCP server.
	 *
	 * A declared server is mounted/unmounted live. An outer-layer row can only be
	 * toggled through the plugin manager, whose `ChangeResult.application` maps
	 * onto {@link STATUS} — including the honest `restart-required` and
	 * `overridden` outcomes, which must never be flattened into `applied`.
	 *
	 * @param {object} op - an `mcp.toggle` operation.
	 * @returns {Promise<object>} an ApplyResult.
	 */
	async function toggle(op) {
		const serverName = text(op?.serverName ?? op?.target)
		if (serverName === '') return result(OP.MCP_TOGGLE, STATUS.REFUSED, 'serverName is required.')
		const enabled = op?.enabled === undefined ? true : Boolean(op.enabled)

		const declared = readDeclaredSafe()
		const declaration = declared.find((item) => item.serverName === serverName)
		if (declaration !== undefined) return await toggleDeclared(declaration, enabled)

		const loaderRows = await readLoaderRows()
		const row = loaderRows.rows.find((item) => text(item.config?.serverName) === serverName)
		if (row === undefined) {
			return result(OP.MCP_TOGGLE, STATUS.REFUSED, `no MCP server named "${serverName}" is declared or mounted.`, serverName)
		}
		return await toggleLoaderRow(row, enabled)
	}

	/** The declared list, never throwing into an apply path. */
	function readDeclaredSafe() {
		try {
			const declared = readDeclared()
			return Array.isArray(declared) ? declared.filter((item) => item !== null && typeof item === 'object') : []
		} catch (error) {
			log(`skill-mcp-panel: could not read MCP declarations: ${String(error)}`)
			return []
		}
	}

	/** Persist a declaration list, surfacing a failure instead of swallowing it. */
	async function persist(next) {
		await writeDeclared(next)
	}

	/**
	 * Toggle a server this plugin declared.
	 * @param {object} declaration
	 * @param {boolean} enabled
	 * @returns {Promise<object>} an ApplyResult.
	 */
	async function toggleDeclared(declaration, enabled) {
		const serverName = declaration.serverName
		const live = mounts.has(serverName)
		// "ALREADY IN THAT STATE" IS ABOUT THE PERSISTED INTENT, NOT LIVENESS.
		// The two are different after any host restart: nothing replays the
		// declarations, so `mounts` is empty while the declaration still says
		// `enabled: true`. Comparing only against `mounts` produced a switch that
		// could not be moved: the row reported enabled, the browser therefore
		// sent `enabled: false`, and that request answered "already disabled"
		// without persisting anything — an unrecoverable loop with the server
		// never running. The declaration is the durable answer to "should this
		// run", so it decides the no-op case, and an unmounted-but-declared
		// enable is a real mount request rather than a no-op.
		const wanted = declaration.enabled !== false
		if (!enabled ? live === false && wanted === false : live === true && wanted === true) {
			return result(OP.MCP_TOGGLE, STATUS.UNCHANGED, `"${serverName}" is already ${enabled ? 'enabled' : 'disabled'}.`, serverName)
		}
		if (!enabled && live === false && wanted === true) {
			// Declared enabled but not mounted: nothing to close, only the intent
			// has to change. Reporting `applied` is honest — the switch moved.
			try {
				await persist(readDeclaredSafe().map((item) => (item.serverName === serverName ? { ...item, enabled: false } : item)))
			} catch (writeError) {
				return result(OP.MCP_TOGGLE, STATUS.REFUSED, `could not save the declaration: ${String(writeError?.message ?? writeError)}`, serverName)
			}
			return result(OP.MCP_TOGGLE, STATUS.APPLIED, `"${serverName}" is disabled; it was not running.`, serverName)
		}

		if (!enabled) {
			const { removed, error } = await disposeMount(serverName)
			// The declaration object belongs to the settings provider; it is never
			// mutated here. Persistence goes through `persist`, and the in-memory
			// view is derived from what was read, freshly, on the next call.
			try {
				await persist(readDeclaredSafe().map((item) => (item.serverName === serverName ? { ...item, enabled: false } : item)))
			} catch (writeError) {
				return result(OP.MCP_TOGGLE, STATUS.REFUSED, `could not save the declaration: ${String(writeError?.message ?? writeError)}`, serverName)
			}
			if (error !== null) {
				return result(OP.MCP_TOGGLE, STATUS.REFUSED, `"${serverName}" was persisted as disabled but its connection did not close cleanly: ${error}`, serverName)
			}
			return result(
				OP.MCP_TOGGLE,
				STATUS.APPLIED,
				removed ? `"${serverName}" is disabled and its connection is closed; its tools are gone.` : `"${serverName}" is disabled.`,
				serverName
			)
		}

		const { config, error: configError } = normalizeConfig(declaration.config, declaration.config)
		if (config === null) return result(OP.MCP_TOGGLE, STATUS.REFUSED, `"${serverName}" cannot be enabled: ${configError}`, serverName)
		const mounted = await mount(serverName, config)
		try {
			await persist(readDeclaredSafe().map((item) => (item.serverName === serverName ? { ...item, enabled: true } : item)))
		} catch (writeError) {
			await disposeMount(serverName)
			return result(OP.MCP_TOGGLE, STATUS.REFUSED, `could not save the declaration: ${String(writeError?.message ?? writeError)}`, serverName)
		}
		if (!mounted.ok) {
			return result(
				OP.MCP_TOGGLE,
				STATUS.RESTART_REQUIRED,
				`"${serverName}" was saved as enabled but cannot be mounted live (${mounted.error}); it takes effect after a restart.`,
				serverName
			)
		}
		const count = await awaitTools(serverName)
		return result(
			OP.MCP_TOGGLE,
			STATUS.APPLIED,
			count > 0 ? `"${serverName}" is connected; ${count} tool(s) are registered.` : `"${serverName}" is connected and exposes no tools.`,
			serverName
		)
	}

	/**
	 * Toggle an outer-loader row through the plugin manager.
	 *
	 * The whole point of this path is that its outcomes are not binary: a profile
	 * patch can require a restart, and a higher-priority layer can override the
	 * request entirely. Both are reported as themselves.
	 *
	 * @param {object} row
	 * @param {boolean} enabled
	 * @returns {Promise<object>} an ApplyResult.
	 */
	async function toggleLoaderRow(row, enabled) {
		const serverName = text(row.config?.serverName) || 'unnamed'
		const manager = pluginManager()
		if (manager === undefined || typeof manager.setPluginEnabled !== 'function') {
			return result(
				OP.MCP_TOGGLE,
				STATUS.REFUSED,
				`"${serverName}" belongs to an outer layer and no plugin manager is available, so it cannot be toggled from here.`,
				serverName
			)
		}
		if (row.readOnlyReason !== null && row.readOnlyReason !== '') {
			return result(OP.MCP_TOGGLE, STATUS.REFUSED, `"${serverName}" is read-only: ${row.readOnlyReason}.`, serverName)
		}
		if (row.entryId === null) {
			return result(OP.MCP_TOGGLE, STATUS.REFUSED, `"${serverName}" has no addressable loader entry.`, serverName)
		}
		let change
		try {
			change = await manager.setPluginEnabled(row.entryId, enabled)
		} catch (error) {
			return result(OP.MCP_TOGGLE, STATUS.REFUSED, `the plugin manager failed: ${String(error?.message ?? error)}`, serverName)
		}
		return mapChangeResult(OP.MCP_TOGGLE, change, serverName)
	}

	/**
	 * Map a plugin manager `ChangeResult` onto an {@link STATUS}.
	 *
	 * `failed`, `cancelled`, and any unknown value become `refused`, so a future
	 * application state can never be mistaken for success.
	 *
	 * @param {string} kind
	 * @param {object} change
	 * @param {string} serverName
	 * @returns {object} an ApplyResult.
	 */
	function mapChangeResult(kind, change, serverName) {
		const application = change?.application
		const diagnostic = text(change?.error?.diagnostic) || text(change?.error?.code)
		const suffix = diagnostic === '' ? '' : ` (${diagnostic})`
		switch (application) {
			case 'applied':
				return result(kind, STATUS.APPLIED, `"${serverName}" was updated and is live now.`, serverName)
			case 'restart-required':
				return result(kind, STATUS.RESTART_REQUIRED, `"${serverName}" was saved; a host restart is required before it takes effect.`, serverName)
			case 'overridden':
				return result(kind, STATUS.REFUSED, `"${serverName}" is overridden by a higher-priority layer, so the change has no effect.`, serverName)
			case 'failed':
				return result(kind, STATUS.REFUSED, `"${serverName}" could not be changed: ${diagnostic === '' ? 'the plugin manager reported a failure' : diagnostic}.`, serverName)
			case 'cancelled':
				return result(kind, STATUS.REFUSED, `the change to "${serverName}" was cancelled; nothing was saved.`, serverName)
			default:
				return result(kind, STATUS.REFUSED, `"${serverName}": the plugin manager returned an unrecognised outcome (${String(application)}).`, serverName)
		}
	}

	/**
	 * Declare a new server, or rewrite one already declared.
	 *
	 * The duplicate rule is strict and ordered: the name is validated, then
	 * checked against BOTH the declarations and the live loader rows, and only
	 * then is anything written. A refused op therefore leaves no trace.
	 *
	 * @param {object} op - an `mcp.add` operation.
	 * @returns {Promise<object>} an ApplyResult.
	 */
	async function add(op) {
		const serverName = text(op?.serverName)
		if (!SERVER_NAME_PATTERN.test(serverName)) {
			return result(
				OP.MCP_ADD,
				STATUS.REFUSED,
				`serverName "${serverName}" is invalid: it must match ${SERVER_NAME_PATTERN} (1-32 characters of A-Z, a-z, 0-9, "_" or "-").`,
				serverName
			)
		}
		const declared = readDeclaredSafe()
		if (declared.some((item) => item.serverName === serverName)) {
			return result(OP.MCP_ADD, STATUS.REFUSED, `"${serverName}" is already declared. Use configure to change it, or remove it first.`, serverName)
		}
		const loaderRows = await readLoaderRows()
		if (loaderRows.rows.some((row) => text(row.config?.serverName) === serverName)) {
			return result(OP.MCP_ADD, STATUS.REFUSED, `"${serverName}" is already mounted by an outer composition layer, so it cannot be declared here.`, serverName)
		}

		const { config, error } = normalizeConfig(op?.config, op?.current)
		if (config === null) return result(OP.MCP_ADD, STATUS.REFUSED, `"${serverName}" was not added: ${error}.`, serverName)
		const { note, error: noteError } = normalizeNote(op?.note)
		if (noteError !== null) return result(OP.MCP_ADD, STATUS.REFUSED, `"${serverName}" was not added: ${noteError}.`, serverName)

		// The same pre-flight the import path performs: do not persist a server
		// whose command cannot be spawned at all.
		const enabled = op?.enabled === undefined ? true : Boolean(op.enabled)
		if (enabled && config.transport === 'stdio') {
			const resolved = resolveExecutable(config.command)
			if (resolved.error !== null) {
				return result(OP.MCP_ADD, STATUS.REFUSED, `"${serverName}" was not added: ${resolved.error}.`, serverName)
			}
		}

		// Credential templates are expanded by the MCP client at mount time; an
		// unresolved reference would leave a saved row that can never connect.
		if (enabled) {
			const credentialError = await credentialProblem(config)
			if (credentialError !== null) {
				return result(OP.MCP_ADD, STATUS.REFUSED, '"' + serverName + '" was not added: ' + credentialError + '.', serverName)
			}
		}

		const record = {
			serverName,
			config,
			enabled,
			note
		}
		try {
			await persist([...declared, record])
		} catch (writeError) {
			return result(OP.MCP_ADD, STATUS.REFUSED, `"${serverName}" was not saved: ${String(writeError?.message ?? writeError)}`, serverName)
		}

		if (!record.enabled) {
			return result(OP.MCP_ADD, STATUS.APPLIED, `"${serverName}" was declared and is disabled.`, serverName)
		}
		const mounted = await mount(serverName, config)
		if (!mounted.ok) {
			return result(
				OP.MCP_ADD,
				STATUS.RESTART_REQUIRED,
				`"${serverName}" was declared but cannot be mounted live (${mounted.error}); it takes effect after a restart.`,
				serverName
			)
		}
		const count = await awaitTools(serverName)
		return result(
			OP.MCP_ADD,
			STATUS.APPLIED,
			count > 0 ? `"${serverName}" was declared and is connected; ${count} tool(s) are registered.` : `"${serverName}" was declared and is connected; it exposes no tools.`,
			serverName
		)
	}

	/**
	 * Turn either a pasted document or an explicit reviewed list into the entries
	 * this module can actually import.
	 *
	 * Both paths converge here so the write/mount pipeline below has ONE shape to
	 * handle. The document path derives the name from the document key and has no
	 * note (a document carries neither a note nor a review step); the reviewed
	 * path carries the name and note the user confirmed, and re-validates both —
	 * the browser is never trusted to have kept them sane.
	 *
	 * @param {object} op - an `mcp.import` operation.
	 * @returns {Array<{serverName: string|null, config: object|null, enabled: boolean, note: string, error: string|null}>}
	 */
	function prepareImportEntries(op) {
		if (Array.isArray(op?.entries)) {
			return op.entries.map((entry) => {
				const serverName = text(entry?.serverName)
				if (serverName === '') {
					return {
						serverName: null,
						config: null,
						enabled: true,
						note: '',
						error: 'a name is required: give every imported server a name.'
					}
				}
				if (!SERVER_NAME_PATTERN.test(serverName)) {
					return {
						serverName,
						config: null,
						enabled: true,
						note: '',
						error: `"${serverName}" is not a valid serverName: it must match ${SERVER_NAME_PATTERN} (1-32 characters of A-Z, a-z, 0-9, "_" or "-").`
					}
				}
				const note = normalizeNote(entry?.note)
				if (note.error !== null) {
					return { serverName, config: null, enabled: true, note: '', error: `"${serverName}": ${note.error}.` }
				}
				const { config, error } = normalizeConfig(entry?.config, entry?.config)
				if (config === null) {
					return { serverName, config: null, enabled: true, note: note.note, error: `"${serverName}" is invalid: ${error}.` }
				}
				return { serverName, config, enabled: entry?.enabled !== false, note: note.note, error: null }
			})
		}

		const parsed = parseMcpServers(op?.json ?? op?.servers ?? op?.mcpServers)
		const explicitName = text(op?.name)
		const explicitNote = normalizeNote(op?.note)

		// The page's single-stage form sends a name (and optionally a note) for the
		// ONE server being pasted. A document that carries several servers cannot
		// take one name, so it is refused with the instruction rather than silently
		// importing the extras unnamed.
		if (explicitName !== '') {
			if (parsed.entries.length !== 1) {
				return [
					{
						serverName: explicitName,
						config: null,
						enabled: true,
						note: '',
						error: `this document contains ${parsed.entries.length} servers, but a name and note describe one server; import them one at a time (or omit the name).`
					}
				]
			}
			const entry = parsed.entries[0]
			const reasons = []
			if (!SERVER_NAME_PATTERN.test(explicitName)) {
				reasons.push(
					`"${explicitName}" is not a valid serverName: it must match ${SERVER_NAME_PATTERN} (1-32 characters of A-Z, a-z, 0-9, "_" or "-").`
				)
			}
			if (explicitNote.error !== null) reasons.push(`${explicitNote.error}.`)
			if (entry.configError !== null) reasons.push(entry.configError)
			return [
				{
					serverName: explicitName,
					config: entry.config,
					enabled: entry.enabled,
					note: explicitNote.note,
					error: reasons.length === 0 ? null : reasons.join(' ')
				}
			]
		}

		return parsed.entries.map((entry) => {
			const reasons = []
			if (entry.serverName === null) reasons.push('this entry has no name; give it one when you import it')
			if (entry.nameError !== null) reasons.push(entry.nameError)
			if (entry.configError !== null) reasons.push(entry.configError)
			return {
				serverName: entry.serverName,
				config: entry.config,
				enabled: entry.enabled,
				note: '',
				error: reasons.length === 0 ? null : `${reasons.join(' ')}`
			}
		})
	}

	/**
	 * Read a pasted document WITHOUT importing it.
	 *
	 * Kept for API users and diagnostics: it answers per entry and writes
	 * nothing. The page no longer calls it — its single-stage form names exactly
	 * one server — but a script may want to inspect a document before importing.
	 *
	 * @param {object} op - an `mcp.preview` operation carrying the same document fields.
	 * @returns {object[]} one ApplyResult per entry, each carrying a `preview` payload.
	 */
	function previewDocument(op) {
		const parsed = parseMcpServers(op?.json ?? op?.servers ?? op?.mcpServers)
		return parsed.entries.map((entry) => {
			const detail =
				entry.config === null
					? entry.configError ?? 'this entry cannot be imported as written'
					: `would import ${describeTarget(entry.config)}`
			const outcome = result(OP.MCP_PREVIEW, STATUS.UNCHANGED, detail, entry.serverName ?? undefined)
			outcome.preview = {
				serverName: entry.serverName,
				note: '',
				config: entry.config,
				enabled: entry.enabled,
				nameError: entry.nameError,
				configError: entry.configError
			}
			return outcome
		})
	}

	/**
	 * Declare every server of a pasted JSON document in one write.
	 *
	 * ONE PERSIST FOR THE WHOLE DOCUMENT, then mount per server. A per-server
	 * write that fails halfway leaves the settings document holding half of what
	 * the user pasted, with no way to tell which half; one write means every
	 * accepted server is stored, or none is. Mounts stay per server because they
	 * genuinely are independent: one dead `npx` package must not stop the other
	 * servers from coming up.
	 *
	 * The result is an ARRAY, one entry per server in document order — the page
	 * renders one row per pasted server, and `applyBatch` flattens it. A name
	 * that already exists is reported as `unchanged` (declared here) or refused
	 * (owned by an outer layer) instead of silently overwriting a server the user
	 * did not intend to change; `mcp.configure` remains the way to update one.
	 *
	 * @param {object} op - an `mcp.import` operation carrying `json` (text),
	 *   `servers` (object), or `entries` (the reviewed list).
	 * @returns {Promise<object[]>} one ApplyResult per pasted server.
	 */
	async function importServers(op) {
		const prepared = prepareImportEntries(op)
		const results = new Array(prepared.length)

		const declared = readDeclaredSafe()
		const declaredNames = new Set(declared.map((item) => item.serverName))
		const loaderRows = await readLoaderRows()
		const outerNames = new Set(
			loaderRows.rows.map((row) => text(row.config?.serverName)).filter((name) => name !== '')
		)

		const accepted = []
		const acceptedNames = new Set()
		for (const [index, entry] of prepared.entries()) {
			if (entry.error !== null) {
				results[index] = result(OP.MCP_IMPORT, STATUS.REFUSED, entry.error, entry.serverName ?? undefined)
				continue
			}
			const serverName = entry.serverName
			// Validate what would be spawned BEFORE anything is persisted: a missing
			// command is a configuration error, not a transient failure, and saving
			// it would leave a row that can never produce tools.
			if (entry.enabled && entry.config.transport === 'stdio') {
				const resolved = resolveExecutable(entry.config.command)
				if (resolved.error !== null) {
					results[index] = result(
						OP.MCP_IMPORT,
						STATUS.REFUSED,
						'"' + serverName + '" was not added: ' + resolved.error + '.',
						serverName
					)
					continue
				}
			}
			// Credential templates are expanded by the MCP client at mount time; an
			// unresolved reference would be a saved row that can never connect.
			if (entry.enabled) {
				const credentialError = await credentialProblem(entry.config)
				if (credentialError !== null) {
					results[index] = result(
						OP.MCP_IMPORT,
						STATUS.REFUSED,
						'"' + serverName + '" was not added: ' + credentialError + '.',
						serverName
					)
					continue
				}
			}
			if (outerNames.has(serverName)) {
				results[index] = result(
					OP.MCP_IMPORT,
					STATUS.REFUSED,
					'"' + serverName + '" is already mounted by an outer composition layer, so it cannot be declared here.',
					serverName
				)
				continue
			}
			if (declaredNames.has(serverName)) {
				results[index] = result(
					OP.MCP_IMPORT,
					STATUS.UNCHANGED,
					'"' + serverName + '" is already declared here and was left untouched; edit it to change it.',
					serverName
				)
				continue
			}
			// The reviewed list can contain the same name twice after an edit; the
			// declaration store is keyed by name, so importing both would leave one
			// of them silently misplaced.
			if (acceptedNames.has(serverName)) {
				results[index] = result(
					OP.MCP_IMPORT,
					STATUS.REFUSED,
					'"' + serverName + '" appears more than once in this import; give each entry a distinct name.',
					serverName
				)
				continue
			}
			acceptedNames.add(serverName)
			accepted.push({ index, entry })
		}

		if (accepted.length === 0) return results

		try {
			await persist([
				...declared,
				...accepted.map(({ entry }) => ({
					serverName: entry.serverName,
					config: entry.config,
					enabled: entry.enabled,
					note: entry.note
				}))
			])
		} catch (writeError) {
			const reason = String(writeError?.message ?? writeError)
			for (const { index, entry } of accepted) {
				results[index] = result(OP.MCP_IMPORT, STATUS.REFUSED, `"${entry.serverName}" was not added: ${reason}`, entry.serverName)
			}
			return results
		}

		for (const { index, entry } of accepted) {
			const { serverName, config, enabled } = entry
			if (!enabled) {
				results[index] = result(OP.MCP_IMPORT, STATUS.APPLIED, `"${serverName}" was added and is disabled.`, serverName)
				continue
			}
			const mounted = await mount(serverName, config)
			if (!mounted.ok) {
				results[index] = result(
					OP.MCP_IMPORT,
					STATUS.RESTART_REQUIRED,
					`"${serverName}" was added but cannot be mounted live (${mounted.error}); it takes effect after a restart.`,
					serverName
				)
				continue
			}
			const count = await awaitTools(serverName)
			results[index] = result(
				OP.MCP_IMPORT,
				STATUS.APPLIED,
				count > 0
					? `"${serverName}" was added and is connected; ${count} tool(s) are registered.`
					: `"${serverName}" was added and is connected; it exposes no tools.`,
				serverName
			)
		}
		return results
	}

	/**
	 * Rewrite one server's transport configuration.
	 *
	 * A declared server is re-mounted so the new connection replaces the old
	 * one; an outer row has no in-place configuration channel from here and is
	 * refused rather than silently declared twice under the same name.
	 *
	 * @param {object} op - an `mcp.configure` operation.
	 * @returns {Promise<object>} an ApplyResult.
	 */
	async function configure(op) {
		const serverName = text(op?.serverName ?? op?.target)
		if (serverName === '') return result(OP.MCP_CONFIGURE, STATUS.REFUSED, 'serverName is required.', serverName)

		const declared = readDeclaredSafe()
		const index = declared.findIndex((item) => item.serverName === serverName)
		if (index === -1) {
			const loaderRows = await readLoaderRows()
			const row = loaderRows.rows.find((item) => text(item.config?.serverName) === serverName)
			if (row !== undefined) {
				return result(
					OP.MCP_CONFIGURE,
					STATUS.REFUSED,
					`"${serverName}" belongs to an outer composition layer; edit that layer instead — this plugin cannot rewrite it.`,
					serverName
				)
			}
			return result(OP.MCP_CONFIGURE, STATUS.REFUSED, `no MCP server named "${serverName}" is declared.`, serverName)
		}

		const previous = declared[index]
		const { config, error } = normalizeConfig(op?.config, previous.config)
		if (config === null) return result(OP.MCP_CONFIGURE, STATUS.REFUSED, `"${serverName}" was not changed: ${error}.`, serverName)
		// An omitted note keeps the stored one, so a form that does not carry the
		// field can never wipe it; an explicit `''` clears it.
		const { note, error: noteError } = normalizeNote(op?.note === undefined ? previous.note : op.note)
		if (noteError !== null) return result(OP.MCP_CONFIGURE, STATUS.REFUSED, `"${serverName}" was not changed: ${noteError}.`, serverName)

		const wasMounted = mounts.has(serverName)
		const wasEnabled = previous.enabled !== false
		// Tear the old connection down FIRST: two live instances cannot share one
		// serverName (the client reserves the namespace per scope), so mounting
		// before disposing would fail on the reservation.
		if (wasMounted) await disposeMount(serverName)

		const next = declared.map((item, position) => (position === index ? { ...item, config, note } : item))
		try {
			await persist(next)
		} catch (writeError) {
			// The old connection is already gone; restore what can be restored so a
			// failed save does not leave the server silently down.
			if (wasMounted) await mount(serverName, previous.config)
			return result(OP.MCP_CONFIGURE, STATUS.REFUSED, `"${serverName}" was not changed: ${String(writeError?.message ?? writeError)}`, serverName)
		}

		if (!wasEnabled) {
			return result(OP.MCP_CONFIGURE, STATUS.APPLIED, `"${serverName}" was saved; it is disabled, so the new configuration applies when it is enabled.`, serverName)
		}
		const mounted = await mount(serverName, config)
		if (!mounted.ok) {
			return result(
				OP.MCP_CONFIGURE,
				STATUS.RESTART_REQUIRED,
				`"${serverName}" was saved but cannot be mounted live (${mounted.error}); it takes effect after a restart.`,
				serverName
			)
		}
		const count = await awaitTools(serverName)
		return result(
			OP.MCP_CONFIGURE,
			STATUS.APPLIED,
			count > 0 ? `"${serverName}" was reconfigured and reconnected; ${count} tool(s) are registered.` : `"${serverName}" was reconfigured and reconnected; it exposes no tools.`,
			serverName
		)
	}

	/**
	 * Remove a server this plugin declared.
	 *
	 * Only declared servers may be removed: an outer row is not this plugin's to
	 * delete, and saying so is better than deleting a row the user hand-wrote.
	 *
	 * @param {object} op - an `mcp.remove` operation.
	 * @returns {Promise<object>} an ApplyResult.
	 */
	async function remove(op) {
		const serverName = text(op?.serverName ?? op?.target)
		if (serverName === '') return result(OP.MCP_REMOVE, STATUS.REFUSED, 'serverName is required.', serverName)

		const declared = readDeclaredSafe()
		if (!declared.some((item) => item.serverName === serverName)) {
			const loaderRows = await readLoaderRows()
			if (loaderRows.rows.some((row) => text(row.config?.serverName) === serverName)) {
				return result(
					OP.MCP_REMOVE,
					STATUS.REFUSED,
					`"${serverName}" belongs to an outer composition layer and cannot be removed from here.`,
					serverName
				)
			}
			return result(OP.MCP_REMOVE, STATUS.REFUSED, `no MCP server named "${serverName}" is declared.`, serverName)
		}

		// Dispose first, then persist: a mount left running for a removed
		// declaration would keep its tools registered with nothing owning it.
		const { removed, error } = await disposeMount(serverName)
		try {
			await persist(declared.filter((item) => item.serverName !== serverName))
		} catch (writeError) {
			return result(OP.MCP_REMOVE, STATUS.REFUSED, `"${serverName}" was not removed: ${String(writeError?.message ?? writeError)}`, serverName)
		}
		if (error !== null) {
			return result(OP.MCP_REMOVE, STATUS.REFUSED, `"${serverName}" was removed from the configuration but its connection did not close cleanly: ${error}`, serverName)
		}
		return result(
			OP.MCP_REMOVE,
			STATUS.APPLIED,
			removed ? `"${serverName}" was removed and its connection closed; its tools are gone.` : `"${serverName}" was removed.`,
			serverName
		)
	}

	/**
	 * Apply one MCP operation.
	 *
	 * The single public entry point, so every kind shares one refusal convention:
	 * an unknown or malformed operation is refused with a reason, never thrown.
	 *
	 * Two kinds answer with an ARRAY, one element per entry in the document and in
	 * document order: `mcp.preview` (what WOULD be imported, nothing written) and
	 * `mcp.import` (what WAS imported, one result each). Every other kind answers
	 * with a single ApplyResult.
	 *
	 * @param {object} op - an operation carrying a `kind` from {@link OP}.
	 * @returns {Promise<object|object[]>} an ApplyResult, or one per imported server.
	 */
	async function apply(op) {
		const kind = op?.kind
		try {
			switch (kind) {
				case OP.MCP_TOGGLE:
					return await toggle(op)
				case OP.MCP_ADD:
					return await add(op)
				case OP.MCP_IMPORT:
					return await importServers(op)
				case OP.MCP_PREVIEW:
					return previewDocument(op)
				case OP.MCP_CONFIGURE:
					return await configure(op)
				case OP.MCP_REMOVE:
					return await remove(op)
				default:
					return result(String(kind ?? 'unknown'), STATUS.REFUSED, `"${String(kind)}" is not an MCP operation.`)
			}
		} catch (error) {
			// A manager must never let one bad operation take down a whole batch.
			return result(String(kind ?? 'unknown'), STATUS.REFUSED, `the operation failed: ${String(error?.message ?? error)}`)
		}
	}

	/**
	 * Apply operations in order, one result each.
	 *
	 * Operations are sequential on purpose: two operations on one server would
	 * otherwise race on the serverName reservation and on the declarations file.
	 *
	 * @param {object[]} ops
	 * @returns {Promise<object[]>} one ApplyResult per operation; an import
	 *   contributes one per server it was asked to declare.
	 */
	async function applyBatch(ops) {
		const list = Array.isArray(ops) ? ops : []
		const results = []
		for (const op of list) {
			const outcome = await apply(op)
			if (Array.isArray(outcome)) results.push(...outcome)
			else results.push(outcome)
		}
		return results
	}

	/**
	 * Re-read the live inventory and refresh the cached module probe.
	 *
	 * This is synchronous by contract (the settings card calls it while
	 * rendering), so it drops the cached inventory and capability flags rather
	 * than awaiting a Loader import; the next `describe()` re-probes.
	 *
	 * @returns {void}
	 */
	function refresh() {
		lastInventory = null
		if (clientModule === false) clientModule = undefined
	}

	/**
	 * Release every mount this manager created.
	 *
	 * Disposal is awaited so a caller tearing down the host can be sure the child
	 * processes are gone; `disposed` also stops the tool-wait loop from spinning
	 * during shutdown.
	 *
	 * @returns {Promise<void>}
	 */
	async function dispose() {
		disposed = true
		const names = [...mounts.keys()]
		for (const serverName of names) await disposeMount(serverName)
		mounts.clear()
	}

	/**
	 * Mount every declared, enabled server that is not mounted yet.
	 *
	 * WHY THIS MUST EXIST: nothing else in the tree replays a declaration. A
	 * declaration is a settings document entry, not a Loader row, so the host
	 * has no reason to instantiate it at startup — without this the servers a
	 * user added last session stay dead after every restart while the panel
	 * still lists them as enabled. That is the difference between "persisted"
	 * (F6.6) and "persisted, so it comes back".
	 *
	 * Failure is per-server and never throws: one dead command must not stop the
	 * others from mounting, and a dead one stays declared so the next start or
	 * an explicit toggle can retry it. Results are returned for diagnostics.
	 *
	 * @returns {Promise<Array<{serverName: string, mounted: boolean, error: string|null}>>}
	 */
	async function restoreDeclared() {
		const outcomes = []
		if (disposed) return outcomes
		for (const declaration of readDeclaredSafe()) {
			if (disposed) break
			const serverName = text(declaration.serverName)
			if (serverName === '') continue
			if (declaration.enabled === false) continue
			if (mounts.has(serverName)) continue
			// A serverName already taken by an outer row cannot also be mounted
			// here: the client reserves the namespace per scope, so the attempt
			// would only fail loudly. Report it instead.
			const taken = toolsFor(serverName).tools.length > 0
			if (taken) {
				outcomes.push({ serverName, mounted: false, error: 'a server with this name is already registered' })
				continue
			}
			const { config, error } = normalizeConfig(declaration.config, declaration.config)
			if (config === null) {
				outcomes.push({ serverName, mounted: false, error })
				continue
			}
			const mounted = await mount(serverName, config)
			outcomes.push({ serverName, mounted: mounted.ok, error: mounted.error })
		}
		return outcomes
	}

	// `normalizeConfig` is returned as well so a host module can pre-validate a
	// form submission without duplicating the schema rules.
	return { describe, apply, applyBatch, refresh, dispose, restoreDeclared, normalizeConfig }
}

export default createMcpManager
