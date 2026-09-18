/**
 * F6.3 — a DEAD server must never be reported as `applied`.
 *
 * THE FAILURE MODE THIS EXISTS TO CATCH
 * The MCP client's `failOnStartupError` defaults to FALSE. With that default a
 * server whose command does not exist still reaches a settled fiber with zero
 * tools — so an implementation that merely waits for the fiber and then says
 * "applied" reports success for a process that never ran. The user then sees an
 * enabled server contributing nothing: no error, no tools, no clue.
 *
 * So this case does not check "did the call return" but "is the claim TRUE":
 *   1. stdio whose command does not exist -> must NOT be `applied`
 *   2. streamable-http on a closed port  -> must NOT be `applied`
 *   3. a WORKING stdio server            -> must be `applied` AND its tool must
 *      really be in the live tool registry (the control that stops the fix from
 *      over-correcting into "nothing ever mounts")
 *   4. a failed server stays persisted, so the user can see and fix it
 *   5. removing the live server takes its tool out of the registry
 *
 * Runs against a REAL Cordis tree, the REAL MCP client package (resolved via a
 * host anchor), and a REAL stdio child process. An environment where the client
 * package cannot be resolved reports BLOCKED — an unrunnable environment is not
 * evidence about the product.
 */
import { createMcpManager } from '../../../lib/mcp.js'
import { makeHost, MCP_CLIENT_MODULE } from '../lib/mcp-host.mjs'
import { loadMcp } from '../lib/plugin-under-test.mjs'
import { fileURLToPath } from 'node:url'

// Derived from this file's location, so the suite is not bound to one machine.
const FIXTURE = fileURLToPath(new URL('../../../test/mcp-fixture-server.mjs', import.meta.url))

export const meta = { id: 'f63', requirement: 'F6.3', title: 'a dead MCP server is never reported applied; a live one really registers tools' }

export async function run(report) {
  const mcp = await loadMcp(report)
  if (typeof mcp.createMcpManager !== 'function') {
    report.blocked(`F6.3: lib/mcp.js exports no createMcpManager (found ${Object.keys(mcp).join(', ')})`)
  }

  const host = await makeHost()
  report.observe('host anchor', host.anchor ?? 'NONE')
  if (host.skip !== undefined) {
    report.blocked(`F6.3: ${host.skip}; the live mount cannot be exercised here`)
  }

  /** The manager under test, wired to the live host. */
  const manager = createMcpManager({
    ctx: host.ctx,
    readDeclared: () => host.declarations,
    writeDeclared: (next) => {
      host.declarations.splice(0, host.declarations.length, ...next)
    },
    readConfig: () => ({}),
  })

  try {
    // ---- 1. stdio with a nonexistent command ------------------------------
    const deadStdio = await applyOp(report, manager, {
      kind: 'mcp.add',
      serverName: 'dead-stdio',
      config: { transport: 'stdio', command: '/nonexistent/definitely-not-here', args: [], env: {} },
    })
    report.assert(
      'F6.3: a stdio server with a nonexistent command is NOT reported applied',
      deadStdio?.status !== 'applied',
      `status=${JSON.stringify(deadStdio?.status)} detail=${JSON.stringify(deadStdio?.detail)} — "applied" here would claim success for a process that never started`,
    )
    report.assert(
      'F6.3: the refusal carries a human-readable reason',
      typeof deadStdio?.detail === 'string' && deadStdio.detail.length > 0,
      `detail=${JSON.stringify(deadStdio?.detail)}`,
    )
    report.assert(
      'F6.3: a dead server contributes no tools',
      host.toolNames('mcp__dead-stdio__').length === 0,
      JSON.stringify(host.toolNames()),
    )

    // ---- 2. streamable-http on a closed port ------------------------------
    const deadHttp = await applyOp(report, manager, {
      kind: 'mcp.add',
      serverName: 'dead-http',
      config: { transport: 'streamable-http', url: 'http://127.0.0.1:9/mcp' },
    })
    report.assert(
      'F6.3: an unreachable streamable-http server is NOT reported applied',
      deadHttp?.status !== 'applied',
      `status=${JSON.stringify(deadHttp?.status)} detail=${JSON.stringify(deadHttp?.detail)}`,
    )

    // ---- 3. the control: a working server must still mount ----------------
    const live = await applyOp(report, manager, {
      kind: 'mcp.add',
      serverName: 'live-fixture',
      config: { transport: 'stdio', command: process.execPath, args: [FIXTURE], env: {} },
    })
    report.observe('live fixture add result', live)
    report.assert(
      'F6.3 control: a working server reports applied (the guard did not over-correct)',
      live?.status === 'applied',
      `status=${JSON.stringify(live?.status)} detail=${JSON.stringify(live?.detail)} — a refusal here means live mounting is broken`,
    )
    const liveTools = host.toolNames('mcp__live-fixture__')
    report.observe('live registry tools', host.toolNames())
    report.assert(
      'F5.4: the live server really registered its tool in the registry (not inferred from config)',
      liveTools.length > 0,
      `tools=${JSON.stringify(host.toolNames())} — "applied" with no tools is exactly the lie this case targets`,
    )

    // ---- 4. a failed server stays persisted -------------------------------
    report.observe('declarations', host.declarations.map((d) => d.serverName))
    report.assert(
      'F6.3: the dead server is still declared, so the user can see and fix it',
      host.declarations.some((d) => d.serverName === 'dead-stdio'),
      `declared=${JSON.stringify(host.declarations.map((d) => d.serverName))} — dropping it silently would hide the failure`,
    )

    // ---- 5. removal takes the tools away ----------------------------------
    const removed = await applyOp(report, manager, { kind: 'mcp.remove', serverName: 'live-fixture' })
    report.observe('remove result', removed)
    const afterRemove = host.toolNames('mcp__live-fixture__')
    report.observe('registry tools after removal', host.toolNames())
    report.assert(
      'F6.5: removing a server takes its tools out of the live registry',
      afterRemove.length === 0,
      `tools=${JSON.stringify(afterRemove)} — a leftover tool would call a disposed server`,
    )
  } finally {
    try {
      await manager.dispose()
    } catch {}
  }
}

/** Apply one op as a batch and return its single result. */
async function applyOp(report, manager, op) {
  const results = await manager.applyBatch([op])
  const result = Array.isArray(results) ? results[0] : results
  report.observe(`op ${op.kind} -> ${op.serverName}`, result)
  return result
}
