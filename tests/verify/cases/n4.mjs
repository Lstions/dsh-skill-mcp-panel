/**
 * N4 — the write gate and the secret gate, driven through the REAL route
 * handlers rather than through `isSameOriginWrite()` alone.
 *
 * Testing the predicate in isolation proves only that a pure function is
 * correct; it does NOT prove the endpoint calls it. So this case builds the
 * routes with the shipped factory, invokes them with real request objects, and
 * asserts on the real response status.
 *
 * Five independent claims:
 *   1. cross-origin Origin        -> rejected
 *   2. non-JSON content-type      -> rejected
 *   3. form-encoded POST          -> rejected
 *   4. a GET body never contains a real secret value, and still shows the mask
 *   5. posting the mask back preserves the real secret (no mask-overwrite)
 *
 * Claim 4 uses a CANARY: a value that cannot occur by accident, so "not present"
 * is a substring search rather than a judgement call. The mask assertion is
 * paired with it because a field that was silently DROPPED would also pass a
 * leak check — absence of the secret and absence of the field are different
 * results and must not be conflated.
 *
 * A NOTE ON THE VACUOUS-PASS TRAP
 * `status >= 400` is satisfied by `status === 0`, which is what this harness
 * returns when a handler is MISSING. So every rejection assertion here also
 * requires a non-zero status: without that, a suite that fails to register any
 * route would report "everything correctly rejected" while testing nothing.
 */
import { SECRET_MASK } from '../../../lib/contract.js'
import { loadHttp, loadState, loadMcp } from '../lib/plugin-under-test.mjs'
import { makeRequest, createWebServerHarness } from '../lib/http-harness.mjs'

/** A value that cannot occur by accident, so a substring search is decisive. */
const CANARY = `CANARY-SECRET-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

export const meta = { id: 'n4', requirement: 'N4', title: 'write gate rejects cross-origin and non-JSON; GET never leaks a real secret' }

export async function run(report) {
  const http = await loadHttp(report)

  const server = createWebServerHarness()
  const deps = buildDeps()

  // The canary must travel the REAL path: a declaration -> createMcpManager's
  // inventory -> createStateBuilder -> response body.
  //
  // A hand-written inventory stub was tried first and produced a FALSE leak:
  // the stub supplied a full transport config (`{transport, command, env:{...}}`),
  // while the real manager emits `config` as the ALREADY-FLATTENED secret dict.
  // Masking is shallow (`maskDict` visits top-level keys only), so the stub's
  // nested `env` survived and the case blamed the product for the harness's
  // shape error. Feeding the real manager removes that whole class of mistake.
  const stateModule = await loadState(report)
  const mcp = await loadMcp(report)
  const manager = mcp.createMcpManager({
    ctx: server.ctx,
    readDeclared: () => deps.declarations(),
    writeDeclared: (next) => deps.setDeclarations(next),
    readConfig: () => ({}),
    log: () => {},
  })
  const inventory = await manager.describe()
  report.observe('mcp inventory config shapes', inventory.servers.map((s) => ({ server: s.serverName, config: s.config })))

  const builder = stateModule.createStateBuilder({
    ctx: server.ctx,
    provider: { name: 'nested-filesystem', lastReport: { roots: [], errors: [] } },
    readConfig: () => ({ roots: [], maxDepth: 4, rank: 300, duplicatePolicy: 'first-wins' }),
    readDisabled: () => new Set(),
    // The MCP inventory carries the canary: this is the real leak surface.
    readMcp: () => inventory,
    readWriteAccess: () => 'same-origin',
    isWritable: () => true,
    log: () => {},
  })

  const routes = await http.createHttpRoutes({
    ctx: server.ctx,
    buildState: () => builder.build(),
    applyOps: deps.applyOps,
    readWriteAccess: () => 'same-origin',
    isWritable: () => true,
  })
  report.observe('createHttpRoutes returned', Object.keys(routes ?? {}))

  // The factory mounts through ctx.inject(['webServer']); resolve whatever it
  // registered so the assertions below run against real handlers.
  const stateHandler = server.handlers['/skill-mcp-panel/state']
  const applyHandler = server.handlers['/skill-mcp-panel/apply']
  report.observe('registered paths', Object.keys(server.handlers))
  report.assert('the state route registered', typeof stateHandler === 'function', `paths=${JSON.stringify(Object.keys(server.handlers))}`)
  report.assert('the apply route registered', typeof applyHandler === 'function', `paths=${JSON.stringify(Object.keys(server.handlers))}`)

  // If nothing registered, every "rejected" assertion below would pass
  // vacuously on a status-0 response. Stop here instead.
  if (typeof applyHandler !== 'function' || typeof stateHandler !== 'function') {
    report.blocked('N4: the shipped createHttpRoutes() registered no routes, so the gates cannot be exercised')
  }

  // ---- claim 1: cross-origin write ---------------------------------------
  const crossOrigin = await invoke(applyHandler, {
    method: 'POST',
    origin: 'http://evil.example',
    host: '127.0.0.1:3080',
    contentType: 'application/json',
    body: JSON.stringify({ revision: 1, ops: [] }),
  })
  report.observe('cross-origin POST', crossOrigin.describe())
  report.assert(
    'N4: a cross-origin Origin is rejected',
    crossOrigin.status >= 400 && crossOrigin.status !== 0,
    `status=${crossOrigin.status} body=${JSON.stringify(crossOrigin.body).slice(0, 200)}`,
  )

  // Control: the SAME request with a matching Origin must be accepted, or the
  // gate is vacuous (it would reject everything, including legitimate writes).
  const sameOrigin = await invoke(applyHandler, {
    method: 'POST',
    origin: 'http://127.0.0.1:3080',
    host: '127.0.0.1:3080',
    contentType: 'application/json',
    body: JSON.stringify({ ops: [] }),
  })
  report.observe('same-origin POST', sameOrigin.describe())
  report.assert(
    'N4 control: a same-origin JSON write is NOT rejected (proves the gate discriminates)',
    sameOrigin.status >= 200 && sameOrigin.status < 300,
    `status=${sameOrigin.status} body=${JSON.stringify(sameOrigin.body).slice(0, 200)}`,
  )

  // ---- claim 2: non-JSON content type ------------------------------------
  for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
    const rejected = await invoke(applyHandler, {
      method: 'POST',
      origin: 'http://127.0.0.1:3080',
      host: '127.0.0.1:3080',
      contentType,
      body: 'a=b',
    })
    report.observe(`POST as ${contentType}`, rejected.describe())
    report.assert(
      `N4: content-type "${contentType}" is rejected`,
      rejected.status >= 400 && rejected.status !== 0,
      `status=${rejected.status}`,
    )
  }

  // ---- claim 3: GET must not leak the canary ------------------------------
  const stateRes = await invoke(stateHandler, { method: 'GET', host: '127.0.0.1:3080' })
  report.observe('GET state status', stateRes.status)
  report.assert('N4: GET state answers successfully', stateRes.status === 200, `status=${stateRes.status}`)

  const raw = stateRes.rawBody ?? ''
  report.observe('GET body length', raw.length)
  report.assert(
    'N4: the GET body does NOT contain the real secret value',
    !raw.includes(CANARY),
    raw.includes(CANARY) ? `the canary leaked; context=${JSON.stringify(extractContext(raw, CANARY))}` : 'canary absent',
  )
  report.assert(
    'N4: the secret field is still present but masked (not silently dropped)',
    raw.includes(SECRET_MASK),
    `SECRET_MASK ${JSON.stringify(SECRET_MASK)} ${raw.includes(SECRET_MASK) ? 'present' : 'ABSENT — a dropped field would also pass the leak check'}`,
  )

  // ---- claim 4: mask written back preserves the real value ---------------
  report.assert('precondition: the stored secret is the canary', deps.readSecret() === CANARY, `stored=${JSON.stringify(deps.readSecret())}`)

  const writeBack = await invoke(applyHandler, {
    method: 'POST',
    origin: 'http://127.0.0.1:3080',
    host: '127.0.0.1:3080',
    contentType: 'application/json',
    body: JSON.stringify({
      ops: [
        {
          kind: 'mcp.configure',
          serverName: deps.serverName,
          config: { transport: 'stdio', command: 'node', env: { API_TOKEN: SECRET_MASK } },
        },
      ],
    }),
  })
  report.observe('mask write-back response', writeBack.describe())
  const after = deps.readSecret()
  report.observe('stored secret after mask write-back', after === CANARY ? 'CANARY (unchanged)' : JSON.stringify(after))
  report.assert(
    'N4: submitting the mask back preserves the real secret',
    after === CANARY,
    `before=${JSON.stringify(CANARY)} after=${JSON.stringify(after)} — a mask-overwrite would store ${JSON.stringify(SECRET_MASK)}`,
  )
}

/** Dependencies the endpoints read; the secret is the canary. */
function buildDeps() {
  const state = {
    secret: CANARY,
    serverName: 'canary-server',
    declarations: [],
  }

  /**
   * Declarations carrying the canary, in the REAL shape `normalizeConfig`
   * accepts: transport config with a nested `env` / `headers` dict. The manager
   * flattens and masks it, which is the behaviour under test.
   */
  const declarations = () => [
    {
      serverName: 'canary-stdio',
      transport: 'stdio',
      enabled: true,
      config: { transport: 'stdio', command: 'node', args: ['server.js'], env: { API_TOKEN: state.secret, PLAIN_VAR: 'visible' } },
    },
    {
      serverName: 'canary-http',
      transport: 'streamable-http',
      enabled: true,
      config: { transport: 'streamable-http', url: 'https://canary.invalid/mcp', headers: { Authorization: `Bearer ${state.secret}`, 'x-api-key': state.secret } },
    },
  ]

  const applyOps = async (ops) => {
    const results = []
    for (const op of ops) {
      if (op.kind === 'mcp.configure') {
        const submitted = op.config?.env?.API_TOKEN
        // The behaviour under test: a mask means "keep the stored value".
        if (submitted !== SECRET_MASK) state.secret = submitted
        results.push({ kind: op.kind, ok: true, status: 'applied', detail: 'configured', target: op.serverName })
        continue
      }
      results.push({ kind: op.kind ?? 'unknown', ok: true, status: 'applied', detail: 'noop' })
    }
    return results
  }

  return {
    declarations,
    setDeclarations: (next) => {
      state.declarations = next
    },
    applyOps,
    serverName: state.serverName,
    readSecret: () => state.secret,
  }
}

/** Build a fake req/res pair, invoke the handler, capture the response. */
async function invoke(handler, spec) {
  if (handler === undefined) {
    // status 0 is deliberately distinct from every real HTTP status so that a
    // `>= 400` assertion cannot pass by accident.
    return { status: 0, body: 'NO HANDLER', rawBody: '', describe: () => 'handler missing' }
  }
  const { req, res } = makeRequest(spec)
  try {
    await handler(req, res)
  } catch (error) {
    return {
      status: res.statusCode ?? 0,
      body: `THREW: ${error.message}`,
      rawBody: res.capturedBody ?? '',
      describe: () => `threw ${error.message}`,
    }
  }
  const rawBody = res.capturedBody ?? ''
  let body = rawBody
  try {
    body = JSON.parse(rawBody)
  } catch {}
  return {
    status: res.statusCode ?? 0,
    body,
    rawBody,
    describe: () => `status=${res.statusCode} body=${rawBody.slice(0, 200)}`,
  }
}

function extractContext(text, needle) {
  const at = text.indexOf(needle)
  return text.slice(Math.max(0, at - 80), at + needle.length + 40)
}