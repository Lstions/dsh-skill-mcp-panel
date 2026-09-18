/**
 * HOST test — the endpoint wired to the REAL plugin pipeline, end to end.
 *
 * `host-http.mjs` proves the wire contract (origin gate, masking, status codes).
 * This file proves the thing a user actually cares about: a toggle sent over
 * HTTP changes what the model sees, and the state document the UI reads back
 * agrees with the live registry.
 *
 * THE SCALE SECTION runs against this machine's real skill tree
 * (`~/.agents/skills`, a symlink to `~/.hermes/skills`) and reports the
 * denominator it measured, plus the state endpoint's P95 over a warm cache.
 */
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm, readdir, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { apply } from '../lib/index.js'
import { ROUTE_APPLY, ROUTE_STATE, STATUS } from '../lib/contract.js'
import { readToggles } from '../lib/toggle.js'
import { bootRegistry, loadCordis, makeChecker, makeFsService, makeSettingsStub, skillFile } from './host-harness.mjs'

const { check, checkTrue, checkFalse, finish } = makeChecker()
const { Context } = await loadCordis()

// ─ small fixture for the end-to-end cases ─────────────────────────────────
const root = await mkdtemp(join(tmpdir(), 'host-live-'))
await mkdir(join(root, 'cat', 'alpha'), { recursive: true })
await mkdir(join(root, 'cat', 'beta'), { recursive: true })
await writeFile(join(root, 'cat', 'alpha', 'SKILL.md'), skillFile('alpha'))
await writeFile(join(root, 'cat', 'beta', 'SKILL.md'), skillFile('beta'))

/**
 * Boot the plugin through its REAL apply pipeline and serve its REAL routes.
 *
 * @param {object} roots - configured roots.
 * @returns {Promise<object>} the booted host with `request`/`close`.
 */
async function boot(roots, extra = {}) {
  const registry = await bootRegistry()
  const base = {
    roots, maxDepth: 4, rank: 300, includeHidden: false, includeFlatRootFiles: true,
    watch: false, watchDebounceMs: 250, duplicatePolicy: 'first-wins', providerName: 'nested-filesystem',
    skills: {}, writeAccess: 'same-origin', mcpServers: [], ...extra,
  }
  const settings = makeSettingsStub(base)
  const ctx = registry.ctx
  ctx.provide('fs', makeFsService())
  ctx.logger = { info: () => {}, warn: () => {}, error: () => {} }
  const routes = new Map()
  let handle
  await ctx.plugin(
    {
      name: 'skill-nesting-host',
      inject: ['skills'],
      apply: (pluginCtx) => {
        pluginCtx.provide('settings', settings.settings)
        pluginCtx.provide('webServer', {
          register(route) {
            routes.set(route.path, route.handler)
            return () => routes.delete(route.path)
          },
        })
        handle = apply(pluginCtx, base)
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
  async function request(path, options = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
    })
    const text = await response.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }
    return { status: response.status, body, text }
  }
  /** The headers a same-origin browser write carries. */
  const writeHeaders = () => ({ 'content-type': 'application/json', host: `127.0.0.1:${port}` })
  return {
    ...registry, ctx, settings, base, port, request, writeHeaders, routes,
    get handle() {
      return handle
    },
    async close() {
      await new Promise((resolve) => server.close(resolve))
      await ctx.fiber.dispose()
    },
  }
}

/** Read the model-visible names through the live registry. */
const modelNames = async (booted) =>
  (await booted.ctx.skills.list()).filter((s) => booted.isModelInvocable(s)).map((s) => s.name)

// ── 1. a toggle over HTTP really changes what the model sees ──────────────
{
  const booted = await boot([root])
  check('before: the model sees both skills', await modelNames(booted), ['alpha', 'beta'])

  const toggle = await booted.request(ROUTE_APPLY, {
    method: 'POST',
    headers: booted.writeHeaders(),
    body: JSON.stringify({ ops: [{ kind: 'skill.toggle', name: 'alpha', enabled: false }] }),
  })
  check('the toggle is applied', toggle.status, 200)
  check('the result reports applied', toggle.body.results[0].status, STATUS.APPLIED)
  checkTrue('the result reports success', toggle.body.results[0].ok === true)
  checkTrue('the detail says it is disabled', /is disabled/i.test(toggle.body.results[0].detail))

  // THE READ-BACK: the model catalog must no longer offer it...
  check('after: the model catalog hides alpha', await modelNames(booted), ['beta'])
  // ...and the body must be unreachable, which is what the `skill` tool reports.
  check('after: loading alpha answers undefined', await booted.ctx.skills.get('alpha'), undefined)
  check('after: the toggle was persisted', [...readToggles(booted.settings.resolved())], ['alpha'])

  // The response carries the state AFTER the batch, so no second round trip.
  const row = toggle.body.state.skills.find((s) => s.name === 'alpha')
  check('the echoed state shows alpha disabled', row.enabled, false)
  checkTrue('the echoed state shows the disable effective', row.effective === true)
  checkFalse('the echoed state shows it model-invisible', row.modelInvocable)

  // ─ restore ────────────────────────────────────────────────────────────
  const back = await booted.request(ROUTE_APPLY, {
    method: 'POST',
    headers: booted.writeHeaders(),
    body: JSON.stringify({ ops: [{ kind: 'skill.toggle', name: 'alpha', enabled: true }] }),
  })
  check('re-enabling is applied', back.body.results[0].status, STATUS.APPLIED)
  check('after: the model sees both skills again', await modelNames(booted), ['alpha', 'beta'])
  check('after: the settings table is clean again', [...readToggles(booted.settings.resolved())], [])
  const body = await booted.ctx.skills.get('alpha')
  checkTrue('after: the body loads identically', typeof body?.content === 'string' && body.content.includes('# alpha'))
  await booted.close()
}

// ── 2. the state document agrees with the live registry ───────────────────
{
  const booted = await boot([root])
  await booted.request(ROUTE_APPLY, {
    method: 'POST',
    headers: booted.writeHeaders(),
    body: JSON.stringify({ ops: [{ kind: 'skill.toggle', name: 'alpha', enabled: false }] }),
  })
  const state = (await booted.request(ROUTE_STATE)).body
  const live = new Map((await booted.ctx.skills.list()).map((s) => [s.name, s]))

  check('the state lists exactly the live catalog', state.skills.map((s) => s.name).sort(), [...live.keys()].sort())
  for (const row of state.skills) {
    const summary = live.get(row.name)
    check(`  ${row.name}: provider agrees with the registry`, row.provider, summary.provider)
    check(`  ${row.name}: modelInvocable agrees`, row.modelInvocable, summary.invocation.modelInvocable === true)
    check(`  ${row.name}: userInvocable agrees`, row.userInvocable, summary.invocation.userInvocable === true)
  }
  await booted.close()
}

// ─ 3. a bulk write lands in ONE settings write (F3.5) ───────────────────
{
  const booted = await boot([root])
  const writes = []
  const originalWrite = booted.settings.write
  // Count how many settings writes the batch produces.
  const counted = (ops) => {
    writes.push(ops)
    originalWrite(ops)
  }
  booted.settings.write = counted
  // The plugin closes over the stub object's method, so patch it in place.
  booted.settings.settings.mutate = async (_ns, ops) => counted(ops)

  const response = await booted.request(ROUTE_APPLY, {
    method: 'POST',
    headers: booted.writeHeaders(),
    body: JSON.stringify({
      ops: [{ kind: 'skill.bulk', skills: [{ name: 'alpha', enabled: false }, { name: 'beta', enabled: false }] }],
    }),
  })
  check('the bulk write is accepted', response.status, 200)
  check('it returns one result per skill', response.body.results.length, 2)
  check('both are applied', response.body.results.map((r) => r.status), [STATUS.APPLIED, STATUS.APPLIED])
  check('only ONE settings write happened', writes.length, 1)
  check('both names are disabled', [...readToggles(booted.settings.resolved())].sort(), ['alpha', 'beta'])
  check('the model sees nothing', await modelNames(booted), [])
  await booted.close()
}

// ── 4. a bulk write reports a no-op honestly ──────────────────────────────
{
  const booted = await boot([root])
  await booted.request(ROUTE_APPLY, {
    method: 'POST', headers: booted.writeHeaders(),
    body: JSON.stringify({ ops: [{ kind: 'skill.bulk', names: ['alpha'], enabled: false }] }),
  })
  const again = await booted.request(ROUTE_APPLY, {
    method: 'POST', headers: booted.writeHeaders(),
    body: JSON.stringify({ ops: [{ kind: 'skill.bulk', names: ['alpha'], enabled: false }] }),
  })
  check('a repeated bulk disable reports unchanged', again.body.results[0].status, STATUS.UNCHANGED)
  checkTrue('and says so plainly', /already disabled/i.test(again.body.results[0].detail))
  checkFalse('and does NOT claim another provider still serves it', /another-provider/.test(again.body.results[0].detail))
  await booted.close()
}

// ─ 5. config.set changes discovery live, invalid input is refused ────────
{
  const booted = await boot([root])
  const before = (await booted.request(ROUTE_STATE)).body.config.maxDepth
  check('the baseline maxDepth is reported', before, 4)

  const set = await booted.request(ROUTE_APPLY, {
    method: 'POST', headers: booted.writeHeaders(),
    body: JSON.stringify({ ops: [{ kind: 'config.set', path: ['maxDepth'], value: 1 }] }),
  })
  check('a valid config change is applied', set.body.results[0].status, STATUS.APPLIED)
  check('the live config really changed', (await booted.request(ROUTE_STATE)).body.config.maxDepth, 1)
  // At depth 1 the nested skills are gone from the model's catalog.
  check('discovery re-read the new depth immediately', await modelNames(booted), [])

  const bad = await booted.request(ROUTE_APPLY, {
    method: 'POST', headers: booted.writeHeaders(),
    body: JSON.stringify({ ops: [{ kind: 'config.set', path: ['maxDepth'], value: 0 }] }),
  })
  check('an invalid config value is refused', bad.body.results[0].status, STATUS.REFUSED)
  checkTrue('the refusal names the field', /maxDepth/.test(bad.body.results[0].detail))
  check('the live config was NOT changed by the refusal', (await booted.request(ROUTE_STATE)).body.config.maxDepth, 1)

  const unknown = await booted.request(ROUTE_APPLY, {
    method: 'POST', headers: booted.writeHeaders(),
    body: JSON.stringify({ ops: [{ kind: 'config.set', path: ['nope'], value: 1 }] }),
  })
  check('an unknown field is refused', unknown.body.results[0].status, STATUS.REFUSED)

  const unset = await booted.request(ROUTE_APPLY, {
    method: 'POST', headers: booted.writeHeaders(),
    body: JSON.stringify({ ops: [{ kind: 'config.unset', path: ['maxDepth'] }] }),
  })
  check('config.unset is applied', unset.body.results[0].status, STATUS.APPLIED)
  check('the row default is restored', (await booted.request(ROUTE_STATE)).body.config.maxDepth, 4)
  check('discovery is back to the nested skills', await modelNames(booted), ['alpha', 'beta'])
  await booted.close()
}

// ─ 6. a read-only host refuses writes instead of pretending ──────────────
{
  const registry = await bootRegistry()
  const base = {
    roots: [root], maxDepth: 4, rank: 300, includeHidden: false, includeFlatRootFiles: true,
    watch: false, watchDebounceMs: 250, duplicatePolicy: 'first-wins', providerName: 'nested-filesystem',
    skills: {}, writeAccess: 'same-origin', mcpServers: [],
  }
  const ctx = registry.ctx
  ctx.provide('fs', makeFsService())
  ctx.logger = { info: () => {}, warn: () => {}, error: () => {} }
  const routes = new Map()
  let handle
  await ctx.plugin(
    {
      name: 'skill-nesting-host',
      inject: ['skills'],
      apply: (pluginCtx) => {
        // NO settings service at all: the host can read but not persist.
        pluginCtx.provide('webServer', {
          register(route) {
            routes.set(route.path, route.handler)
            return () => routes.delete(route.path)
          },
        })
        handle = apply(pluginCtx, base)
      },
    },
    {},
  )
  const server = createServer((req, res) => {
    const handler = routes.get((req.url ?? '/').split('?')[0])
    if (handler === undefined) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    Promise.resolve(handler(req, res)).catch(() => {
      res.statusCode = 500
      res.end('threw')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const get = async (path) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`)
    return { status: response.status, body: JSON.parse(await response.text()) }
  }
  const post = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: `127.0.0.1:${port}` },
      body: JSON.stringify(body),
    })
    return { status: response.status, body: JSON.parse(await response.text()) }
  }

  const state = await get(ROUTE_STATE)
  check('a host without settings is readable', state.status, 200)
  checkFalse('it reports itself as not writable', state.body.writable)
  checkTrue('it still lists skills', state.body.skills.length > 0)
  const write = await post(ROUTE_APPLY, { ops: [{ kind: 'skill.toggle', name: 'alpha', enabled: false }] })
  check('a write is refused with 403', write.status, 403)
  check('the refusal explains the read-only state', write.body.results[0].status, STATUS.REFUSED)
  checkTrue('the detail names the cause', /read-only/i.test(write.body.results[0].detail))
  checkTrue('the skill is untouched', (await ctx.skills.list()).length === 2)

  await new Promise((resolve) => server.close(resolve))
  await ctx.fiber.dispose()
}

// ── 7. REAL TREE: scale, correctness and latency at production size ───────
// The denominator is stated explicitly, and the same scan is repeated through
// the endpoint so the P95 below is measured on the real payload.
{
  const realRoot = join(homedir(), '.agents', 'skills')
  let usable = true
  try {
    await readdir(realRoot)
  } catch {
    usable = false
  }
  if (!usable) {
    console.log(`SKIP  real-tree scale: ${realRoot} is not readable on this machine`)
  } else {
    const booted = await boot([realRoot], { maxDepth: 6 })
    // Warm the caches the endpoint relies on, then measure.
    const warm = await booted.request(ROUTE_STATE)
    check('the real tree serves state with 200', warm.status, 200)

    const skills = warm.body.skills
    const categories = new Set(skills.map((s) => s.category).filter((c) => c !== ''))
    console.log(`\n  REAL TREE — root ${realRoot} (symlink to ${await realpath(realRoot)})`)
    console.log(`  skills=${skills.length}  categories=${categories.size}  conflicts=${warm.body.conflicts.length}`)
    console.log(`  roots=${JSON.stringify(warm.body.roots)}`)
    console.log(`  errors=${warm.body.errors.length}  mcp.servers=${warm.body.mcp.servers.length}`)
    if (warm.body.conflicts.length > 0) {
      for (const conflict of warm.body.conflicts) {
        console.log(`  conflict ${conflict.name}: winner ${conflict.winner.provider} ${conflict.winner.path}`)
        for (const loser of conflict.losers) console.log(`      loser ${loser.provider} ${loser.path}`)
      }
    }

    checkTrue('the real tree yields a substantial catalog', skills.length > 100)
    check('the real tree yields 24 categories', categories.size, 24)
    check('the real tree yields exactly one conflict (github)', warm.body.conflicts.map((c) => c.name), ['github'])
    check('no discovery errors on the real tree', warm.body.errors, [])
    checkTrue('the symlinked root is reported as existing', warm.body.roots.every((r) => r.exists))

    // Every reported conflict winner must match the live registry exactly.
    const live = new Map((await booted.ctx.skills.list()).map((s) => [s.name, s]))
    for (const conflict of warm.body.conflicts) {
      const summary = live.get(conflict.name)
      check(`  conflict ${conflict.name}: winner path matches the registry`, conflict.winner.path, summary.path)
      check(`  conflict ${conflict.name}: winner provider matches the registry`, conflict.winner.provider, summary.provider)
    }

    // Latency: 25 warm requests, P95 against the 500ms budget.
    const samples = []
    for (let i = 0; i < 25; i += 1) {
      const started = process.hrtime.bigint()
      const response = await booted.request(ROUTE_STATE)
      samples.push(Number(process.hrtime.bigint() - started) / 1e6)
      if (response.status !== 200) throw new Error(`state request ${i} answered ${response.status}`)
    }
    samples.sort((a, b) => a - b)
    const p50 = samples[Math.floor(samples.length * 0.5)]
    const p95 = samples[Math.floor(samples.length * 0.95)]
    const max = samples[samples.length - 1]
    console.log(`  state endpoint latency over 25 warm requests (ms): p50=${p50.toFixed(1)} p95=${p95.toFixed(1)} max=${max.toFixed(1)}`)
    checkTrue('state P95 is under the 500ms budget (N5)', p95 < 500)

    // A toggle at real scale must still be verified by read-back.
    const target = skills.find((s) => s.name === 'ascii-art') ?? skills[0]
    const toggle = await booted.request(ROUTE_APPLY, {
      method: 'POST',
      headers: booted.writeHeaders(),
      body: JSON.stringify({ ops: [{ kind: 'skill.toggle', name: target.name, enabled: false }] }),
    })
    check(`the toggle of "${target.name}" at real scale is applied`, toggle.body.results[0].status, STATUS.APPLIED)
    const row = toggle.body.state.skills.find((s) => s.name === target.name)
    checkFalse(`  "${target.name}" is no longer model-invocable`, row.modelInvocable)
    checkTrue(`  "${target.name}" reports effective`, row.effective === true)
    const hidden = await booted.ctx.skills.get(target.name)
    check(`  the body of "${target.name}" is unreachable`, hidden, undefined)
    await booted.close()
  }
}

await rm(root, { recursive: true, force: true })
finish()