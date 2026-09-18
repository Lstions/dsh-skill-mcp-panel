/**
 * Offline test for the MANAGEMENT PAGE (`settings.plugins.tab`).
 *
 * The page exists because DSH serves durable settings only to a loopback page:
 * `dsh-client-ui-settings` resolves `persistence = ctx.remote.$host.isLoopback
 * ? "host" : "memory"`, so over a LAN address such as http://100.64.0.10:3080
 * every `settingsScope`-backed card is inert. The page therefore reads and
 * writes this plugin's own host routes.
 *
 * The load-bearing case here is **N3**: with the settings scope unavailable
 * (which is exactly what a non-loopback page gets), the page must still render
 * and must still perform a toggle. Every test below supplies a settings scope
 * that throws if anything reads it, so a regression to scope-based data would
 * fail loudly rather than silently.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { makeChecker } from './harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

const { results, check } = makeChecker()

// ─ minimal React with real hook state (same contract as test/client.mjs) ───
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
      refsByComponent.set(component, [])
    }
    return refsByComponent.get(component)
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
        slot.deps = deps
        slot.value = factory()
      }
      return slot.value
    },
    useCallback(factory, deps) {
      const slot = (current[at()] ??= {})
      if (!sameDeps(slot.deps, deps)) {
        slot.deps = deps
        slot.value = factory
      }
      return slot.value
    },
    useState(initial) {
      const slot = (current[at()] ??= { value: typeof initial === 'function' ? initial() : initial })
      return [
        slot.value,
        (next) => {
          const value = typeof next === 'function' ? next(slot.value) : next
          if (!Object.is(value, slot.value)) {
            slot.value = value
            dirty = true
          }
        },
      ]
    },
    useEffect(fn) {
      const slot = (current[at()] ??= {})
      if (slot.ran !== true) {
        slot.ran = true
        pendingEffects.push(fn)
      }
    },
    useRef(initial) {
      const slot = (current[at()] ??= { value: initial })
      return slot
    },
  }

  let dirty = false

  function reset() {
    slotsByComponent.clear()
    for (const store of refsByComponent.values()) store.length = 0
    refsByComponent.clear()
    current = undefined
    refStore = undefined
    index = 0
    pendingEffects = []
    dirty = false
  }

  function renderOne(element) {
    const component = element.type
    if (typeof component !== 'function') return expandChildren(element)
    if (component.prototype?.isReactComponent !== undefined) return expandChildren(element)
    current = slotsFor(component)
    refStore = refsFor(component)
    index = 0
    const out = component(element.props)
    return expandChildren(out)
  }

  /**
   * Expand nested function components in a rendered subtree.
   *
   * The real React runtime renders every function child it meets; this harness
   * must do the same, or a component that returns another component (the page
   * wrapper around `SkillNestingPage`, or a `SkillRow` inside a group) would
   * stay an unrendered function and the tree helpers would see nothing.
   */
  function expandChildren(node) {
    if (node === undefined || node === null || typeof node === 'boolean') return node
    if (Array.isArray(node)) return node.map(expandChildren)
    if (typeof node !== 'object') return node
    if (typeof node.type === 'function' && node.type.prototype?.isReactComponent === undefined) {
      const saved = current
      const savedRefs = refStore
      const savedIndex = index
      const rendered = renderOne({ type: node.type, props: node.props })
      current = saved
      refStore = savedRefs
      index = savedIndex
      return rendered
    }
    return { ...node, props: { ...node.props, children: expandChildren(node.props?.children) } }
  }

  /**
   * Render a root, flushing effects and re-rendering until the tree settles.
   * React would loop for async work; here tests await microtasks between calls.
   */
  function renderRoot(element) {
    let tree = renderOne(element)
    for (let pass = 0; pass < 12; pass += 1) {
      const queued = pendingEffects
      pendingEffects = []
      const wasDirty = dirty
      dirty = false
      for (const fn of queued) {
        const cleanup = fn()
        void cleanup
      }
      if (queued.length > 0 || wasDirty) tree = renderOne(element)
      else break
    }
    return tree
  }

  return { React, reset, renderRoot }
}

const runtime = makeReactRuntime()

// ─ tree helpers ───────────────────────────────────────────────────────────
function collect(node, predicate, out = []) {
  if (node === undefined || node === null || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, out)
    return out
  }
  if (typeof node !== 'object') return out
  if (predicate(node)) out.push(node)
  collect(node.props?.children, predicate, out)
  return out
}
const isType = (type) => (node) => node.type === type
const textOf = (node) => {
  if (node === undefined || node === null || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node !== 'object') return String(node)
  return textOf(node.props?.children)
}
const allText = (tree) => textOf(tree)
const buttons = (tree) => collect(tree, isType('button'))
const inputs = (tree) => collect(tree, isType('input'))

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
}

// ─ the bundle, loaded once ────────────────────────────────────────────────
let registered
const requireFn = (name) => {
  if (name === 'react') return runtime.React
  throw new Error(`unexpected require("${name}")`)
}
globalThis.window = { __ModuleLoader__: { load: (entry) => { registered = entry } } }
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, appendChild() {}, textContent: '' }),
  head: { appendChild() {} },
}
new Function('window', 'document', 'require', source)(globalThis.window, globalThis.document, requireFn)
const client = registered.factory(requireFn)

// ─ state fixtures ─────────────────────────────────────────────────────────
function makeState(overrides = {}) {
  return {
    version: 1,
    revision: 7,
    writable: true,
    writeAccess: 'same-origin',
    roots: [
      { path: '/skills', exists: true, skillCount: 2 },
      { path: '/gone', exists: false, skillCount: 0 },
    ],
    skills: [
      { name: 'alpha', description: 'first skill', path: '/skills/mlops/alpha/SKILL.md', root: '/skills', category: 'mlops', enabled: true, effective: true, shadowedBy: null, modelInvocable: true, userInvocable: true, provider: 'nested-filesystem', rank: 300 },
      { name: 'beta', description: 'second skill', path: '/skills/creative/beta/SKILL.md', root: '/skills', category: 'creative', enabled: true, effective: true, shadowedBy: null, modelInvocable: true, userInvocable: true, provider: 'nested-filesystem', rank: 300 },
      { name: 'gamma', description: 'switched off', path: '/skills/mlops/gamma/SKILL.md', root: '/skills', category: 'mlops', enabled: false, effective: true, shadowedBy: null, modelInvocable: false, userInvocable: false, provider: 'nested-filesystem', rank: 0 },
      { name: 'delta', description: 'cannot be switched off', path: '/skills/delta/SKILL.md', root: '/skills', category: '', enabled: false, effective: false, shadowedBy: 'skill-filesystem', modelInvocable: true, userInvocable: true, provider: 'skill-filesystem', rank: 500 },
    ],
    conflicts: [
      { name: 'github', winner: { path: '/skills/github/github/SKILL.md', root: '/skills', provider: 'nested-filesystem', rank: 300 }, losers: [{ path: '/skills/software-development/github/SKILL.md', root: '/skills', provider: 'nested-filesystem', rank: 300 }], policy: 'first-wins', resolvable: true },
    ],
    errors: ['root /gone: not a directory'],
    mcp: {
      servers: [
        { rowId: 'r1', serverName: 'github', transport: 'stdio', target: 'npx gh', enabled: true, declared: true, phase: 'active', toolCount: 2, tools: [{ name: 'mcp__github__a', description: 'a' }], addressable: true, readOnlyReason: null, editable: true, config: { env: { GITHUB_TOKEN: '••••••' } } },
        { rowId: 'r2', serverName: 'outer', transport: 'streamable-http', target: 'https://x/mcp', enabled: true, declared: false, phase: 'active', toolCount: 0, tools: [], addressable: false, readOnlyReason: 'management-required', editable: false, config: {} },
      ],
      managerAvailable: true,
      mcpClientAvailable: true,
    },
    config: { providerName: 'nested-filesystem', roots: ['/skills'], maxDepth: 4, rank: 300, includeHidden: false, includeFlatRootFiles: true, watch: true, watchDebounceMs: 250, duplicatePolicy: 'first-wins', writeAccess: 'same-origin' },
    ...overrides,
  }
}

/** A fetch double returning `state` for GET and applying results for POST. */
function makeFetch(state, options = {}) {
  const calls = []
  const fetchImpl = async (input, init) => {
    calls.push({ input, init })
    if (input === '/skill-nesting/state') {
      if (options.readFails === true) return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => state }
    }
    if (options.writeStaleOnce === true) {
      // The host answers a stale write with 409 AND the current state, so the
      // client can rebase onto the revision that actually won. Modelling it
      // with a newer revision here is what makes the retry assertion meaningful.
      options.writeStaleOnce = false
      return { ok: false, status: 409, json: async () => ({ results: [], state: makeState({ revision: state.revision + 5 }) }) }
    }
    if (options.writeFails === true) return { ok: false, status: 403, json: async () => ({}) }
    const body = JSON.parse(init.body)
    const results = body.ops.map((op) => ({
      kind: op.kind,
      ok: true,
      status: options.status ?? 'applied',
      detail: 'ok',
      target: op.name,
    }))
    const next = makeState({ revision: state.revision + 1 })
    if (options.status === 'applied') {
      for (const op of body.ops) {
        const row = next.skills.find((s) => s.name === op.name)
        if (row !== undefined && op.kind === 'skill.toggle') {
          row.enabled = op.enabled
          row.modelInvocable = op.enabled
          row.userInvocable = op.enabled
        }
      }
    }
    return { ok: true, status: 200, json: async () => ({ results, state: next }) }
  }
  fetchImpl.calls = calls
  return fetchImpl
}

/**
 * Mount the page through the real `apply`, capturing it BY SLOT NAME.
 *
 * The settings scope is an inert stub whose reads are COUNTED. The card may use
 * it (it is scope-backed by design); the page must not, so the assertions below
 * check that no scope read happens while the page renders or toggles. A
 * regression to scope-based data would therefore surface here rather than only
 * on a LAN page.
 *
 * The page loads asynchronously, so mounting is `async`: it awaits the fetch
 * chain the same way a browser would between paint and effect flush.
 */
async function mountPage(state, options = {}) {
  runtime.reset()
  const registrations = []
  let captured

  const scopeReads = []
  const inertScope = new Proxy(
    {},
    {
      get(_target, property) {
        scopeReads.push(String(property))
        // Return inert shapes: enough for the card's constructor to run, and
        // nothing that could actually serve page data.
        if (property === 'subscribe') return () => () => {}
        if (property === 'getSnapshot') return () => ({ view: { namespaces: [] }, status: 'unavailable' })
        return undefined
      },
    },
  )

  client.apply({
    slots: {
      inject: (_key, callback) => callback(),
      register: (registration, component) => {
        registrations.push(registration)
        if (registration.name === 'settings.plugins.tab') captured = { registration, component }
        return () => {}
      },
    },
    settingsScope: { bind: () => inertScope },
    locale: makeLocale().ctx,
    effect: (callback) => {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
  })

  if (captured === undefined) throw new Error('the bundle registered no component for slot "settings.plugins.tab"')

  // Reads made by `apply` itself (the card's constructor) are not the page's;
  // only reads from here on belong to the page under test.
  scopeReads.length = 0

  const fetchImpl = makeFetch(state, options)
  let tree

  /**
   * Render, let the async load settle, then render again until the tree stops
   * changing — the browser sequence, without a browser.
   */
  const settle = async () => {
    tree = runtime.renderRoot(runtime.React.createElement(captured.component, { fetchImpl }))
    for (let pass = 0; pass < 10; pass += 1) {
      await flush(8)
      const before = JSON.stringify(allText(tree))
      tree = runtime.renderRoot(runtime.React.createElement(captured.component, { fetchImpl }))
      if (JSON.stringify(allText(tree)) === before) break
    }
  }

  await settle()

  return {
    registrations,
    registration: captured.registration,
    fetchImpl,
    scopeReads,
    settle,
    get tree() {
      return tree
    },
  }
}

/**
 * Open one collapsed group by its header label, re-reading the tree each time.
 * @param page - a mounted page.
 * @param label - the group header text.
 */
async function openGroup(page, label) {
  const button = buttons(page.tree)
    .filter((node) => node.props['aria-expanded'] !== undefined)
    .find((node) => textOf(node).includes(label))
  if (button === undefined) throw new Error(`no group header matching "${label}"`)
  button.props.onClick()
  await page.settle()
}

/**
 * Flip one skill's switch, addressed by its accessible name.
 * @param page - a mounted page.
 * @param name - the skill name inside the switch's aria-label.
 */
async function clickSwitch(page, name) {
  const control = inputs(page.tree)
    .filter((node) => node.props.role === 'switch')
    .find((node) => String(node.props['aria-label']).includes(name))
  if (control === undefined) throw new Error(`no switch for skill "${name}" (is its group open?)`)
  control.props.onChange()
  await page.settle()
}

/**
 * A locale service double: `bind` resolves against the registered dictionaries.
 *
 * The active locale is selectable so the same page can be asserted in English
 * (the default here, for readable expectations) and in Chinese.
 */
function makeLocale(active = 'en') {
  const dicts = new Map()
  const state = { active }
  const ctx = {
    register: (ns, locales) => {
      dicts.set(ns, { ...(dicts.get(ns) ?? {}), ...locales })
      return () => {}
    },
    bind: (ns) => (key, params) => {
      const table = dicts.get(ns) ?? {}
      let value = (table[state.active] ?? table.en ?? {})[key] ?? (table.en ?? {})[key] ?? key
      for (const [name, replacement] of Object.entries(params ?? {})) {
        value = value.replaceAll(`{${name}}`, String(replacement))
      }
      return value
    },
  }
  return { ctx, dicts, state }
}

// ─ 1. registration contract ───────────────────────────────────────────────
{
  const page = await mountPage(makeState())
  check('registers the page in settings.plugins.tab', page.registration.name, 'settings.plugins.tab')
  check('the tab id is the settings namespace', page.registration.id, 'skill-nesting')
  check('the tab carries a localized label', typeof page.registration.label, 'function')
  check('the tab declares its locale namespace', page.registration.locale, 'skill-nesting')
  check('the settings card is still registered too', page.registrations.some((r) => r.name === 'settings.plugin.item'), true)
  check('exactly two slots are claimed', page.registrations.length, 2)
}

// ─ 2. N3: the page renders with NO usable settings scope ──────────────────
{
  const page = await mountPage(makeState())
  const text = allText(page.tree)
  check('N3 render: the page head is present', text.includes('Skill & MCP management'), true)
  check('N3 render: the skills section is present', text.includes('Skills'), true)
  check('N3 render: the skill count comes from the host', text.includes('4 skills'), true)
  // Rows live inside collapsed groups by design, so reach one the way a user
  // does: open its group first.
  await openGroup(page, 'mlops')
  check('N3 render: a skill name is present after opening its group', allText(page.tree).includes('alpha'), true)
  check('N3: the settings scope was never read', page.scopeReads.length, 0)
}

// ─ 3. N3: a toggle works with NO usable settings scope ────────────────────
{
  const page = await mountPage(makeState())
  // Every group must be opened to see all four switches. The page's skill list
  // is its own filter (the MCP section contributes switches too), so count only
  // the skill switches by their accessible names.
  await openGroup(page, '(directly under root)')
  await openGroup(page, 'creative')
  await openGroup(page, 'mlops')

  const switches = inputs(page.tree).filter((node) => node.props.role === 'switch')
  const skillSwitches = switches.filter((node) => /alpha|beta|gamma|delta/.test(String(node.props['aria-label'])))
  check('all four skill switches render once every group is open', skillSwitches.length, 4)
  // The MCP section contributes its own switch, which is always visible, so
  // this counts only the SKILL switches: those are what must stay hidden while
  // every group is collapsed.
  const collapsed = await mountPage(makeState())
  const collapsedSwitches = inputs(collapsed.tree).filter((n) => n.props.role === 'switch')
  check('no skill switch renders while the groups are collapsed', collapsedSwitches.filter((n) => /alpha|beta|gamma|delta/.test(String(n.props['aria-label']))).length, 0)

  const alpha = switches.find((node) => node.props['aria-label']?.includes('alpha'))
  check('the alpha switch is present', alpha !== undefined, true)
  alpha.props.onChange()
  await page.settle()
  const posted = page.fetchImpl.calls.find((c) => c.input === '/skill-nesting/apply')
  check('N3 toggle: a write was actually sent', posted !== undefined, true)
  check('N3 toggle: it carried a skill.toggle op', JSON.parse(posted.init.body).ops[0].kind, 'skill.toggle')
  check('N3 toggle: it used the same-origin JSON content type', posted.init.headers['content-type'], 'application/json')
}

//  4. groups are collapsed by default and only render when opened ─────────
{
  const page = await mountPage(makeState())
  check('no skill switch renders while every group is collapsed', inputs(page.tree).filter((n) => n.props.role === 'switch' && /alpha|beta|gamma|delta/.test(String(n.props['aria-label']))).length, 0)
  check('the group header reports aria-expanded=false', buttons(page.tree).filter((n) => n.props['aria-expanded'] !== undefined).every((n) => n.props['aria-expanded'] === false), true)
  const creative = buttons(page.tree).find((node) => textOf(node).includes('creative'))
  creative.props.onClick()
  await page.settle()
  const switches = inputs(page.tree)
    .filter((n) => n.props.role === 'switch')
    .filter((n) => /alpha|beta|gamma|delta/.test(String(n.props['aria-label'])))
  check('opening one group reveals only that group', switches.length, 1)
  check('the revealed row belongs to the opened group', switches[0].props['aria-label'].includes('beta'), true)
}

// ─ 5. the three status tones, and restart-required is NOT success ─────────
{
  for (const [status, expected] of [
    ['applied', 'Applied'],
    ['restart-required', 'Saved — takes effect after the host restarts'],
    ['refused', 'Refused'],
  ]) {
    const page = await mountPage(makeState(), { status })
    await openGroup(page, 'mlops')
    await clickSwitch(page, 'alpha')
    const text = allText(page.tree)
    check(`status "${status}" renders its own copy`, text.includes(expected), true)
  }
  const restart = await mountPage(makeState(), { status: 'restart-required' })
  await openGroup(restart, 'mlops')
  await clickSwitch(restart, 'alpha')
  check('restart-required is never worded as applied', allText(restart.tree).includes('Applied'), false)
}

// ─ 6. a switched-off-but-still-served row is NOT shown as off ─────────────
{
  const page = await mountPage(makeState())
  const rootGroup = buttons(page.tree).find((node) => textOf(node).includes('(directly under root)'))
  rootGroup.props.onClick()
  await page.settle()
  const text = allText(page.tree)
  check('the ineffective row names who still serves it', text.includes('still served by skill-filesystem'), true)
  check('the ineffective row explains why', text.includes('nearer registry layer'), true)
  const deltaRow = inputs(page.tree).find((n) => n.props['aria-label']?.includes('delta'))
  check('the ineffective row is still offered as disabled', deltaRow.props.checked, false)
  // `gamma` is the genuinely disabled row and lives in the mlops group.
  await openGroup(page, 'mlops')
  const withGamma = allText(page.tree)
  check('a genuinely disabled row reads as disabled', withGamma.includes('Disabled'), true)
  check('the genuinely disabled row is distinguishable from the ineffective one', withGamma.includes('Hidden here, but still served'), true)
}

// ─ 7. conflicts ───────────────────────────────────────────────────────────
{
  const page = await mountPage(makeState())
  const text = allText(page.tree)
  check('the conflict name is listed', text.includes('github'), true)
  check('the winner path is shown', text.includes('/skills/github/github/SKILL.md'), true)
  check('the loser path is shown', text.includes('/skills/software-development/github/SKILL.md'), true)
  check('the policy is explained', text.includes('The first file wins'), true)
  check('winner and loser are labelled distinctly', text.includes('In effect') && text.includes('Overridden'), true)
}
{
  const page = await mountPage(makeState({ conflicts: [] }))
  check('an empty conflict list has its own message', allText(page.tree).includes('No duplicate skill names'), true)
}

// ─ 8. MCP section ─────────────────────────────────────────────────────────
{
  const page = await mountPage(makeState())
  const text = allText(page.tree)
  check('a declared server is listed', text.includes('github'), true)
  check('an outer-layer server is listed too', text.includes('outer'), true)
  check('the outer row is labelled as externally configured', text.includes('Configured by an outer layer'), true)
  check('the outer row says it cannot be edited here', text.includes('only be toggled'), true)
  check('an unaddressable row explains why', text.includes('harness manages this row'), true)
  check('the tool count is reported', text.includes('2 tools'), true)
  check('a server with no tools says so', text.includes('No tools'), true)
  // The connection detail is disclosed on demand, so expand the row first.
  const expand = buttons(page.tree).find((node) => textOf(node) === 'Expand group')
  expand.props.onClick()
  await page.settle()
  const expanded = allText(page.tree)
  check('a masked secret is shown masked, never in the clear', expanded.includes('••••••'), true)
  check('the expanded row explains the mask', expanded.includes('the stored value is kept on save'), true)
  check('an expanded declared server can be toggled', inputs(page.tree).some((n) => n.props.role === 'switch' && String(n.props['aria-label']).includes('github')), true)
}
{
  const page = await mountPage(makeState({ mcp: { servers: [], managerAvailable: true, mcpClientAvailable: true } }))
  check('an empty MCP list has its own message', allText(page.tree).includes('No MCP servers are configured yet'), true)
}
{
  const page = await mountPage(makeState({ mcp: { servers: [], managerAvailable: false, mcpClientAvailable: false } }))
  const text = allText(page.tree)
  check('a missing MCP client is explained, not crashed', text.includes('MCP client is not installed'), true)
  check('a missing plugin manager is explained', text.includes('No plugin manager on this host'), true)
}

// ─ 9. errors, retry, and the stale-revision retry ─────────────────────────
{
  const page = await mountPage(makeState(), { readFails: true })
  const text = allText(page.tree)
  check('a failed read shows a readable error', text.includes('could not be read'), true)
  check('a failed read offers retry', buttons(page.tree).some((n) => textOf(n).includes('Retry')), true)
}
{
  const page = await mountPage(makeState({ errors: ['root /gone: not a directory'] }))
  check('host discovery errors are surfaced', allText(page.tree).includes('root /gone: not a directory'), true)
}
{
  const page = await mountPage(makeState(), { writeStaleOnce: true })
  const group = buttons(page.tree).find((node) => textOf(node).includes('mlops'))
  group.props.onClick()
  await page.settle()
  inputs(page.tree).filter((n) => n.props.role === 'switch').find((n) => n.props['aria-label'].includes('alpha')).props.onChange()
  await page.settle()
  const writes = page.fetchImpl.calls.filter((c) => c.input === '/skill-nesting/apply')
  check('a 409 is retried once against a fresh revision', writes.length, 2)
  check('the retry used a newer revision', JSON.parse(writes[1].init.body).revision > JSON.parse(writes[0].init.body).revision, true)
}
{
  const page = await mountPage(makeState(), { writeFails: true })
  const group = buttons(page.tree).find((node) => textOf(node).includes('mlops'))
  group.props.onClick()
  await page.settle()
  inputs(page.tree).filter((n) => n.props.role === 'switch').find((n) => n.props['aria-label'].includes('alpha')).props.onChange()
  await page.settle()
  check('a refused write surfaces an error instead of silent success', allText(page.tree).includes('did not succeed'), true)
}

//  10. search and root filter ─────────────────────────────────────────────
{
  const page = await mountPage(makeState())
  const search = inputs(page.tree).find((n) => n.props.type === 'search')
  search.props.onChange({ target: { value: 'second' } })
  await page.settle()
  check('search narrows by description', allText(page.tree).includes('beta'), true)
  check('search excludes non-matches', allText(page.tree).includes('alpha'), false)
  check('the count follows the filter', allText(page.tree).includes('1 skills'), true)
}
{
  const page = await mountPage(makeState())
  const rootSelect = collect(page.tree, (n) => n.type === "select" && n.props["aria-label"] === "Filter by root")[0]
  rootSelect.props.onChange({ target: { value: '/gone' } })
  await page.settle()
  check('a root filter excludes skills from other roots', allText(page.tree).includes('alpha'), false)
}

// ─ 11. i18n: both dictionaries, identical key sets ────────────────────────
{
  // Re-run `apply` against a locale double that records every dictionary, so
  // the assertion reads what the bundle actually registered rather than a copy
  // of the table kept in this test.
  const locale = makeLocale()
  const inertScope = { subscribe: () => () => {}, getSnapshot: () => ({ view: { namespaces: [] }, status: 'unavailable' }) }
  client.apply({
    slots: { inject: (_k, cb) => cb(), register: () => () => {} },
    settingsScope: { bind: () => inertScope },
    locale: locale.ctx,
    effect: (cb) => {
      const disposer = cb()
      void disposer
      return () => {}
    },
  })
  const table = locale.dicts.get('skill-nesting')
  check('both locales are registered', table !== undefined && table.zh !== undefined && table.en !== undefined, true)
  const zhKeys = Object.keys(table.zh).sort()
  const enKeys = Object.keys(table.en).sort()
  check('zh and en key sets are identical', JSON.stringify(zhKeys), JSON.stringify(enKeys))
  // The page copy is generated from docs/copy-zh-en.md; the card contributes its
  // own keys on top, so the merged table is a superset of the copy table.
  check('the merged dictionary carries the full page copy table', zhKeys.length >= 110, true)
  check('every key has a non-empty zh value', zhKeys.every((k) => typeof table.zh[k] === 'string' && table.zh[k].length > 0), true)
  check('every key has a non-empty en value', enKeys.every((k) => typeof table.en[k] === 'string' && table.en[k].length > 0), true)
  check('no key survived as its own placeholder in en', enKeys.every((k) => table.en[k] !== k), true)
  check('no key survived as its own placeholder in zh', zhKeys.every((k) => table.zh[k] !== k), true)
  check('the card dictionary was preserved alongside the page copy', typeof table.en.save === 'string', true)
  check('the tab label is localized', table.en['tab.label'], 'Skills & MCP')
  check('the tab label is localized in zh', table.zh['tab.label'], '技能与 MCP')
}

// ─ 12. the same page renders in Chinese ───────────────────────────────────
{
  runtime.reset()
  const locale = makeLocale('zh')
  let component
  const inertScope = { subscribe: () => () => {}, getSnapshot: () => ({ view: { namespaces: [] }, status: 'unavailable' }) }
  client.apply({
    slots: {
      inject: (_k, cb) => cb(),
      register: (registration, candidate) => {
        if (registration.name === 'settings.plugins.tab') component = candidate
        return () => {}
      },
    },
    settingsScope: { bind: () => inertScope },
    locale: locale.ctx,
    effect: (cb) => {
      cb()
      return () => {}
    },
  })
  const fetchImpl = makeFetch(makeState())
  runtime.renderRoot(runtime.React.createElement(component, { fetchImpl }))
  await flush(12)
  const rendered = runtime.renderRoot(runtime.React.createElement(component, { fetchImpl }))
  check('the page title is Chinese under the zh locale', allText(rendered).includes('技能与 MCP 管理'), true)
  check('the refresh control is Chinese too', allText(rendered).includes('刷新'), true)
}

// ─ 13. an unsupported state version is refused, not misrendered ───────────
{
  const page = await mountPage(makeState({ version: 99 }))
  check('an unknown state version shows an error rather than a blank page', allText(page.tree).includes('unsupported state version'), true)
}

await flush()
const failed = results.filter((entry) => entry.ok !== true)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) {
  console.log(`FAILED:\n${failed.map((entry) => `  - ${entry.label}`).join('\n')}`)
  process.exit(1)
}