/**
 * The @lstions/dsh-skill-mcp-panel bundle group.
 *
 * The bundle is a GROUP, not a single row: the engine, the page components and
 * any future capability are separate loader entries that can be enabled,
 * disabled and inspected independently (the Plugins page lists them as the
 * bundle's components). The loader treats a group entry specially — it must be
 * marked with the Cordis group symbol and mount its children through the
 * loader's own `cordis:group` builtin, which owns creation, removal and
 * teardown of the child entries.
 *
 * Mirrors the pattern the loader documents for nested composition (and the one
 * other multi-component bundles in the ecosystem use): the class holds the
 * child list in `config` and hands it to the builtin group.
 *
 * @module @lstions/dsh-skill-mcp-panel/bundle
 */

const GROUP = Symbol.for('cordis.group')
const INIT = Symbol.for('cordis.init')

export default class SkillMcpPanelBundle {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx
   * @param {object[]} config - child entry options.
   */
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config ?? []
  }

  /** The builtin group needs the Loader service. */
  static inject = ['loader']

  /** Marks this plugin as a loader group. */
  static [GROUP] = true

  /**
   * Mount the children with the loader's own group implementation.
   * @returns {AsyncGenerator<() => void>} disposal, then the mounted group.
   */
  async *[INIT]() {
    const Group = this.ctx.loader?.builtins?.group
    if (typeof Group !== 'function') {
      throw new Error('@lstions/dsh-skill-mcp-panel/bundle needs the Loader cordis:group builtin')
    }
    const group = new Group(this.ctx, this.config)
    yield () => group.stop()
    await group.update(this.config)
  }
}
