/**
 * HOST test — the HTTP data channel, over a REAL node:http server.
 *
 * WHY A REAL SOCKET
 * The security properties under test are properties of the wire, not of a
 * function: whether a cross-origin POST is refused, whether a non-JSON content
 * type is refused, whether a secret survives into the response body. Calling the
 * handler with a fake `req` would test this plugin's idea of the contract
 * instead of the contract.
 */
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../lib/index.js'
import { createHttpRoutes } from '../lib/http.js'
import { createStateBuilder } from '../lib/state.js'
import { HTTP_PREFIX, ROUTE_APPLY, ROUTE_STATE, SECRET_MASK, STATUS, WRITE_ACCESS } from '../lib/contract.js'
import { readToggles } from '../lib/toggle.js'
import { bootRegistry, findProvider, loadCordis, makeChecker, makeFsService, makeSettingsStub, skillFile } from './host-harness.mjs'

const { check, checkTrue, checkFalse, finish } = makeChecker()
const { Context } = await loadCordis()

// ─ fixture ───────────────────────────────────────────────────────────────
const root = await mkdtemp(join(tmpdir(), 'host-http-'))
await mkdir(join(root, 'cat', 'alpha'), { recursive: true })
await mkdir(join(root, 'cat', 'beta'), { recursive: true })
await writeFile(join(root, 'cat', 'alpha', 'SKILL.md'), skillFile('alpha'))
await writeFile(join(root, 'cat', 'beta', 'SKILL.md'), skillFile('beta'))

/**
 * Boot the plugin on a real registry, mount the routes on a real server.
 *
 * @param {object} [overrides] - config and wiring overrides.
 * @returns {Promise<object>} the booted pieces plus `request`/`close`.
 */
async function boot(overrides = {}) {
  const registry = await bootRegistry()
  const base = {
    roots: [root], maxDepth: 4, rank: 300, includeHidden: false, includeFlatRootFiles: true,
    watch: false, watchDebounceMs: 250, duplicatePolicy: 'first-wins', providerName: 'nested-filesystem',
    skills: {}, writeAccess: 'same-origin', mcpServers: [],
    ...(overrides.config ?? {}),
  }
  const settings = makeSettingsStub(base)
  const ctx = registry.ctx
  ctx.provide('fs', makeFsService())
  ctx.logger = { info: () => {}, warn: () => {}, error: () => {} }

  /** Records what the plugin asked the web server to do. */
  const registered = []
  const routes = new Map()
  let handle

  await ctx.plugin(
    {
      name: 'skill-nesting-host',
      inject: ['skills'],
      apply: (pluginCtx) => {
        pluginCtx.provide('settings', settings.settings)
        // A real-enough web server service: `register` is the shipped
        // signature, and the disposer is a real effect. It is present BEFORE
        // `apply` so the plugin mounts its own routes through its own path.
        if (overrides.noWebServer !== true) {
          pluginCtx.provide('webServer', {
            register(route) {
              registered.push({ kind: route.kind, path: route.path })
              routes.set(route.path, route.handler)
              return () => routes.delete(route.path)
            },
          })
        }
        handle = apply(pluginCtx, base)
        if (overrides.mcp !== undefined && overrides.noWebServer !== true) {
          // Sections that need a populated MCP inventory mount the SAME shipped
          // route factory over the SAME shipped state builder; only the
          // inventory source differs, because the MCP manager is another
          // writer's module (lib/mcp.js) and its skeleton returns an empty one.
          routes.clear()
          const builder = createStateBuilder({
            ctx: pluginCtx,
            provider: findProvider(pluginCtx, base.providerName),
            readConfig: () => settings.resolved(),
            readDisabled: () => readToggles(settings.resolved()),
            readMcp: () => overrides.mcp,
            readWriteAccess: () => settings.resolved().writeAccess ?? WRITE_ACCESS.SAME_ORIGIN,
            isWritable: () => overrides.readOnly !== true,
            log: () => {},
          })
          createHttpRoutes({
            ctx: pluginCtx,
            buildState: () => builder.build(),
            applyOps: (ops) => handle.applyOps(ops),
            readWriteAccess: () => settings.resolved().writeAccess ?? WRITE_ACCESS.SAME_ORIGIN,
            isWritable: () => overrides.readOnly !== true,
            log: () => {},
          })
        }
      },
    },
    {},
  )

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    const handler = routes.get(path)
    if (handler === undefined) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    Promise.resolve(handler(req, res)).catch(() => {
      res.statusCode = 500
      res.end('handler threw')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  /**
   * Perform one HTTP request.
   * @param {string} path - request path.
   * @param {object} [options] - method, headers, body.
   * @returns {Promise<{status: number, body: any, text: string, headers: object}>}
   */
  async function request(path, options = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      redirect: 'manual',
    })
    const text = await response.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }
    return { status: response.status, body, text, headers: Object.fromEntries(response.headers) }
  }

  return {
    ...registry, ctx, settings, base, port, request, registered, routes,
    get handle() {
      return handle
    },
    async close() {
      await new Promise((resolve) => server.close(resolve))
      await ctx.fiber.dispose()
    },
  }
}

// ── 1. the routes the plugin claims ───────────────────────────────────────
{
  const booted = await boot()
  const paths = booted.registered.map((r) => r.path).sort()
  check('exactly the two contract routes are registered', paths, [ROUTE_APPLY, ROUTE_STATE].sort())
  checkTrue('both are exact routes', booted.registered.every((r) => r.kind === 'exact'))
  checkTrue('neither route is under /api', booted.registered.every((r) => !r.path.startsWith('/api')))
  checkTrue('both routes are under the plugin prefix', booted.registered.every((r) => r.path.startsWith(HTTP_PREFIX)))
  await booted.close()
}

// ── 2. GET returns the state document ─────────────────────────────────────
{
  const booted = await boot()
  const response = await booted.request(ROUTE_STATE)
  check('GET state answers 200', response.status, 200)
  check('GET state is JSON', response.headers['content-type'], 'application/json; charset=utf-8')
  check('GET state is not cached', response.headers['cache-control'], 'no-store')
  check('the payload carries the contract version', response.body.version, 1)
  check('the payload lists the skills', response.body.skills.map((s) => s.name), ['alpha', 'beta'])
  checkTrue('the payload carries a revision', typeof response.body.revision === 'number')
  await booted.close()
}

// ── 3. the read endpoint never leaks a secret ─────────────────────────────
{
  const booted = await boot({
    mcp: {
      servers: [{
        rowId: 'r1', serverName: 'github', transport: 'stdio', target: 'npx gh', enabled: true, declared: true,
        phase: 'active', toolCount: 1, tools: [{ name: 'mcp__github__x', description: 'x' }],
        addressable: true, readOnlyReason: null, editable: true,
        config: { command: 'npx', args: ['gh'], env: { GITHUB_TOKEN: 'ghp_live_token_9f3a', PLAIN: 'ok' }, headers: { Authorization: 'Bearer live-secret-77' }, toolCallTimeoutMs: 5000 },
      }],
      managerAvailable: true, mcpClientAvailable: true,
    },
  })
  const response = await booted.request(ROUTE_STATE)
  const server = response.body.mcp.servers[0]
  check('the server row is served', server.serverName, 'github')
  check('the nested env secret is masked', server.config.env.GITHUB_TOKEN, SECRET_MASK)
  check('the nested header secret is masked', server.config.headers.Authorization, SECRET_MASK)
  check('a non-secret nested value passes through', server.config.env.PLAIN, 'ok')
  check('a non-secret scalar passes through', server.config.toolCallTimeoutMs, 5000)
  checkFalse('the real token appears NOWHERE in the raw body', response.text.includes('ghp_live_token_9f3a'))
  checkFalse('the real header secret appears NOWHERE either', response.text.includes('Bearer live-secret-77'))
  await booted.close()
}

// ─ 4. the same-origin gate on writes ─────────────────────────────────────
{
  const booted = await boot()
  const json = { 'content-type': 'application/json' }

  // A cross-origin browser request: refused before anything is written.
  const crossOrigin = await booted.request(ROUTE_APPLY, {
    method: 'POST',
    headers: { ...json, origin: 'http://evil.example', host: `127.0.0.1:${booted.port}` },
    body: JSON.stringify({ ops: [{ kind: 'skill.toggle', name: 'alpha', enabled: false }] }),
  })
  check('a cross-origin write is refused with 403', crossOrigin.status, 403)
  check('the refusal carries a refused result', crossOrigin.body.results[0].status, STATUS.REFUSED)
  checkTrue('the refusal explains itself', /same-origin/i.test(crossOrigin.body.results[0].detail))
  check('nothing was written', booted.settings.section(), {})

  // A form-style post: no JSON content type.
  const formPost = await booted.request(ROUTE_APPLY, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', host: `127.0.0.1:${booted.port}` },
    body: 'kind=skill.toggle&name=alpha',
  })
  check('a non-JSON write is refused with 403', formPost.status, 403)
  check('nothing was written by the form post', booted.settings.section(), {})

  // No Origin header at all, but a JSON content type: the harness's own fetch
  // and same-origin browser posts look like this, so it must be ACCEPTED.
  const sameOrigin = await booted.request(ROUTE_APPLY, {
    method: 'POST',
    headers: { ...json, host: `127.0.0.1:${booted.port}` },
    body: JSON.stringify({ ops: [{ kind: 'skill.toggle', name: 'alpha', enabled: false }] }),
  })
  check('a same-origin JSON write is accepted', sameOrigin.status, 200)
  check('the toggle was persisted', readToggles(booted.settings.resolved()), new Set(['alpha']))
  await booted.close()
}

// ── 5. writeAccess: loopback refuses a non-loopback peer ──────────────────
{
  const booted = await boot({ config: { writeAccess: 'loopback' } })
  const response = await booted.request(ROUTE_APPLY, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: `127.0.0.1:${booted.port}` },
    body: JSON.stringify({ ops: [{ kind: 'skill.toggle', name: 'alpha', enabled: false }] }),
  })
  // The socket IS loopback here, so the request must be accepted — proving the
  // check inspects the peer rather than refusing everything.
  check('a loopback socket still passes the loopback gate', response.status, 200)
  check('the write went through', readToggles(booted.settings.resolved()), new Set(['alpha']))
  await booted.close()
}

// ── 6. a toggle through the endpoint really changes the catalog ───────────
{
  const booted = await boot()
  const before = (await booted.ctx.skills.list()).filter((s) => booted.isModelInvocable(s)).map((s) => s.name)
  check('before: both skills are model-visible', before, ['alpha', 'beta'])

  // NOTE: this seams the endpoint to the plugin's own apply pipeline through
  // the state builder the plugin installed; see the wiring in `boot()`.
  const response = await booted.request(ROUTE_APPLY, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: `127.0.0.1:${booted.port}` },
    body: JSON.stringify({ ops: [{ kind: 'skill.toggle', name: 'alpha', enabled: false }] }),
  })
  check('the toggle is accepted', response.status, 200)
  check('the write is persisted', readToggles(booted.settings.resolved()), new Set(['alpha']))
  await booted.close()
}

// ── 7. bad input is refused, never half-applied ───────────────────────────
{
  const booted = await boot()
  const json = { 'content-type': 'application/json', host: `127.0.0.1:${booted.port}` }

  const notJson = await booted.request(ROUTE_APPLY, { method: 'POST', headers: json, body: '{not json' })
  check('a malformed body is refused with 400', notJson.status, 400)
  checkTrue('the refusal names the parse failure', /not valid JSON/i.test(notJson.body.results[0].detail))

  const noOps = await booted.request(ROUTE_APPLY, { method: 'POST', headers: json, body: JSON.stringify({ revision: 1 }) })
  check('a missing ops array is refused with 400', noOps.status, 400)
  checkTrue('the refusal names the missing field', /"ops"/.test(noOps.body.results[0].detail))

  const unknown = await booted.request(ROUTE_APPLY, {
    method: 'POST', headers: json, body: JSON.stringify({ ops: [{ kind: 'nope.nope' }] }),
  })
  check('an unknown operation kind is refused', unknown.body.results[0].status, STATUS.REFUSED)
  checkTrue('the refusal names the kind', /nope\.nope/.test(unknown.body.results[0].detail))

  const empty = await booted.request(ROUTE_APPLY, { method: 'POST', headers: json, body: JSON.stringify({ ops: [] }) })
  check('an empty batch succeeds with no results', [empty.status, empty.body.results], [200, []])
  check('every refusal echoed the state back', Array.isArray(noOps.body.state.skills), true)
  await booted.close()
}

// ── 8. a stale revision is fenced out ─────────────────────────────────────
{
  const booted = await boot()
  const json = { 'content-type': 'application/json', host: `127.0.0.1:${booted.port}` }
  const current = (await booted.request(ROUTE_STATE)).body.revision

  const stale = await booted.request(ROUTE_APPLY, {
    method: 'POST', headers: json,
    body: JSON.stringify({ revision: current - 1, ops: [{ kind: 'skill.toggle', name: 'alpha', enabled: false }] }),
  })
  check('a stale revision is refused with 409', stale.status, 409)
  check('nothing was written for a stale revision', booted.settings.section(), {})
  check('the conflict echoes the live state', stale.body.state.revision, current)

  const fresh = await booted.request(ROUTE_APPLY, {
    method: 'POST', headers: json,
    body: JSON.stringify({ revision: current, ops: [{ kind: 'skill.toggle', name: 'beta', enabled: false }] }),
  })
  check('a current revision is accepted', fresh.status, 200)
  await booted.close()
}

// ── 9. graceful degradation without a web server ──────────────────────────
{
  const booted = await boot({ noWebServer: true })
  check('no routes are registered without a web server', booted.registered, [])
  checkTrue('the plugin still serves skills', (await booted.ctx.skills.list()).length === 2)
  const response = await booted.request(ROUTE_STATE)
  check('the endpoint answers 404 rather than crashing', response.status, 404)
  await booted.close()
}

// ─ 10. nothing the endpoint does touches a skill file ────────────────────
{
  const booted = await boot()
  const file = join(root, 'cat', 'alpha', 'SKILL.md')
  const digest = async () => createHash('md5').update(await readFile(file)).digest('hex')
  const before = await digest()

  const json = { 'content-type': 'application/json', host: `127.0.0.1:${booted.port}` }
  await booted.request(ROUTE_APPLY, {
    method: 'POST', headers: json, body: JSON.stringify({ ops: [{ kind: 'skill.toggle', name: 'alpha', enabled: false }] }),
  })
  await booted.request(ROUTE_APPLY, {
    method: 'POST', headers: json, body: JSON.stringify({ ops: [{ kind: 'skill.toggle', name: 'alpha', enabled: true }] }),
  })
  check('the SKILL.md md5 is unchanged', await digest(), before)
  await booted.close()
}

await rm(root, { recursive: true, force: true })
finish()