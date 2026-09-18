/**
 * N6 — degradation. Missing optional services must disable the dependent
 * feature and SAY SO; they must never crash the plugin or silently pretend the
 * feature works.
 *
 * Three absences, each asserted separately because they fail differently:
 *   no `pluginManager`  -> MCP toggles disabled, everything else still works
 *   no MCP client       -> reported as unavailable, no throw
 *   no `settings`       -> read-only mode, reads still succeed
 *
 * The dangerous outcome is not a crash (loud) but a plugin that renders an
 * enabled-looking switch it cannot honour (silent). So each case asserts the
 * declared limitation is actually present in the payload.
 */
import { bootRealSkills, registerProvider, candidate, settle } from '../lib/real-harness.mjs'
import { loadState, loadMcp, readStateSkills, hasModule } from '../lib/plugin-under-test.mjs'

export const meta = { id: 'degrade', requirement: 'N6', title: 'missing optional services degrade loudly and never crash' }

export async function run(report) {
  const stateAvailable = hasModule('state.js')
  if (!stateAvailable) {
    report.blocked('N6: skill-nesting/lib/state.js does not exist yet, so there is no state document to degrade')
  }

  const stateModule = await loadState(report)

  // ---- 1. no pluginManager: MCP toggles must be disabled, not broken -------
  {
    const { ctx, dispose } = await bootRealSkills()
    try {
      registerProvider(ctx, 'nested-filesystem', [
        candidate('alpha', { provider: 'nested-filesystem' }),
      ])
      await settle()

      // Deliberately NO pluginManager on this context.
      report.assert('precondition: ctx.get("pluginManager") is undefined', ctx.get('pluginManager') === undefined)

      const { state } = await readStateSkills(stateModule, ctx, report)
      report.observe('state.mcp without pluginManager', state.mcp)
      report.assert('N6: the state document still builds without pluginManager', state !== undefined)

      const servers = state.mcp?.servers ?? []
      report.observe('servers reported', servers.length)
      report.assert(
        'N6: managerAvailable is false (the limitation is declared, not hidden)',
        state.mcp?.managerAvailable === false,
        `managerAvailable=${JSON.stringify(state.mcp?.managerAvailable)}`,
      )

      // Every server row must either be addressable=false or carry a reason.
      for (const server of servers) {
        report.assert(
          `N6: server "${server.serverName}" is either non-addressable or explains why it cannot be toggled`,
          server.addressable === false || (typeof server.readOnlyReason === 'string' && server.readOnlyReason.length > 0),
          `addressable=${server.addressable} readOnlyReason=${JSON.stringify(server.readOnlyReason)}`,
        )
      }

      // The skills list must be unaffected by the missing manager.
      const skills = state.skills ?? []
      report.assert(
        'N6: skill listing still works without pluginManager',
        skills.length > 0,
        `skills=${skills.length}`,
      )
    } finally {
      await dispose()
    }
  }

  // ---- 2. no settings: read-only, reads still succeed ----------------------
  {
    const { ctx, dispose } = await bootRealSkills()
    try {
      registerProvider(ctx, 'nested-filesystem', [candidate('beta', { provider: 'nested-filesystem' })])
      await settle()
      report.assert('precondition: ctx.settings is undefined', ctx.settings === undefined)

      const { state, skills } = await readStateSkills(stateModule, ctx, report)
      report.observe('state.writable without settings', state.writable)
      report.assert('N6: reads succeed without a settings service', skills.length > 0, `skills=${skills.length}`)
      report.assert(
        'N6: writable is false without settings (or the writer explains itself)',
        state.writable === false || typeof state.writeAccess === 'string',
        `writable=${JSON.stringify(state.writable)} writeAccess=${JSON.stringify(state.writeAccess)}`,
      )
    } finally {
      await dispose()
    }
  }

  // ---- 3. no MCP client package -------------------------------------------
  {
    const has = hasModule('mcp.js')
    if (!has) {
      report.observe('mcp.js', 'absent — F6.7 cannot be exercised yet')
    } else {
      const mcp = await loadMcp(report)
      const { ctx, dispose } = await bootRealSkills()
      try {
        const manager = await createManager(mcp, ctx, report)
        if (manager === undefined) {
          report.observe('createMcpManager', 'not exported under a recognised name')
        } else {
          const described = await manager.describe()
          report.observe('describe() without a manager or client package', described)
          report.assert(
            'N6/F6.7: mcpClientAvailable is reported as a boolean (no throw)',
            typeof described?.mcpClientAvailable === 'boolean',
            `mcpClientAvailable=${JSON.stringify(described?.mcpClientAvailable)}`,
          )
          report.assert(
            'N6/F6.7: servers is an array even when nothing can be mounted',
            Array.isArray(described?.servers),
            `servers=${JSON.stringify(described?.servers)?.slice(0, 120)}`,
          )
        }
      } finally {
        await dispose()
      }
    }
  }
}

async function createManager(mcp, ctx, report) {
  const factory = mcp.createMcpManager ?? mcp.createManager
  if (typeof factory !== 'function') {
    report.observe('mcp exports', Object.keys(mcp))
    return undefined
  }
  try {
    return await factory({ ctx, readDeclared: () => [], readConfig: () => ({}), log: { info() {}, warn() {}, error() {} } })
  } catch (error) {
    report.observe('createMcpManager threw', error.message)
    report.assert('N6: createMcpManager must not throw when optional services are absent', false, error.message)
    return undefined
  }
}