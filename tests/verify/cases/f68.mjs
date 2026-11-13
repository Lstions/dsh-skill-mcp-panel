/**
 * F6.8 — a pasted `mcpServers` document keeps its meaning, and every imported
 * server is NAMED and can carry a NOTE.
 *
 * WHY THIS CASE EXISTS
 * Every other MCP client already speaks the same document shape, so "paste it"
 * replaced retyping a server by hand. The failure modes that matter are not
 * "does JSON.parse succeed":
 *
 *   1. a document that parses but CHANGES MEANING — arguments dropped, an env
 *      entry lost, or `sse` quietly mapped onto a transport this host lacks;
 *   2. a name conflict that overwrites a server the user already had;
 *   3. a partial document that leaves half of itself persisted;
 *   4. an auto-derived name the user never confirmed, leaving several
 *      indistinguishable rows in a list that can only be told apart by name.
 *
 * The case drives the REAL parser and the REAL manager. No mount is attempted:
 * every server is declared disabled, which is the documented way to import
 * without starting a process, and the `ctx.plugin` stub throws to prove this
 * case could not accidentally mount one.
 */
import { loadMcp } from '../lib/plugin-under-test.mjs'

export const meta = {
  id: 'f68',
  requirement: 'F6.8',
  title: 'a pasted mcpServers document is previewed, then imported under user-confirmed names and notes',
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
  if (typeof mcp.parseMcpServers !== 'function') {
    report.blocked('F6.8: lib/mcp.js exports no parseMcpServers (the JSON import surface has not landed)')
  }
  if (typeof mcp.createMcpManager !== 'function') {
    report.blocked('F6.8: lib/mcp.js exports no createMcpManager')
  }
  const parse = mcp.parseMcpServers

  // ---- 1. the two documents a user actually pasted ------------------------
  const twoDocument = JSON.stringify({
    mcpServers: {
      'bing-search': { command: 'npx', args: ['-y', 'bing-cn-mcp'] },
      playwright: { command: 'npx', args: ['@playwright/mcp@latest', '--headless'] },
    },
  })
  const parsed = parse(twoDocument)
  report.observe('parsed document', JSON.stringify(parsed.entries))
  report.check('F6.8: both named servers are parsed', parsed.entries.map((entry) => entry.serverName), ['bing-search', 'playwright'])
  report.check('F6.8: args survive verbatim', parsed.entries[0].config.args, ['-y', 'bing-cn-mcp'])
  report.check('F6.8: flags survive verbatim', parsed.entries[1].config.args, ['@playwright/mcp@latest', '--headless'])
  report.check('F6.8: neither entry carries an error', parsed.entries.map((entry) => entry.configError ?? entry.nameError), [null, null])

  // ---- 2. a raw server object has no name, and that is not an error ------
  const raw = parse({ command: 'npx', args: ['-y', 'playwright'] })
  report.check('F6.8: a raw server object parses to one entry', raw.entries.length, 1)
  report.check('F6.8: the raw entry has no name', raw.entries[0].serverName, null)
  report.check('F6.8: the raw entry keeps its config', raw.entries[0].config.command, 'npx')

  // ---- 3. a document that must be refused, not reinterpreted -------------
  const sse = parse({ SomeName: { type: 'sse', url: 'https://example.test/sse' } })
  report.assert(
    'F6.8: an sse entry is refused rather than mapped onto another transport',
    sse.entries.length === 1 && sse.entries[0].config === null,
    JSON.stringify(sse.entries),
  )
  report.assert(
    'F6.8: the sse refusal explains what to use instead',
    /streamable-http/i.test(sse.entries[0]?.configError ?? ''),
    sse.entries[0]?.configError,
  )
  const badName = parse({ 'name.with.dot': { command: 'npx' } })
  report.assert(
    'F6.8: a name the MCP client would reject is reported on its own entry',
    badName.entries[0].config !== null && /serverName/.test(badName.entries[0]?.nameError ?? ''),
    JSON.stringify(badName.entries[0]),
  )
  const malformed = parse('{"mcpServers": ')
  report.assert(
    'F6.8: malformed JSON is a refusal with a reason, never a throw',
    malformed.entries.length === 1 && /not valid JSON/.test(malformed.entries[0]?.configError ?? ''),
    malformed.entries[0]?.configError,
  )

  // ---- 4. preview writes nothing and answers per entry -------------------
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
    const preview = await manager.apply({ kind: 'mcp.preview', json: twoDocument })
    report.check('F6.8: preview answers per server', preview.map((result) => result.preview.serverName), ['bing-search', 'playwright'])
    report.check('F6.8: preview proposes the parsed config', preview[0].preview.config.command, 'npx')
    report.check('F6.8: preview writes no declaration', host.writes.length, 0)
    report.check('F6.8: preview leaves the store empty', host.declared.length, 0)

    // ---- 5. the reviewed import stores the confirmed names and notes ----
    const reviewed = await manager.apply({
      kind: 'mcp.import',
      entries: [
        { serverName: 'bing-search-cn', note: ' 国内必应 ', config: { transport: 'stdio', command: 'npx', args: ['-y', 'bing-cn-mcp'] }, enabled: false },
        { serverName: 'playwright', note: '无头浏览器', config: { transport: 'stdio', command: 'npx', args: ['@playwright/mcp@latest', '--headless'] }, enabled: false },
      ],
    })
    report.check('F6.8: one result per reviewed entry', reviewed.map((result) => result.target), ['bing-search-cn', 'playwright'])
    report.check('F6.8: both reviewed entries are applied', reviewed.map((result) => result.status), ['applied', 'applied'])
    report.check('F6.8: the reviewed document took ONE write', host.writes.length, 1)
    report.check('F6.8: the confirmed name is stored', host.declared.map((item) => item.serverName), ['bing-search-cn', 'playwright'])
    report.check('F6.8: the note is stored trimmed', host.declared[0].note, '国内必应')
    const inventory = await manager.describe()
    report.check('F6.8: the note is reported for the list', inventory.servers.find((server) => server.serverName === 'bing-search-cn').note, '国内必应')

    // ---- 6. a nameless reviewed entry is refused, not invented ----------
    const nameless = await manager.apply({
      kind: 'mcp.import',
      entries: [{ serverName: '   ', config: { transport: 'stdio', command: 'node' } }],
    })
    report.check('F6.8: an unnamed reviewed entry is refused', nameless[0].status, 'refused')
    report.assert(
      'F6.8: the refusal says a name is required',
      /name is required/i.test(nameless[0].detail),
      nameless[0].detail,
    )
    report.check('F6.8: a nameless entry writes nothing', host.writes.length, 1)

    // ---- 7. re-importing the same names must not duplicate or overwrite --
    const again = await manager.apply({
      kind: 'mcp.import',
      json: { mcpServers: { 'bing-search-cn': { command: 'npx', disabled: true } } },
    })
    report.check('F6.8: an existing name reports unchanged', again[0].status, 'unchanged')
    report.check('F6.8: a repeated import writes nothing', host.writes.length, 1)
    report.check('F6.8: the stored note survives the attempt', host.declared[0].note, '国内必应')
  } finally {
    await manager.dispose()
  }
}
