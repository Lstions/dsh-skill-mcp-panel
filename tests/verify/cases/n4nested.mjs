/**
 * N4 (nested depth) — the contract's `maskDict` masks only TOP-LEVEL keys, so a
 * config shaped `{ transport, env:{ GITHUB_TOKEN } }` leaks the real secret
 * through the state endpoint. This case pins the fix, at every depth.
 *
 * WHY A SEPARATE CASE FROM `n4`
 * `n4` proves the endpoint masks a secret at the depth the MANAGER emits it
 * (a flattened `{API_TOKEN: mask}` dict). That is necessary but not sufficient:
 * it passes even when the deeper nesting inside the ORIGINAL declaration is
 * never visited, because the manager happens to flatten one level first. The
 * leak devA found lived exactly in that gap.
 *
 * So this case drives a declaration with secrets at depths 1, 2 and 3, and
 * asserts on the RAW RESPONSE TEXT — a substring search for a unique canary,
 * not a structural walk. A structural assertion would silently skip a depth it
 * forgot to visit; a text search cannot.
 *
 * The two helpers are also contrasted directly (`maskDict` vs `maskDeep`), so
 * the case documents WHY the deeper version exists rather than only that it does.
 */
import { SECRET_MASK } from '../../../skill-nesting/lib/contract.js'
import { maskDict } from '../../../skill-nesting/lib/contract.js'
import { loadHttp, loadState, loadMcp } from '../lib/plugin-under-test.mjs'
import { makeRequest, createWebServerHarness } from '../lib/http-harness.mjs'

const CANARY = `CANARY-NESTED-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

export const meta = { id: 'n4nested', requirement: 'N4 + F8.3', title: 'a secret nested inside an MCP config never reaches the response body' }

export async function run(report) {
  const http = await loadHttp(report)
  const stateModule = await loadState(report)
  const mcp = await loadMcp(report)

  // ---- 1. the helper contrast, stated as a fact about the contract --------
  const nestedShape = {
    transport: 'stdio',
    command: 'node',
    env: { GITHUB_TOKEN: CANARY, DEEP: { INNER_TOKEN: CANARY } },
    headers: { authorization: `Bearer ${CANARY}` },
  }
  const shallow = JSON.stringify(maskDict(nestedShape))
  report.observe('contract maskDict on a nested config', shallow.includes(CANARY) ? 'LEAKS (top-level only)' : 'safe')
  report.assert(
    'N4: the contract helper alone does NOT mask nested secrets (this is why a deep mask is required)',
    shallow.includes(CANARY),
    'if this ever stops leaking, the deep mask may be redundant — re-check before removing it',
  )
  if (typeof stateModule.maskDeep === 'function') {
    const deep = JSON.stringify(stateModule.maskDeep(nestedShape))
    report.observe('state.js maskDeep on the same config', deep.includes(CANARY) ? 'LEAKS' : 'safe')
    report.observe('maskDeep output', deep)
    report.assert(
      'N4: state.js maskDeep masks the same config at every depth',
      !deep.includes(CANARY),
      deep,
    )
    report.assert(
      'N4: maskDeep keeps the non-secret fields readable (masking must not blank the config)',
      deep.includes('"command":"node"') && deep.includes('"transport":"stdio"'),
      deep,
    )
  } else {
    report.observe('state.js maskDeep', 'not exported — checking the endpoint only')
  }

  // ---- 2. the REAL end-to-end path, asserted on raw response text ---------
  const server = createWebServerHarness()
  const declarations = [
    {
      serverName: 'nested-canary',
      transport: 'stdio',
      enabled: true,
      config: {
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        // Depth 1, depth 2, and a header dict: three distinct leak surfaces.
        env: { GITHUB_TOKEN: CANARY, DEEP: { INNER_TOKEN: CANARY } },
        headers: { authorization: `Bearer ${CANARY}`, 'x-api-key': CANARY },
      },
    },
  ]

  const manager = mcp.createMcpManager({
    ctx: server.ctx,
    readDeclared: () => declarations,
    writeDeclared: () => {},
    readConfig: () => ({}),
    log: () => {},
  })
  const inventory = await manager.describe()
  report.observe('manager inventory config', inventory.servers.map((s) => ({ name: s.serverName, config: s.config })))
  // Recorded, not asserted: the manager's own output is an internal surface.
  // What the browser receives is the STATE document, asserted below.
  report.observe(
    'does the MANAGER output leak? (internal surface, not the wire)',
    JSON.stringify(inventory).includes(CANARY) ? 'yes — masked later by state.js' : 'no',
  )

  const builder = stateModule.createStateBuilder({
    ctx: server.ctx,
    provider: { name: 'nested-filesystem', lastReport: { roots: [], errors: [] } },
    readConfig: () => ({ roots: [], maxDepth: 4, rank: 300, duplicatePolicy: 'first-wins' }),
    readDisabled: () => new Set(),
    readMcp: () => inventory,
    readWriteAccess: () => 'same-origin',
    isWritable: () => true,
    log: () => {},
  })
  await http.createHttpRoutes({
    ctx: server.ctx,
    buildState: () => builder.build(),
    applyOps: async () => [],
    readWriteAccess: () => 'same-origin',
    isWritable: () => true,
  })

  const handler = server.handlers['/skill-nesting/state']
  report.assert('the state route registered', typeof handler === 'function', JSON.stringify(Object.keys(server.handlers)))
  if (typeof handler !== 'function') report.blocked('N4: no state route, so the wire cannot be inspected')

  const { req, res } = makeRequest({ method: 'GET', host: '127.0.0.1:3080' })
  await handler(req, res)
  const raw = res.capturedBody ?? ''
  report.observe('GET status', res.statusCode)
  report.observe('GET body length', raw.length)
  report.assert('N4: GET answers 200', res.statusCode === 200, `status=${res.statusCode}`)

  // THE central assertion: a substring search over the raw text. Any depth the
  // masking forgot shows up here, regardless of which key path it sits on.
  report.assert(
    'N4: the RAW response text contains the canary at NO nesting depth',
    !raw.includes(CANARY),
    raw.includes(CANARY)
      ? `leaked; context=${JSON.stringify(raw.slice(Math.max(0, raw.indexOf(CANARY) - 200), raw.indexOf(CANARY) + 40))}`
      : 'canary absent at every depth',
  )
  report.assert(
    'N4: the config is still present and masked (not dropped to pass the leak check)',
    raw.includes(SECRET_MASK),
    `SECRET_MASK ${JSON.stringify(SECRET_MASK)} absent — a dropped field would also pass the leak check`,
  )
  report.assert(
    'F8.3: non-secret fields survive so the UI can still show the real target',
    raw.includes('server.js') || raw.includes('node'),
    'the command/args must remain readable or the config panel is useless',
  )

  // ---- 3. masked write-back must still preserve the nested secret ---------
  //
  // A deep mask is only half the contract: if the browser echoes the mask back,
  // the write path must restore the REAL value rather than storing the mask.
  const before = declarations[0].config.env.GITHUB_TOKEN
  report.assert('precondition: the stored nested secret is the canary', before === CANARY, JSON.stringify(before))
  const roundTrip = mcp.normalizeConfig
    ? mcp.normalizeConfig({ transport: 'stdio', command: 'node', env: { GITHUB_TOKEN: SECRET_MASK } }, declarations[0].config)
    : undefined
  report.observe('normalizeConfig mask round-trip', roundTrip?.config ?? roundTrip)
  if (roundTrip?.config !== undefined && roundTrip.config !== null) {
    report.assert(
      'N4: a mask echoed back is restored to the real nested secret (not stored as the mask)',
      roundTrip.config.env?.GITHUB_TOKEN === CANARY,
      JSON.stringify(roundTrip.config.env) + ` — storing ${JSON.stringify(SECRET_MASK)} would destroy the credential`,
    )
  }
}
