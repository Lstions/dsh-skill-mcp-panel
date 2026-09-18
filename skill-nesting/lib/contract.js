/**
 * Frozen wire contract shared by the host modules, the browser half, and the
 * tests. This file is the single source of truth for names and shapes: the
 * host and client ship as separate bundles that cannot import each other, so a
 * change here is a change to both sides at once.
 *
 * Nothing in this module may import Cordis, Node, or React — it is plain data
 * and pure functions so the browser bundle, the host plugin, and the Node test
 * harness can all load it.
 *
 * The browser bundle cannot `import` this file at runtime (a client bundle is
 * one self-contained module). It inlines an equivalent `CONTRACT` literal, and
 * `test/contract-drift.mjs` asserts the two agree.
 *
 * @module contract
 */

/** Settings namespace and the plugin's identity across every surface. */
export const NS = 'skill-nesting';

/** Prefix the host claims on the Web server. Deliberately NOT under `/api`. */
export const HTTP_PREFIX = '/skill-nesting/';

/** Read the whole state document. `GET`, no body. */
export const ROUTE_STATE = '/skill-nesting/state';

/** Apply a batch of operations. `POST`, JSON body. */
export const ROUTE_APPLY = '/skill-nesting/apply';

/**
 * Version of the payload shapes below. The client refuses a document whose
 * version it does not know, instead of rendering fields it cannot interpret.
 */
export const STATE_VERSION = 1;

/** Replacement text for a masked secret. Never rendered as an editable value. */
export const SECRET_MASK = '••••••';

/**
 * Keys whose values are withheld from the browser. Matched against the whole
 * key name, so `GITHUB_TOKEN`, `authorization`, and `apiKey` all match.
 */
export const SECRET_KEY_PATTERN = /(token|secret|passwd|password|credential|authorization|cookie|api[_-]?key)/i;

/**
 * Operation kinds accepted by the apply endpoint. One batch may mix kinds.
 * @readonly
 * @enum {string}
 */
export const OP = {
	/** Enable or disable one skill by name. */
	SKILL_TOGGLE: 'skill.toggle',
	/** Enable or disable many skills in one write. */
	SKILL_BULK: 'skill.bulk',
	/** Set baseline configuration fields (roots, maxDepth, duplicatePolicy, ...). */
	CONFIG_SET: 'config.set',
	/** Remove a baseline configuration override, restoring the row default. */
	CONFIG_UNSET: 'config.unset',
	/** Enable or disable a mounted MCP server row. */
	MCP_TOGGLE: 'mcp.toggle',
	/** Rewrite one server's connection configuration. */
	MCP_CONFIGURE: 'mcp.configure',
	/** Declare a new MCP server owned by this plugin. */
	MCP_ADD: 'mcp.add',
	/** Remove a server declared by this plugin. */
	MCP_REMOVE: 'mcp.remove'
};

/**
 * Per-operation outcome. `restart-required` is a real, expected result: the
 * loader cannot always mount a new row into a live tree, and saying so is
 * correct where claiming success would be a lie.
 * @readonly
 * @enum {string}
 */
export const STATUS = {
	/** Applied and visible in the live runtime now. */
	APPLIED: 'applied',
	/** Persisted, but a host restart is needed before it takes effect. */
	RESTART_REQUIRED: 'restart-required',
	/** Rejected; `detail` explains why and nothing was written. */
	REFUSED: 'refused',
	/** Already in the requested state; nothing was written. */
	UNCHANGED: 'unchanged'
};

/**
 * Who may write. `same-origin` accepts any request that passes the
 * origin+JSON gate for the harness to work over a LAN address; `loopback`
 * additionally requires the request to arrive on a loopback socket.
 * @readonly
 * @enum {string}
 */
export const WRITE_ACCESS = {
	SAME_ORIGIN: 'same-origin',
	LOOPBACK: 'loopback'
};

/**
 * Mask one value when its key looks secret. Non-secret values pass through
 * untouched so the UI can show real commands and URLs.
 * @param key - configuration key the value belongs to.
 * @param value - the raw value.
 * @returns the value, or {@link SECRET_MASK} when the key is secret-bearing.
 */
export function maskSecret(key, value) {
	if (typeof key === 'string' && SECRET_KEY_PATTERN.test(key)) return SECRET_MASK;
	return value;
}

/**
 * Mask every secret-bearing entry of a string dictionary without dropping the
 * keys, so the UI still shows which variables a server expects.
 * @param dict - the raw dictionary, or undefined.
 * @returns a new dictionary with secret values replaced.
 */
export function maskDict(dict) {
	if (dict === undefined || dict === null || typeof dict !== 'object') return {};
	const out = {};
	for (const [key, value] of Object.entries(dict)) out[key] = maskSecret(key, value);
	return out;
}

/**
 * Replace masked values with the real ones they stand for, so saving a form the
 * user never edited cannot overwrite a live secret with the mask.
 * @param next - dictionary submitted by the browser.
 * @param current - the live dictionary holding real values.
 * @returns a dictionary safe to persist.
 */
export function unmaskDict(next, current) {
	const out = {};
	for (const [key, value] of Object.entries(next ?? {})) {
		out[key] = value === SECRET_MASK && current !== undefined && current !== null && key in current ? current[key] : value;
	}
	return out;
}

/**
 * Decide whether a request may mutate host state. Same-origin only: a browser
 * on another origin either omits `Origin` (a form or top-level navigation) or
 * sends its own host, and the JSON content type requirement adds a preflight
 * the page would have to pass.
 * @param headers - request headers, lower-cased keys as Node supplies them.
 * @returns true when the request is same-origin and JSON-typed.
 */
export function isSameOriginWrite(headers) {
	const origin = headers?.origin;
	if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
		let originHost;
		try {
			originHost = new URL(origin).host;
		} catch {
			return false;
		}
		if (originHost !== headers?.host) return false;
	}
	const type = headers?.['content-type'];
	return typeof type === 'string' && type.toLowerCase().startsWith('application/json');
}

/**
 * @typedef {object} SkillRow
 * @property {string} name - kebab-case skill name.
 * @property {string} description - catalog description.
 * @property {string} path - absolute path of the SKILL.md that won.
 * @property {string} root - configured root that produced it.
 * @property {string} category - path between root and the skill directory, `''` at the top level.
 * @property {boolean} enabled - the user's toggle.
 * @property {boolean} effective - true when the live catalog really reflects `enabled`.
 * @property {string|null} shadowedBy - when `enabled` is false but the skill is still
 *   live, who still supplies it: the winning provider name, or a reason such as
 *   `nearer-layer` / `same-layer-rank` when no single provider can be named.
 * @property {boolean} modelInvocable - advertised to the model.
 * @property {boolean} userInvocable - available to a human-facing command.
 * @property {string} provider - provider name that owns the winning candidate.
 * @property {number} rank - winning candidate rank.
 */

/**
 * @typedef {object} ConflictCandidate
 * @property {string} path
 * @property {string} root
 * @property {string} provider
 * @property {number} rank
 */

/**
 * @typedef {object} ConflictRow
 * @property {string} name - the contested skill name.
 * @property {ConflictCandidate} winner
 * @property {ConflictCandidate[]} losers
 * @property {string} policy - the `duplicatePolicy` in force.
 * @property {boolean} resolvable - true when this plugin can change the outcome.
 */

/**
 * @typedef {object} McpToolRow
 * @property {string} name - public tool name, `mcp__<server>__<tool>`.
 * @property {string} description
 */

/**
 * @typedef {object} McpServerRow
 * @property {string|null} rowId - loader entry id, null for a declared-but-unmounted server.
 * @property {string} serverName - MCP server namespace.
 * @property {'stdio'|'streamable-http'} transport
 * @property {string} target - the command line or URL, for display.
 * @property {boolean} enabled - the loader row's or declaration's enabled state.
 * @property {boolean} declared - owned by this plugin's own configuration.
 * @property {string|null} phase - live fiber phase, null when not mounted.
 * @property {number} toolCount
 * @property {McpToolRow[]} tools
 * @property {boolean} addressable - the plugin manager can toggle this row.
 * @property {string|null} readOnlyReason - why it cannot be changed.
 * @property {boolean} editable - configuration can be rewritten here.
 * @property {object} config - transport configuration with secrets masked.
 */

/**
 * @typedef {object} StatePayload
 * @property {number} version - {@link STATE_VERSION}.
 * @property {number} revision - host revision this document reflects; echoed back on apply.
 * @property {boolean} writable - false when the host must refuse writes.
 * @property {string} writeAccess - the effective {@link WRITE_ACCESS}.
 * @property {Array<{path: string, exists: boolean, skillCount: number}>} roots
 * @property {SkillRow[]} skills
 * @property {ConflictRow[]} conflicts
 * @property {string[]} errors - discovery problems worth showing a human.
 * @property {{servers: McpServerRow[], managerAvailable: boolean, mcpClientAvailable: boolean}} mcp
 * @property {object} config - resolved baseline configuration.
 */

/**
 * @typedef {object} ApplyRequest
 * @property {number} revision - the revision the client last read.
 * @property {Array<object>} ops - operations, each carrying a `kind` from {@link OP}.
 */

/**
 * @typedef {object} ApplyResult
 * @property {string} kind - the {@link OP} that was requested.
 * @property {boolean} ok
 * @property {string} status - one of {@link STATUS}.
 * @property {string} detail - human-readable outcome, shown verbatim in the UI.
 * @property {string} [target] - the name or row id the operation addressed.
 */

/**
 * @typedef {object} ApplyResponse
 * @property {ApplyResult[]} results
 * @property {StatePayload} state - the state after the batch, so the UI never
 *   needs a second round trip to know what happened.
 */
