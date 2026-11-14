/**
 * The mcp page component of the dsh-skill-mcp-panel bundle.
 *
 * A component row exists instead of hard-coding the page in the engine, so the
 * management page's tab bar follows the composition: disabling this entry
 * removes the tab, and a future component can contribute another page the same
 * way. The host side only publishes a descriptor; the client bundle renders it.
 *
 * @module dsh-skill-mcp-panel/mcp
 */

export const name = 'skill-mcp-panel-mcp'

/** The engine provides the registry. */
export const inject = ['skillMcpPanelPages']

/**
 * Register this page with the engine's directory.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const registry = ctx.get('skillMcpPanelPages')
  if (registry === undefined) {
    ctx.logger.warn('skill-mcp-panel-mcp: page registry is unavailable; the page will not be listed')
    return
  }
  ctx.effect(
    () => registry.register({ id: 'mcp', labelKey: 'page.mcp', order: 20 }),
    'skill-mcp-panel-mcp: page descriptor',
  )
}
