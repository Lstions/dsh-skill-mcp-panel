/**
 * Page directory for the management view.
 *
 * The management page is not one monolith: each capability contributes a
 * PAGE, and the shell renders a tab bar from whatever pages are registered.
 * On the host this is a registry other bundle components write into; the
 * current page list travels to the client with the state document, so the
 * shell's tabs follow the composition instead of a hard-coded pair.
 *
 * A page descriptor is deliberately tiny — id, label key, order — because the
 * rendering stays in the client bundle (a host row cannot ship React). The
 * label key is resolved by the client's locale dictionary.
 *
 * @module dsh-skill-mcp-panel/pages
 */

/** Service name other bundle components inject to register their page. */
export const PAGES_SERVICE = 'skillMcpPanelPages'

/** Default order for an unnumbered page. */
const DEFAULT_ORDER = 100

/**
 * @typedef {object} PageDescriptor
 * @property {string} id - stable page id; also the client component key.
 * @property {string} labelKey - locale key for the tab label.
 * @property {number} order - ascending tab order.
 */

/**
 * Create the page registry a component registers its page into.
 * @returns {{register: (page: object) => () => void, list: () => PageDescriptor[]}}
 */
export function createPageRegistry() {
  /** @type {Map<string, PageDescriptor>} */
  const pages = new Map()

  return {
    /**
     * Register one page.
     *
     * Registering the same id twice REPLACES the descriptor: the loader can
     * remount a component, and a stale disposer must never drop the newer
     * registration. The returned disposer only removes the descriptor when it
     * is still the one this call installed.
     *
     * @param {{id?: unknown, labelKey?: unknown, order?: unknown}} page
     * @returns {() => void} unregister
     */
    register(page) {
      const id = typeof page?.id === 'string' ? page.id.trim() : ''
      if (id === '') throw new Error('skill-mcp-panel: a page needs a non-empty id')
      const labelKey = typeof page?.labelKey === 'string' && page.labelKey !== '' ? page.labelKey : id
      const order = Number.isFinite(page?.order) ? page.order : DEFAULT_ORDER
      const descriptor = Object.freeze({ id, labelKey, order })
      pages.set(id, descriptor)
      return () => {
        if (pages.get(id) === descriptor) pages.delete(id)
      }
    },

    /** Snapshot in tab order. */
    list() {
      return [...pages.values()].sort((left, right) => left.order - right.order)
    },
  }
}
