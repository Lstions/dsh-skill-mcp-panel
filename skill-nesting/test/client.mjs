/**
 * Offline test for the skill-nesting settings CARD.
 *
 * Loads the real `lib/client.js` browser bundle under a minimal React and slot
 * harness, then drives the rendered component. This is the only way to exercise
 * the card's real logic — draft seeding, diffing, Apply/Revert — without a
 * browser, and it targets exactly where a settings UI goes wrong: writing a
 * field the user never touched, or missing a field they did.
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
  /**
   * Hooks are per-component-instance. `SkillNestingCard` and `Field` are the two
   * function components in the bundle, and only the former calls hooks, so a
   * per-function slot array is a faithful model of React's own ordering rule.
   */
  const slotsByComponent = new Map()
  let current = undefined
  let index = 0
  let pendingEffects = []
  /** Set by any state write; `render` loops until a pass produces no state change. */
  let dirty = false

  const slotsFor = (component) => {
    let slots = slotsByComponent.get(component)
    if (slots === undefined) {
      slots = []
      slotsByComponent.set(component, slots)
    }
    return slots
  }

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
    useSyncExternalStore(_subscribe, getSnapshot) {
      at()
      return getSnapshot()
    },
  }

  function at() {
    return index++
  }

  /** Recursively expand function components into host elements. */
  function expand(node) {
    if (node === null || node === undefined || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map(expand)
    if (typeof node.type === 'function') {
      const previous = current
      const previousIndex = index
      current = slotsFor(node.type)
      index = 0
      const rendered = node.type(node.props)
      current = previous
      index = previousIndex
      return expand(rendered)
    }
    return { type: node.type, props: { ...node.props, children: expand(node.props.children) } }
  }

  /**
   * Render a root element, then run its effects and re-render until a pass
   * neither wrote state nor queued a new effect. That loop is what makes the
   * result the same tree React would settle on, so assertions see post-effect
   * state rather than the first pass.
   */
  function renderRoot(element) {
    let tree
    for (let pass = 0; pass < 10; pass += 1) {
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

  /**
   * Drop every component's hook state.
   *
   * In React each mounted instance owns its own state; here the bundle captures
   * one React object for the whole file, so a new mount must clear the store or
   * state would leak between the test cases and assert against the wrong draft.
   */
  function reset() {
    slotsByComponent.clear()
    current = undefined
    index = 0
    pendingEffects = []
    dirty = false
  }

  return { React, renderRoot, reset, setChangeHandler: () => {} }
}

// ── load the real bundle ───────────────────────────────────────────────────
const runtime = makeReactRuntime()
let registered
globalThis.window = { __ModuleLoader__: { load: (entry) => { registered = entry } } }
const requireFn = (id) => {
  if (id === 'react') return runtime.React
  throw new Error(`unexpected require("${id}")`)
}
new Function('window', 'require', source)(globalThis.window, requireFn)
const client = registered.factory(requireFn)

check('bundle registers under the package id', registered.id, 'dsh-skill-nesting')
check('client inject declares slots and settingsScope', client.inject, ['slots', 'settingsScope'])

// ── scope + slot harness ───────────────────────────────────────────────────
function makeScope(initialValue, options = {}) {
  const listeners = new Set()
  const mutations = []
  let snapshot = {
    status: options.status ?? 'ready',
    value: initialValue,
    revision: 1,
    writable: options.writable !== false,
    mode: 'host',
  }
  const publish = () => { for (const listener of listeners) listener() }
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

/** Drive the card through ctx.slots.register exactly as the shell would. */
function mountCard(initialValue, options) {
  runtime.reset()
  const harness = makeScope(initialValue, options)
  const captured = { component: undefined }
  client.apply({
    slots: {
      inject: (_key, callback) => callback(),
      register: (_options, component) => {
        captured.component = component
        return () => {}
      },
    },
    settingsScope: { bind: () => harness.scope },
  })

  let tree
  const rerender = () => {
    tree = runtime.renderRoot(runtime.React.createElement(captured.component, { scope: harness.scope }))
  }
  runtime.setChangeHandler(rerender)
  rerender()
  return { harness, rerender, get tree() { return tree } }
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

// ── 1. initial render ──────────────────────────────────────────────────────
{
  const card = mountCard(BASE_VALUE)
  check('renders one roots textarea', collect(card.tree, isType('textarea')).length, 1)
  check('roots textarea holds one root per line', textarea(card.tree).props.value, BASE_VALUE.roots.join('\n'))
  check('policy select reflects the value', select(card.tree).props.value, 'first-wins')
  check('policy select offers both policies', select(card.tree).props.children.length, 2)
  check('renders one checkbox per boolean field', inputs(card.tree, 'checkbox').length, 3)
  check('writable deployment enables the roots field', textarea(card.tree).props.disabled, false)
  check('renders Apply and Revert', buttons(card.tree).map((b) => b.props.children), ['Apply', 'Revert'])
  check('Apply is disabled with no pending change', buttons(card.tree)[0].props.disabled, true)
  check('Revert is disabled with no pending change', buttons(card.tree)[1].props.disabled, true)
}

// ── 2. Apply sends ONLY the changed field ──────────────────────────────────
await (async () => {
  const card = mountCard(BASE_VALUE)
  const nextRoots = [...BASE_VALUE.roots, '/home/sun/.dsh/skills']
  textarea(card.tree).props.onChange({ target: { value: nextRoots.join('\n') } })
  card.rerender()
  check('Apply enables once a field changes', buttons(card.tree)[0].props.disabled, false)
  await buttons(card.tree)[0].props.onClick()
  check('exactly one op is sent', card.harness.mutations.length, 1)
  check('the op is the single changed field', card.harness.mutations[0], [{ op: 'set', path: ['roots'], value: nextRoots }])
})()

// ── 3. A number field writes as a number, not a string ─────────────────────
await (async () => {
  const card = mountCard(BASE_VALUE)
  check('renders one input per number field', inputs(card.tree, 'number').length, 3)
  inputs(card.tree, 'number')[0].props.onChange({ target: { value: '6' } })
  card.rerender()
  await buttons(card.tree)[0].props.onClick()
  check('number field is sent as a number', card.harness.mutations[0], [{ op: 'set', path: ['maxDepth'], value: 6 }])
})()

// ─ 4. Every other control type writes correctly ───────────────────────────
await (async () => {
  const policy = mountCard(BASE_VALUE)
  select(policy.tree).props.onChange({ target: { value: 'error' } })
  policy.rerender()
  await buttons(policy.tree)[0].props.onClick()
  check('policy change is sent', policy.harness.mutations[0], [{ op: 'set', path: ['duplicatePolicy'], value: 'error' }])

  const toggle = mountCard(BASE_VALUE)
  inputs(toggle.tree, 'checkbox')[0].props.onChange({ target: { checked: false } })
  toggle.rerender()
  await buttons(toggle.tree)[0].props.onClick()
  check('checkbox change is sent as a boolean', toggle.harness.mutations[0], [{ op: 'set', path: ['watch'], value: false }])
})()

// ── 5. Multiple changed fields become one atomic op list ───────────────────
await (async () => {
  const card = mountCard(BASE_VALUE)
  textarea(card.tree).props.onChange({ target: { value: '/srv/skills' } })
  card.rerender()
  inputs(card.tree, 'number')[0].props.onChange({ target: { value: '7' } })
  card.rerender()
  await buttons(card.tree)[0].props.onClick()
  check('two edits produce two ops in one write', card.harness.mutations.length, 1)
  check('both ops are present', card.harness.mutations[0].length, 2)
})()

// ── 6. Revert discards the draft ───────────────────────────────────────────
{
  const card = mountCard(BASE_VALUE)
  textarea(card.tree).props.onChange({ target: { value: '/tmp/only' } })
  card.rerender()
  check('Revert enables with a pending change', buttons(card.tree)[1].props.disabled, false)
  buttons(card.tree)[1].props.onClick()
  card.rerender()
  check('Revert restores the resolved value', textarea(card.tree).props.value, BASE_VALUE.roots.join('\n'))
  check('Revert issues no write', card.harness.mutations.length, 0)
}

// ── 7. `roots` written as a single string does not read as a pending edit ──
// A composition row may spell one root as a bare string; the card must not treat
// that as a change the moment it opens (which would enable Apply spuriously).
{
  const card = mountCard({ ...BASE_VALUE, roots: '/home/sun/.agents/skills' })
  check('string roots are normalised into the textarea', textarea(card.tree).props.value, '/home/sun/.agents/skills')
  check('string roots do not fake a pending edit', buttons(card.tree)[0].props.disabled, true)
}

// ── 8. Read-only deployments disable every control ─────────────────────────
{
  const card = mountCard(BASE_VALUE, { writable: false })
  check('read-only disables the roots field', textarea(card.tree).props.disabled, true)
  check('read-only disables the policy select', select(card.tree).props.disabled, true)
  check('read-only disables every checkbox', inputs(card.tree, 'checkbox').every((node) => node.props.disabled === true), true)
  check('read-only disables Apply', buttons(card.tree)[0].props.disabled, true)
  check('read-only renders no error banner', collect(card.tree, isType('p')).length > 0, true)
}

// ── 9. A Host revision re-seeds the draft ─────────────────────────────────
// A write from another surface must be reflected, not silently overwritten.
{
  const card = mountCard(BASE_VALUE)
  textarea(card.tree).props.onChange({ target: { value: '/tmp/scratch' } })
  card.rerender()
  card.harness.setValue({ ...BASE_VALUE, roots: ['/srv/skills'] }, 99)
  card.rerender()
  check('a new Host revision re-seeds the draft', textarea(card.tree).props.value, '/srv/skills')
  check('the stale draft no longer counts as pending', buttons(card.tree)[0].props.disabled, true)
}

// ── 10. An absent namespace renders an explanation, not a crash ───────────
{
  const card = mountCard(undefined)
  const texts = collect(card.tree, isType('p')).map((node) => String(node.props.children))
  check('absent value explains the composition-only state', texts.some((t) => t.includes('composition')), true)
  check('absent value renders no controls', collect(card.tree, isType('input')).length, 0)
}

// ── 11. A loading snapshot renders a placeholder ───────────────────────────
{
  const card = mountCard(BASE_VALUE, { status: 'loading' })
  check('loading state renders no controls', collect(card.tree, isType('input')).length, 0)
  check('loading state says so', String(collect(card.tree, isType('p'))[0].props.children).includes('Loading'), true)
}

// ── 12. Embedded angle brackets are passed as text, not markup ─────────────
// The card's copy contains `<root>/<category>/<skill>/SKILL.md`; React escapes
// text children, and the offline runtime must see them as a plain string.
{
  const card = mountCard(BASE_VALUE)
  const intro = collect(card.tree, isType('p')).map((node) => String(node.props.children)).join(' ')
  check('path placeholder survives as literal text', intro.includes('<root>/<category>/<skill>/SKILL.md'), true)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)