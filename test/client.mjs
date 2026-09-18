/**
 * Offline test for the skill-mcp-panel settings CARD.
 *
 * Loads the real `lib/client.js` browser bundle under a minimal React, locale,
 * and slot harness, then drives the rendered component. This is the only way to
 * exercise the card's real logic — collapsed disclosure, staged drafts, diffing,
 * validation, localization — without a browser.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { makeChecker } from './harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

const { results, check } = makeChecker()

// ─ minimal React with real hook state ─────────────────────────────────────
function sameDeps(a, b) {
  if (!a || !b || a.length !== b.length) return false
  return a.every((value, index) => Object.is(value, b[index]))
}

function makeReactRuntime() {
  const slotsByComponent = new Map()
  const refsByComponent = new Map()
  let current = undefined
  let refStore = undefined
  let index = 0
  let pendingEffects = []
  let dirty = false

  const slotsFor = (component) => {
    let slots = slotsByComponent.get(component)
    if (slots === undefined) {
      slots = []
      slotsByComponent.set(component, slots)
    }
    return slots
  }
  const refsFor = (component) => {
    let refs = refsByComponent.get(component)
    if (refs === undefined) {
      refs = []
      refsByComponent.set(component, refs)
    }
    return refs
  }

  const at = () => index++

  const React = {
    createElement(type, props, ...children) {
      const flat = children.length === 1 ? children[0] : children.length === 0 ? undefined : children
      return { type, props: { ...(props ?? {}), children: flat } }
    },
    useMemo(factory, deps) {
      const slot = (current[at()] ??= {})
      if (!sameDeps(slot.deps, deps)) {
        slot.value = factory()
        slot.deps = deps
      }
      return slot.value
    },
    useCallback(factory, deps) {
      const slot = (current[at()] ??= {})
      if (!sameDeps(slot.deps, deps)) {
        slot.value = factory
        slot.deps = deps
      }
      return slot.value
    },
    useState(initial) {
      const slot = (current[at()] ??= { value: typeof initial === 'function' ? initial() : initial })
      return [
        slot.value,
        (next) => {
          slot.value = typeof next === 'function' ? next(slot.value) : next
          dirty = true
        },
      ]
    },
    useEffect(effect, deps) {
      const slot = (current[at()] ??= {})
      if (!sameDeps(slot.deps, deps)) {
        slot.deps = deps
        pendingEffects.push(effect)
      }
    },
    useRef(initial) {
      const slot = (refStore[at()] ??= { current: initial })
      return slot
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      at()
      return getSnapshot()
    },
  }

  function expand(node) {
    if (node === null || node === undefined || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map(expand)
    if (typeof node.type === 'function') {
      const previous = current
      const previousRefs = refStore
      const previousIndex = index
      current = slotsFor(node.type)
      refStore = refsFor(node.type)
      index = 0
      const rendered = node.type(node.props)
      current = previous
      refStore = previousRefs
      index = previousIndex
      return expand(rendered)
    }
    return { type: node.type, props: { ...node.props, children: expand(node.props.children) } }
  }

  /**
   * Render a root element, run its effects, and re-render until a pass neither
   * wrote state nor queued an effect — the tree React would settle on, so
   * assertions observe post-effect state rather than the first pass.
   */
  function renderRoot(element) {
    let tree
    for (let pass = 0; pass < 12; pass += 1) {
      dirty = false
      pendingEffects = []
      tree = expand(element)
      const effects = pendingEffects
      pendingEffects = []
      const settled = !dirty && effects.length === 0
      for (const effect of effects) effect()
      if (settled) return tree
    }
    throw new Error('render did not stabilize')
  }

  function reset() {
    slotsByComponent.clear()
    refsByComponent.clear()
    current = undefined
    refStore = undefined
    index = 0
    pendingEffects = []
    dirty = false
  }

  return { React, renderRoot, reset }
}

// ── load the real bundle ───────────────────────────────────────────────────
const runtime = makeReactRuntime()
let registered
const styleTags = []
globalThis.window = { __ModuleLoader__: { load: (entry) => { registered = entry } } }
// A minimal DOM so the bundle's tagged-stylesheet guard can be observed.
globalThis.document = {
  head: { appendChild: (tag) => styleTags.push(tag) },
  createElement: () => ({ dataset: {}, textContent: '' }),
  querySelector: () => null,
}
const requireFn = (id) => {
  if (id === 'react') return runtime.React
  throw new Error(`unexpected require("${id}")`)
}
new Function('window', 'document', 'require', source)(globalThis.window, globalThis.document, requireFn)
const client = registered.factory(requireFn)

check('bundle registers under the package id', registered.id, 'dsh-skill-mcp-panel')
check('client inject declares slots, locale and settingsScope', client.inject, ['slots', 'locale', 'settingsScope'])
check('bundle injects exactly one stylesheet', styleTags.length, 1)
check('stylesheet carries both zh and en independent CSS once', styleTags[0].textContent.includes('.skn_card'), true)

// ── slot + locale + scope harness ─────────────────────────────────────────
function makeScope(initialValue, options = {}) {
  const listeners = new Set()
  const mutations = []
  let snapshot = {
    status: options.status ?? 'ready',
    value: initialValue,
    user: options.user,
    revision: 1,
    writable: options.writable !== false,
    mode: 'host',
  }
  const publish = () => {
    for (const listener of listeners) listener()
  }
  return {
    mutations,
    peek: () => snapshot,
    setValue(next, revision) {
      snapshot = { ...snapshot, value: next, revision }
      publish()
    },
    scope: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      mutate: async (ops) => {
        mutations.push(structuredClone(ops))
        snapshot = { ...snapshot, revision: snapshot.revision + 1 }
        publish()
      },
    },
  }
}

function collect(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, out)
    return out
  }
  if (predicate(node)) out.push(node)
  collect(node.props?.children, predicate, out)
  return out
}

const isType = (type) => (node) => node.type === type
const inputs = (tree, type) => collect(tree, isType('input')).filter((node) => node.props.type === type)
const buttons = (tree) => collect(tree, isType('button'))
const textarea = (tree) => collect(tree, isType('textarea'))[0]
const select = (tree) => collect(tree, isType('select'))[0]
const byLabel = (tree) => (text) => collect(tree, isType('label')).find((node) => node.props.children === text)

/** Locale registry stub: registers dictionaries and resolves per active locale. */
function makeLocale() {
  const dicts = new Map()
  let active = 'en'
  return {
    setActive(locale) {
      active = locale
    },
    get dictionaries() {
      return dicts
    },
    ctx: {
      bind: (ns) => (key) => {
        const entries = dicts.get(ns) ?? {}
        const dict = entries[active] ?? entries.en ?? {}
        return dict[key] ?? key
      },
      register: (ns, table) => {
        dicts.set(ns, table)
        return () => {}
      },
      subscribe: () => () => {},
      getSnapshot: () => ({ revision: 1 }),
    },
  }
}

/** Mount the card through ctx.slots.register exactly as the shell would. */
function mountCard(initialValue, options = {}) {
  runtime.reset()
  const harness = makeScope(initialValue, options)
  const locale = makeLocale()
  const captured = { component: undefined, registration: undefined, registrations: [] }

  // Capture the props the registration passes, by rendering through a wrapper
  // that records them. The wrapper is what the slot would render, so the card
  // under test still receives its real `t`, `form`, and `store`.
  let received
  const wrapper = (props) => {
    received = props
    return captured.component(props)
  }

  // The plugin now registers TWO slots: the settings card under
  // `settings.plugin.item` and the management page under `settings.plugins.tab`.
  // This harness captures the card by slot NAME rather than by registration
  // order, so adding another slot can never silently retarget these assertions
  // at the wrong component.
  const CARD_SLOT = "settings.plugin.item"
  client.apply({
    slots: {
      inject: (_key, callback) => callback(),
      register: (registration, component) => {
        if (registration.name === CARD_SLOT) {
          captured.registration = registration
          captured.component = component
        }
        captured.registrations.push(registration)
        return () => {}
      },
    },
    settingsScope: { bind: () => harness.scope },
    locale: locale.ctx,
    effect: (callback) => {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
  })
  if (captured.component === undefined) throw new Error(`the bundle registered no component for slot "${CARD_SLOT}"`)

  let tree
  const rerender = () => {
    received = undefined
    tree = runtime.renderRoot(runtime.React.createElement(wrapper, {}))
  }
  rerender()

  return {
    harness,
    locale,
    registrationLocale: captured.registration.locale,
    rerender,
    open() {
      // The header is the first button; opening is a user gesture.
      buttons(tree)[0].props.onClick()
      rerender()
    },
    /** The props the card actually received (t, form, store). */
    get props() {
      return received
    },
    get tree() {
      return tree
    },
  }
}

const BASE_VALUE = {
  providerName: 'nested-filesystem',
  roots: ['/home/sun/.agents/skills', '/home/sun/.hermes/skills'],
  maxDepth: 4,
  rank: 300,
  includeHidden: false,
  includeFlatRootFiles: true,
  watch: true,
  watchDebounceMs: 250,
  duplicatePolicy: 'first-wins',
}

// ── 1. collapsed by default, and the list item shape ──────────────────────
{
  const card = mountCard(BASE_VALUE)
  check('renders a list item, not a bare block', card.tree.type, 'li')
  check('starts collapsed', textarea(card.tree), undefined)
  check('header is a button with aria-expanded=false', buttons(card.tree)[0].props['aria-expanded'], false)
  check('header shows the localized title', collect(card.tree, isType('span')).some((n) => n.props.children === 'Skill nesting'), true)
  check('no controls are rendered while collapsed', collect(card.tree, isType('input')).length, 0)
}

// ── 2. expanding discloses the controls ───────────────────────────────────
{
  const card = mountCard(BASE_VALUE)
  card.open()
  check('expanded header reports aria-expanded=true', buttons(card.tree)[0].props['aria-expanded'], true)
  check('expanding reveals the roots textarea', collect(card.tree, isType('textarea')).length, 1)
  check('expanding reveals one checkbox per boolean field', inputs(card.tree, 'checkbox').length, 3)
  check('expanding reveals the policy select', collect(card.tree, isType('select')).length, 1)
  check('every control has an accessible label', collect(card.tree, isType('label')).length, 9)
}

// ── 3. Chinese locale is registered and resolved ───────────────────────────
{
  const card = mountCard(BASE_VALUE)
  const dicts = card.locale.dictionaries.get('skill-mcp-panel')
  check('registers both zh and en dictionaries', Object.keys(dicts).sort(), ['en', 'zh'])
  check('zh dictionary has the title', dicts.zh.title, '分层技能发现')
  check('en dictionary has the title', dicts.en.title, 'Skill nesting')
  check('zh covers every en key', Object.keys(dicts.en).every((key) => typeof dicts.zh[key] === 'string'), true)
  check('registration declares the locale namespace', card.registrationLocale, 'skill-mcp-panel')

  // Switch the active locale and confirm the rendered copy follows.
  card.locale.setActive('zh')
  card.rerender()
  check('zh title renders after switching locale', collect(card.tree, isType('span')).some((n) => n.props.children === '分层技能发现'), true)
  card.open()
  check('zh labels render for fields', byLabel(card.tree)('技能根目录') !== undefined, true)
}

// ── 4. Save sends ONLY the changed field ──────────────────────────────────
await (async () => {
  const card = mountCard(BASE_VALUE)
  card.open()
  const nextRoots = [...BASE_VALUE.roots, '/home/sun/.dsh/skills']
  textarea(card.tree).props.onChange({ target: { value: nextRoots.join('\n') } })
  card.rerender()
  const save = buttons(card.tree).find((b) => b.props.children === 'Save')
  check('Save enables once a field changes', save.props.disabled, false)
  await save.props.onClick()
  check('exactly one op is sent', card.harness.mutations.length, 1)
  check('the op is the single changed field', card.harness.mutations[0], [{ op: 'set', path: ['roots'], value: nextRoots }])
})()

// ── 5. Nothing changed means nothing written ─────────────────────────────
{
  const card = mountCard(BASE_VALUE)
  card.open()
  const save = buttons(card.tree).find((b) => b.props.children === 'Save')
  check('Save is disabled with no pending change', save.props.disabled, true)
  check('no mutation is issued', card.harness.mutations.length, 0)
}

// ── 6. Number fields write numbers; checkboxes write booleans ─────────────
await (async () => {
  const card = mountCard(BASE_VALUE)
  card.open()
  const numberInputs = inputs(card.tree, 'text').filter((n) => n.props.inputMode === 'numeric')
  check('renders one numeric input per number field', numberInputs.length, 3)
  numberInputs[0].props.onChange({ target: { value: '6' } })
  card.rerender()
  await buttons(card.tree).find((b) => b.props.children === 'Save').props.onClick()
  check('number field is sent as a number', card.harness.mutations[0], [{ op: 'set', path: ['maxDepth'], value: 6 }])

  const toggle = mountCard(BASE_VALUE)
  toggle.open()
  inputs(toggle.tree, 'checkbox')[0].props.onChange({ target: { checked: false } })
  toggle.rerender()
  await buttons(toggle.tree).find((b) => b.props.children === 'Save').props.onClick()
  check('checkbox is sent as a boolean', toggle.harness.mutations[0], [{ op: 'set', path: ['watch'], value: false }])
})()

// ── 7. Invalid input blocks Save and explains why ─────────────────────────
{
  const card = mountCard(BASE_VALUE)
  card.open()
  const depth = inputs(card.tree, 'text').find((n) => n.props.id === 'skill-mcp-panel-maxDepth')
  depth.props.onChange({ target: { value: '99' } })
  card.rerender()
  const save = buttons(card.tree).find((b) => b.props.children === 'Save')
  check('out-of-range depth disables Save', save.props.disabled, true)
  check('the field reports invalid', collect(card.tree, isType('p')).some((n) => n.props.children === 'Enter a whole number from 1 to 12.'), true)

  const empty = mountCard(BASE_VALUE)
  empty.open()
  inputs(empty.tree, 'text').find((n) => n.props.id === 'skill-mcp-panel-providerName').props.onChange({ target: { value: '  ' } })
  empty.rerender()
  check('empty provider name disables Save', buttons(empty.tree).find((b) => b.props.children === 'Save').props.disabled, true)
}

// ── 8. Discard drops the draft ────────────────────────────────────────────
{
  const card = mountCard(BASE_VALUE)
  card.open()
  textarea(card.tree).props.onChange({ target: { value: '/tmp/only' } })
  card.rerender()
  const discard = buttons(card.tree).find((b) => b.props.children === 'Discard changes')
  check('Discard enables with a pending change', discard.props.disabled, false)
  discard.props.onClick()
  card.rerender()
  check('Discard restores the resolved value', textarea(card.tree).props.value, BASE_VALUE.roots.join('\n'))
  check('Discard issues no write', card.harness.mutations.length, 0)
}

// ── 9. An "Unsaved" badge marks a pending edit ────────────────────────────
{
  const card = mountCard(BASE_VALUE)
  check('no badge while clean', collect(card.tree, isType('span')).some((n) => n.props.children === 'Unsaved'), false)
  card.open()
  textarea(card.tree).props.onChange({ target: { value: '/tmp/x' } })
  card.rerender()
  check('badge appears once dirty', collect(card.tree, isType('span')).some((n) => n.props.children === 'Unsaved'), true)
}

// ─ 10. Overridden badge and reset ────────────────────────────────────────
await (async () => {
  const card = mountCard(BASE_VALUE, { user: { maxDepth: 9 } })
  card.open()
  check('an overridden field shows its badge', collect(card.tree, isType('span')).some((n) => n.props.children === 'Overridden'), true)
  const reset = buttons(card.tree).find((b) => b.props.children === 'Reset')
  check('an overridden field offers Reset', reset !== undefined, true)
  reset.props.onClick()
  card.rerender()
  await buttons(card.tree).find((b) => b.props.children === 'Save').props.onClick()
  check('Reset writes an unset op', card.harness.mutations[0], [{ op: 'unset', path: ['maxDepth'] }])
})()

// ── 11. Read-only deployment disables every control ───────────────────────
{
  const card = mountCard(BASE_VALUE, { writable: false })
  card.open()
  check('read-only explains itself', collect(card.tree, isType('p')).some((n) => n.props.children === "This deployment's settings are read-only."), true)
  check('read-only disables the textarea', textarea(card.tree).props.disabled, true)
  check('read-only disables the select', select(card.tree).props.disabled, true)
  check('read-only disables every checkbox', inputs(card.tree, 'checkbox').every((n) => n.props.disabled === true), true)
  check('read-only disables Save', buttons(card.tree).find((b) => b.props.children === 'Save').props.disabled, true)
}

// ─ 12. An unserved namespace renders nothing at all ──────────────────────
{
  const card = mountCard(BASE_VALUE, { status: 'unavailable' })
  check('an unavailable namespace renders no card', card.tree, null)
}

// ── 13. An external revision does NOT clobber an in-progress draft ────────
// The shipped CardForm deliberately keeps staged edits when the Host documents a
// new revision: a concurrent write (another tab, or the card reopened elsewhere)
// must not silently discard what the user is typing. The draft survives, and
// untouched fields still read the NEW resolved value.
{
  const card = mountCard(BASE_VALUE)
  card.open()
  textarea(card.tree).props.onChange({ target: { value: '/tmp/scratch' } })
  card.rerender()
  card.harness.setValue({ ...BASE_VALUE, roots: ['/srv/skills'], maxDepth: 6 }, 99)
  card.rerender()
  check('an edited field keeps the user draft', textarea(card.tree).props.value, '/tmp/scratch')
  const depth = inputs(card.tree, 'text').find((n) => n.props.id === 'skill-mcp-panel-maxDepth')
  check('an untouched field follows the new Host value', depth.props.value, '6')
  check('the surviving draft still counts as pending', buttons(card.tree).find((b) => b.props.children === 'Save').props.disabled, false)
}

// ── 14. `roots` as a single string does not fake a pending edit ───────────
{
  const card = mountCard({ ...BASE_VALUE, roots: '/home/sun/.agents/skills' })
  card.open()
  check('string roots are normalised into the textarea', textarea(card.tree).props.value, '/home/sun/.agents/skills')
  check('string roots do not fake a pending edit', buttons(card.tree).find((b) => b.props.children === 'Save').props.disabled, true)
}

// ── 15. Angle brackets survive as literal text ────────────────────────────
{
  const card = mountCard(BASE_VALUE)
  card.open()
  const intro = collect(card.tree, isType('p')).map((n) => String(n.props.children)).join(' ')
  check('path placeholder survives as literal text', intro.includes('<root>/<category>/<skill>/SKILL.md'), true)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)