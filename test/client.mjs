/**
 * Offline contract test for the skill-mcp-panel CLIENT bundle.
 *
 * WHY THIS FILE CHANGED
 *
 * It used to drive the settings CARD: it captured the component registered into
 * `settings.plugin.item`, rendered it under a stub `settingsScope`, and asserted
 * collapsed-by-default disclosure, diff-based writes and per-field validation.
 *
 * All three of those things are gone from the host in 0.1.7:
 *
 *   - `settings.plugin.item` is no longer a slot. The Plugins page keeps only
 *     `settings.plugins.tab`, so a card registration lands nowhere.
 *   - `settingsScope` is no longer a client service, and DECLARING it in the
 *     bundle's `inject` left the entire entry pending — the host reports
 *     "1 entry did not activate — waiting for service: settingsScope" and the
 *     management page never renders either. One stale dependency took down the
 *     whole client half.
 *   - the card itself was therefore unreachable, and its code has been removed.
 *
 * So this suite now verifies the bundle CONTRACT: the things that decide whether
 * the client half activates at all and whether its one surface can be reached.
 * Behavioural coverage of the page lives in `ui-page.mjs`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const results = []
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  results.push({ label, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`}`)
}
const checkTrue = (label, actual) => check(label, actual === true, true)
/**
 * Assert an expected `false`.
 *
 * `checkFalse` compares the RAW predicate. Pre-computing `actual === false` and
 * then comparing THAT boolean to `false` inverts the result: a correct bundle
 * reports FAIL, and a broken one reports PASS. That inversion briefly made this
 * suite claim the removal had failed when it had in fact succeeded.
 */
const checkFalse = (label, actual) => check(label, actual, false)

// ── load the bundle exactly as the browser module loader does ─────────────
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
const styleTags = []
let registered
globalThis.window = {
  __ModuleLoader__: {
    load: (entry) => {
      registered = entry
    },
  },
}
globalThis.document = {
  head: { appendChild: (tag) => styleTags.push(tag) },
  createElement: () => ({ dataset: {}, textContent: '' }),
  querySelector: () => null,
}
const requireFn = (id) => {
  if (id === 'react') {
    // The bundle needs React only to create elements; a minimal stand-in is
    // enough to load the module and call `apply`.
    return {
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
      useState: (initial) => [initial, () => {}],
      useMemo: (factory) => factory(),
      useCallback: (fn) => fn,
      useEffect: () => {},
      useSyncExternalStore: (_sub, get) => get(),
    }
  }
  throw new Error(`unexpected require("${id}")`)
}
new Function('window', 'document', 'require', source)(globalThis.window, globalThis.document, requireFn)
const client = registered.factory(requireFn)

// ── 1. module identity ───────────────────────────────────────────────────
check('bundle registers under the package id', registered.id, 'dsh-skill-mcp-panel')

// ── 2. the inject list decides whether the client half activates at all ──
// A named service the host does not provide keeps the entry PENDING forever.
check('client inject declares slots and locale', client.inject, ['slots', 'locale'])
checkFalse('client inject does not name the removed settingsScope', client.inject.includes('settingsScope'))
checkFalse('client inject does not name a removed page service', client.inject.some((name) => /scope$/i.test(name) && name !== 'locale'))

// ── 3. styles ────────────────────────────────────────────────────────────
check('bundle injects exactly one stylesheet', styleTags.length, 1)
checkTrue(
  'the stylesheet carries the page classes the component uses',
  styleTags[0].textContent.includes('.skn_page') && styleTags[0].textContent.includes('.skn_configRow'),
)
checkFalse(
  'the stylesheet dropped the removed card layout class',
  styleTags[0].textContent.includes('.skn_card{'),
)

// ── 4. the one surface registers into the one slot the host offers ───────
const registrations = []
let pageComponent
client.apply({
  slots: {
    inject: (_key, callback) => callback(),
    register: (registration, component) => {
      registrations.push(registration)
      if (registration.name === 'settings.plugins.tab') pageComponent = component
      return () => {}
    },
  },
  locale: {
    bind: () => (key) => key,
    register: () => () => {},
  },
  effect: (callback) => {
    const disposer = callback()
    return typeof disposer === 'function' ? disposer : () => {}
  },
})

check('exactly two slots are claimed', registrations.length, 2)
check(
  'the plugin detail section is claimed (Home → Plugins → Installed)',
  registrations.some((r) => r.name === 'plugins.detail.section'),
  true,
)
check(
  'the settings tab is claimed (Settings → Plugins)',
  registrations.some((r) => r.name === 'settings.plugins.tab'),
  true,
)
checkFalse('no registration targets the removed settings.plugin.item slot', registrations.some((r) => r.name === 'settings.plugin.item'))
const tab = registrations.find((r) => r.name === 'settings.plugins.tab')
check('the tab id is the settings namespace', tab?.id, 'skill-mcp-panel')
checkTrue('the tab supplies a localized label', typeof tab?.label === 'function')
check('the tab declares its locale namespace', tab?.locale, 'skill-mcp-panel')
checkTrue('the slot yielded a component', typeof pageComponent === 'function')

// ── 5. apply() must not touch a removed service ──────────────────────────
// `ctx.settingsScope` used to be read here. A bare access on a Cordis context
// returns undefined rather than throwing, so the failure was silent: the form
// was constructed against nothing. Assert the bundle has no such reference in
// executable code (comments explaining the removal are expected and fine).
const executable = source
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n')
checkFalse('no executable reference to ctx.settingsScope', /ctx\.settingsScope/.test(executable))
checkFalse('no executable registration into settings.plugin.item', /slots\.(inject|register)\(\s*["']settings\.plugin\.item/.test(executable))

// ── 6. the bundle stays a single self-contained CJS factory ──────────────
checkFalse('the bundle has no static import (the loader format has no ESM)', /^\s*import\s/m.test(source))
checkFalse('the bundle has no relative require', /require\(\s*["']\.\//.test(source))
checkTrue('the bundle requires only react from the platform seed', /require\(["']react["']\)/.test(source))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) {
  console.log(`FAILED:\n${failed.map((r) => `  - ${r.label}`).join('\n')}`)
  process.exit(1)
}