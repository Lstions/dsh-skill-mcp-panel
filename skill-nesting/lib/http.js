/**
 * dsh-skill-nesting — the host's own HTTP data channel.
 *
 * WHY THIS EXISTS AT ALL
 * The harness hands a browser on a non-loopback address (e.g.
 * `http://100.64.0.10:3080`) a memory-only settings scope, so every card built
 * on `settingsScope` shows nothing there. This plugin therefore owns its own
 * two endpoints, which work identically on loopback and on a LAN address.
 *
 * WHY NOT UNDER `/api`
 * `/api` is the gateway's RPC surface. Claiming a path there would collide with
 * it and blur two different trust boundaries, so the plugin claims
 * {@link HTTP_PREFIX} instead.
 *
 * SECURITY MODEL (stated plainly, and in the README)
 * There is no authentication. Reads are safe by construction: secret-bearing
 * MCP configuration is masked with the contract's own `maskDict` before it
 * leaves the process, so a token never reaches the browser. Writes require a
 * same-origin request with a JSON content type (`isSameOriginWrite`), which
 * stops cross-site form posts; `writeAccess: 'loopback'` tightens that further
 * to loopback sockets only. The intended deployment is a trusted LAN — this is
 * not an internet-facing control plane.
 *
 * @module dsh-skill-nesting/http
 */

import { HTTP_PREFIX, ROUTE_APPLY, ROUTE_STATE, STATUS, STATE_VERSION, isSameOriginWrite, WRITE_ACCESS } from './contract.js'
import { allowsWrite } from './state.js'

/** Largest accepted request body; a settings batch is tiny. */
const MAX_BODY_BYTES = 256 * 1024

/** Write `body` as JSON with the status code. Ends the response either way. */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

/** Read and parse a JSON request body, refusing oversized or malformed input. */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return { error: `request body exceeds ${MAX_BODY_BYTES} bytes` }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return { value: {} }
  try {
    return { value: JSON.parse(text) }
  } catch (error) {
    return { error: `request body is not valid JSON: ${String(error)}` }
  }
}

/**
 * A refused ApplyResult for one operation, carrying the contract's status.
 *
 * @param {string} kind - the requested {@link OP}.
 * @param {string} detail - why it was refused, shown verbatim in the UI.
 * @param {string} [target] - the name or row id addressed.
 * @returns {object} an {@link import('./contract.js').ApplyResult}.
 */
export function refusal(kind, detail, target) {
  return { kind: kind ?? 'unknown', ok: false, status: STATUS.REFUSED, detail, ...(target === undefined ? {} : { target }) }
}

/**
 * Register the two routes on the harness web server.
 *
 * The server is an OPTIONAL dependency: a host without `webServer` (a headless
 * or Electron composition) keeps every other feature and simply has no browser
 * channel, logging that fact once instead of failing.
 *
 * @param {object} deps
 * @param {object} deps.ctx - Cordis context.
 * @param {() => Promise<object>} deps.buildState - build the state document.
 * @param {(ops: object[], meta: object) => Promise<object[]>} deps.applyOps - apply a batch.
 * @param {() => string} deps.readWriteAccess - effective {@link WRITE_ACCESS}.
 * @param {() => boolean} deps.isWritable - whether this host may write at all.
 * @param {(message: string) => void} [deps.log]
 * @returns {{mounted: () => boolean, paths: string[]}}
 */
export function createHttpRoutes(deps) {
  const { ctx, buildState, applyOps, readWriteAccess, isWritable } = deps
  const sink = typeof deps.log === 'function' ? deps.log : () => {}
  let mounted = false

  /** The `GET` endpoint: the whole state document, secrets masked. */
  async function handleState(req, res) {
    try {
      const state = await buildState()
      sendJson(res, 200, state)
    } catch (error) {
      sink(`skill-nesting: building state failed: ${String(error)}`)
      sendJson(res, 500, {
        version: STATE_VERSION,
        revision: 0,
        writable: false,
        writeAccess: readWriteAccess(),
        roots: [],
        skills: [],
        conflicts: [],
        errors: [`the host could not build the state document: ${String(error)}`],
        mcp: { servers: [], managerAvailable: false, mcpClientAvailable: false },
        config: {},
      })
    }
  }

  /** The `POST` endpoint: a same-origin, JSON-typed batch of operations. */
  async function handleApply(req, res) {
    const headers = req.headers ?? {}
    if (!isSameOriginWrite(headers)) {
      sendJson(res, 403, {
        results: [refusal('unknown', 'Refused: a write must be same-origin and carry Content-Type: application/json.')],
        state: await safeState(),
      })
      return
    }
    if (!allowsWrite(readWriteAccess(), req)) {
      sendJson(res, 403, {
        results: [refusal('unknown', `Refused: writeAccess is "${WRITE_ACCESS.LOOPBACK}" and this request did not arrive on a loopback socket.`)],
        state: await safeState(),
      })
      return
    }
    if (isWritable() !== true) {
      sendJson(res, 403, {
        results: [refusal('unknown', 'Refused: this host is read-only because its settings provider cannot persist writes.')],
        state: await safeState(),
      })
      return
    }

    const parsed = await readJsonBody(req)
    if (parsed.error !== undefined) {
      sendJson(res, 400, { results: [refusal('unknown', `Refused: ${parsed.error}.`)], state: await safeState() })
      return
    }

    const body = parsed.value ?? {}
    const ops = Array.isArray(body.ops) ? body.ops : undefined
    if (ops === undefined) {
      sendJson(res, 400, { results: [refusal('unknown', 'Refused: "ops" must be an array of operations.')], state: await safeState() })
      return
    }
    if (ops.length > 5000) {
      sendJson(res, 400, { results: [refusal('unknown', 'Refused: a batch may carry at most 5000 operations.')], state: await safeState() })
      return
    }

    try {
      const current = await buildState()
      // Revision fence, only when the client sent one: a stale write must not
      // silently clobber a change made in another tab.
      if (typeof body.revision === 'number' && body.revision !== current.revision) {
        sendJson(res, 409, {
          results: [refusal('unknown', `Refused: the state moved from revision ${body.revision} to ${current.revision}; re-read it and retry.`)],
          state: current,
        })
        return
      }
      const results = await applyOps(ops, { revision: current.revision })
      sendJson(res, 200, { results, state: await buildState() })
    } catch (error) {
      sink(`skill-nesting: applying a batch failed: ${String(error)}`)
      sendJson(res, 500, {
        results: [refusal('unknown', `The batch failed: ${String(error)}`)],
        state: await safeState(),
      })
    }
  }

  /** Best-effort state for an error body; never throws over an error path. */
  async function safeState() {
    try {
      return await buildState()
    } catch {
      return {
        version: STATE_VERSION,
        revision: 0,
        writable: false,
        writeAccess: readWriteAccess(),
        roots: [],
        skills: [],
        conflicts: [],
        errors: ['the host could not build the state document'],
        mcp: { servers: [], managerAvailable: false, mcpClientAvailable: false },
        config: {},
      }
    }
  }

  /** Claim both routes once the web server service exists. */
  function mount(webServer) {
    if (mounted) return
    mounted = true
    const disposers = []
    try {
      disposers.push(webServer.register({ kind: 'exact', path: ROUTE_STATE, handler: handleState }))
      disposers.push(webServer.register({ kind: 'exact', path: ROUTE_APPLY, handler: handleApply }))
    } catch (error) {
      // A duplicate route is a composition error, not a crash: report it and
      // keep every other feature working.
      sink(`skill-nesting: could not register the HTTP routes: ${String(error)}`)
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {}
      }
      return
    }
    ctx.effect(() => () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {}
      }
    }, 'skill-nesting http routes')
    sink(`skill-nesting: mounted ${ROUTE_STATE} and ${ROUTE_APPLY} (prefix ${HTTP_PREFIX}, deliberately outside /api)`)
  }

  // `webServer` is optional in this composition: decline to mount rather than
  // failing the whole plugin row.
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.webServer ?? webCtx.get?.('webServer')
    if (webServer === undefined || typeof webServer.register !== 'function') {
      sink('skill-nesting: no webServer service; the management page has no data channel on this host')
      return
    }
    mount(webServer)
  })

  return {
    mounted: () => mounted,
    paths: [ROUTE_STATE, ROUTE_APPLY],
  }
}
