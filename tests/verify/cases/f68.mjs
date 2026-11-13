/**
 * F6.8 — a pasted `mcpServers` document is imported as its author meant it.
 *
 * WHY THIS CASE EXISTS
 * Every other MCP client already speaks the same document shape, so "paste it"
 * replaced retyping a server by hand. The failure modes that matter are not
 * "does JSON.parse succeed":
 *
 *   1. a document that parses but CHANGES MEANING — arguments dropped, an env
 *      entry lost, or `sse` quietly mapped onto a transport this host lacks;
 *   2. a name conflict that overwrites a server the user already had;
 *   3. a partial document that leaves half of itself persisted.
 *
 * The case drives the REAL parser and the REAL manager. No mount is attempted:
 * every pasted server is declared disabled, which is the documented way to
 * import without starting a process, and the `ctx.plugin` stub throws to prove
 * this case could not accidentally mount one.
 */
import { loadMcp } from '../lib/plugin-under-test.mjs'

export const meta = {
  id: 'f68',
  requirement: 'F6.8',
  title: 'a pasted mcpServers document keeps its meaning: one result per server, one write',
}

/** A fake host: no loader rows, no tools, and mounting is forbidden. */
function makeHost(declared = []) {
  const writes = []
  let current = declared.map((item) => structuredClone(item))
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    get() {
      return undefined
    },
    plugin() {
      throw new Error('this case imports DISABLED servers; no mount may happen')
    },
  }
  return { ctx, writes, get declared() { return current }, setDeclared(next) { current = next } }
}

export async function run(report) {
  const mcp = await loadMcp(report)
  const parse = mcp.parseMcpServers
  if (typeof parse !== 'function') {
    report.blocked('F6.8: lib/mcp.js exports no parseMcpServers (the JSON import surface has not landed)')
  }
  if (typeof mcp.createMcpManager !== 'function') {
    report.blocked('F6.8: lib/mcp.js exports no createMcpManager')
  }

  // ---- 1. the two documents a user actually pasted ------------------------
  const twoDocument = JSON.stringify({
    mcpServers: {
      'bing-search': { command: 'npx', args: ['-y', 'bing-cn-mcp'] },
      playwright: { command: 'npx', args: ['@playwright/mcp@latest', '--headless'] },
    },
  })
  const parsed = parse(twoDocument)
  report.observe('parsed document', JSON.stringify(parsed.servers))
  report.check('F6.8: both named servers are parsed', parsed.servers.map((server) => server.serverName), ['bing-search', 'playwright'])
  report.check('F6.8: args survive verbatim', parsed.servers[0].config.args, ['-y', 'bing-cn-mcp'])
  report.check('F6.8: flags survive verbatim', parsed.servers[1].config.args, ['@playwright/mcp@latest', '--headless'])
  report.check('F6.8: a document with no errors reports none', parsed.errors, [])

  // ---- 2. a document that must be refused, not reinterpreted -------------
  const sse = parse({ SomeName: { type: 'sse', url: 'https://example.test/sse' } })
  report.assert(
    'F6.8: an sse entry is refused rather than mapped onto another transport',
    sse.servers.length === 0 && sse.errors.length === 1,
    JSON.stringify(sse),
  )
  report.assert(
    'F6.8: the sse refusal explains what to use instead',
    /streamable-http/i.test(sse.errors[0]?.error ?? ''),
    sse.errors[0]?.error,
  )
  const badName = parse({ 'name.with.dot': { command: 'npx' } })
  report.assert(
    'F6.8: a name the MCP client would reject is refused up front',
    badName.servers.length === 0 && /serverName/.test(badName.errors[0]?.error ?? ''),
    badName.errors[0]?.error,
  )
  const malformed = parse('{"mcpServers": ')
  report.assert(
    'F6.8: malformed JSON is a refusal with a reason, never a throw',
    malformed.servers.length === 0 && /not valid JSON/.test(malformed.errors[0]?.error ?? ''),
    malformed.errors[0]?.error,
  )
  const nameless = parse({ command: 'npx', args: ['-y', 'x'] })
  report.assert(
    'F6.8: a single server pasted without a name is refused with the actual mistake',
    /server name is required/.test(nameless.errors[0]?.error ?? ''),
    nameless.errors[0]?.error,
  )

  // ---- 3. the manager writes once and answers per server -----------------
  const host = makeHost()
  const manager = mcp.createMcpManager({
    ctx: host.ctx,
    readDeclared: () => host.declared,
    writeDeclared: (next) => {
      host.writes.push(next)
      host.setDeclared(structuredClone(next))
    },
  })
  try {
    const document = {
      mcpServers: {
        one: { command: 'npx', args: ['-y', 'one'], disabled: true },
        two: { type: 'http', url: 'https://two.example.test/mcp', headers: { Authorization: 'Bearer t' }, disabled: true },
      },
    }
    const results = await manager.apply({ kind: 'mcp.import', servers: document.mcpServers })
    report.check('F6.8: one result per pasted server', results.map((result) => result.target), ['one', 'two'])
    report.check('F6.8: both are applied', results.map((result) => result.status), ['applied', 'applied'])
    report.check('F6.8: the document was persisted in ONE write', host.writes.length, 1)
    report.check('F6.8: both declarations are stored', host.declared.map((item) => item.serverName), ['one', 'two'])
    report.check('F6.8: the remote type alias was normalised', host.declared[1].config.transport, 'streamable-http')
    report.check('F6.8: the header survived the import', host.declared[1].config.headers, { Authorization: 'Bearer t' })

    // ---- 4. re-importing must not duplicate or overwrite -----------------
    const again = await manager.apply({ kind: 'mcp.import', servers: document.mcpServers })
    report.check('F6.8: a repeated import reports unchanged', again.map((result) => result.status), ['unchanged', 'unchanged'])
    report.check('F6.8: a repeated import writes nothing', host.writes.length, 1)
    report.check('F6.8: a repeated import stores nothing new', host.declared.length, 2)

    // ---- 5. one bad entry must not discard the good ones ----------------
    const partial = await manager.apply({
      kind: 'mcp.import',
      servers: { good: { command: 'npx', disabled: true }, 'bad/name': { command: 'npx', disabled: true } },
    })
    report.check('F6.8: a partially valid document answers per entry', partial.map((result) => result.status), ['applied', 'refused'])
    report.check(
      'F6.8: only the valid entry reached the store',
      host.declared.map((item) => item.serverName),
      ['one', 'two', 'good'],
    )
  } finally {
    await manager.dispose()
  }
}
