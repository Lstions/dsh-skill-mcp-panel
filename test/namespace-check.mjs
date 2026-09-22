/**
 * Contract check for the settings integration, against the REAL
 * `@deepseek-ai/dsh-settings` that this deployment ships.
 *
 * WHY THIS FILE WAS REWRITTEN
 *
 * It used to boot `@deepseek-ai/dsh-settings-file` and assert that
 * `installSection` registered a namespace. Both halves of that became wrong when
 * the harness updated:
 *
 *   - `dsh-settings-file` no longer exists; its behaviour moved into
 *     `dsh-settings`, so the suite self-skipped and verified NOTHING while
 *     `npm test` still printed a green exit.
 *   - `installSection` no longer exists either. The suite that was supposed to
 *     catch that was the one silently skipping, so the plugin shipped calling a
 *     method the runtime does not have — which is why the UI could show values
 *     and never save them.
 *
 * WHAT IT CHECKS NOW
 *
 * The two properties whose absence caused that defect, asserted against the real
 * package rather than this plugin's beliefs:
 *
 *   1. The shipped settings service still offers the API this plugin calls
 *      (`configure`, `write`, `mutate`), so a future rename fails here loudly
 *      instead of at run time.
 *   2. EVERY field of this plugin's `Config` declares `meta.volatile`, walked
 *      with the same rule the service uses. A non-volatile field is
 *      display-only: the service refuses the write with
 *      `Config field "..." is not volatile`.
 *
 * It also asserts the schema envelope the service needs to project a form.
 *
 * Run directly:
 *   node test/namespace-check.mjs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Config } from '../lib/index.js'
import { makeChecker } from './harness.mjs'

const { results, check } = makeChecker()
const PACKAGE = 'dsh-settings'

/**
 * Locate a package's `lib/index.js` in the deployment.
 *
 * The profile's own `node_modules` is a symlink farm that regularly dangles
 * after a harness update, so the pnpm content store is searched too. Resolution
 * never falls back to a bare specifier: that would resolve against THIS file's
 * location and silently test a stale copy instead of the deployment's.
 */
function locate(packageName) {
  const profileDir = process.env.DSH_PROFILE_DIR ?? join(homedir(), '.dsh', 'profiles', 'web')
  const literal = [
    join(profileDir, 'node_modules', '@deepseek-ai', packageName, 'lib', 'index.js'),
    join(profileDir, '..', 'node_modules', '@deepseek-ai', packageName, 'lib', 'index.js'),
  ]
  for (const candidate of literal) {
    // `existsSync` follows symlinks, so a dangling farm entry correctly fails here.
    if (existsSync(candidate)) return candidate
  }
  const root = process.env.DSH_PNPM_STORE ?? join(homedir(), '.local', 'share', 'pnpm', 'global', 'v11')
  if (!existsSync(root)) return undefined
  for (const store of readdirSync(root)) {
    const pnpm = join(root, store, 'node_modules', '.pnpm')
    if (!existsSync(pnpm)) continue
    for (const entry of readdirSync(pnpm)) {
      if (!entry.startsWith(`@deepseek-ai+${packageName}@`)) continue
      const lib = join(pnpm, entry, 'node_modules', '@deepseek-ai', packageName, 'lib', 'index.js')
      if (existsSync(lib)) return lib
    }
  }
  return undefined
}

const settingsPath = locate(PACKAGE)
if (settingsPath === undefined) {
  // NOT a skip. The package is part of every 0.1.7 deployment, so its absence
  // means the check cannot run and must not be reported as success.
  console.log(`FAIL  could not locate @deepseek-ai/${PACKAGE} in this deployment`)
  console.log('      looked in the profile, its parent, and the pnpm content store')
  console.log('      set DSH_PROFILE_DIR to the profile that owns this deployment')
  process.exit(1)
}
console.log(`using ${settingsPath}`)

const settingsModule = await import(pathToFileURL(settingsPath).href)
const service = settingsModule.SettingsForms ?? settingsModule.default

// ── 1. the API this plugin calls still exists ────────────────────────────
check('the shipped settings service is exported', typeof service, 'function')
if (typeof service === 'function') {
  const proto = service.prototype
  // `configure` replaced `installSection`; the plugin mounts with whichever the
  // runtime offers, and this pins that at least one path is always available.
  check('the service offers configure() (0.1.7+ path)', typeof proto.configure, 'function')
  check('the service offers write()', typeof proto.write, 'function')
  check('the service offers mutate()', typeof proto.mutate, 'function')
  check('the service reports writability', typeof Object.getOwnPropertyDescriptor(proto, 'writable')?.get, 'function')
}

// ── 2. every Config field is volatile, walked the service's way ──────────
// `volatileForm`/`isVolatilePath` work on the schema's JSON projection, from the
// root down: a field is live when it or its nearest ancestor is volatile. This
// mirrors that rule exactly, so a field the service would refuse is caught here.
const json = Config.toJSON()
const resolveRef = (node) => (typeof node === 'number' ? json.refs[node] : node)
const root = resolveRef(json.uid)

/** Collect the leaf field paths of the projected schema. */
function leafPaths(node, prefix = [], seen = new Set()) {
  const resolved = resolveRef(node)
  if (resolved === undefined) return []
  if (resolved.meta?.volatile) return [prefix.join('.')] // a volatile ancestor covers its children
  const dict = resolved.dict
  if (dict === undefined) return prefix.length === 0 ? [] : [prefix.join('.')]
  const out = []
  for (const [key, child] of Object.entries(dict)) {
    out.push(...leafPaths(child, [...prefix, key], seen))
  }
  return out
}

const path = root.dict === undefined ? [] : Object.entries(root.dict).map(([key]) => key)
check('the schema projects an object with fields', path.length > 0, true)

const nonVolatile = path.filter((key) => {
  const field = resolveRef(root.dict[key])
  return field?.meta?.volatile !== true
})
check(
  'EVERY Config field is volatile (a non-volatile field cannot be saved)',
  nonVolatile.join(',') === '' ? 'all volatile' : `NON-VOLATILE: ${nonVolatile.join(', ')}`,
  'all volatile',
)

// The exact fields the management page writes must each be individually live,
// because the service rejects a path that is not under a volatile node.
for (const key of ['roots', 'maxDepth', 'rank', 'duplicatePolicy', 'providerName', 'writeAccess', 'watch', 'watchDebounceMs', 'includeHidden', 'includeFlatRootFiles', 'skills', 'mcpServers']) {
  const field = resolveRef(root.dict?.[key])
  check(`config field "${key}" is volatile`, field?.meta?.volatile === true, true)
}

// ── 3. the schema envelope the service needs to project a form ───────────
check('the schema exposes toJSON for wire serialisation', typeof Config.toJSON, 'function')
check('the schema exposes ~standard.validate', typeof Config['~standard']?.validate, 'function')
check('the projected schema carries refs for $defs resolution', typeof json.refs, 'object')
check('the schema round-trips through JSON', typeof JSON.parse(JSON.stringify(json)).uid, 'number')

// The service reads defaults from the projection; a lost default would make a
// generated form render an empty control for a field that has one.
const depth = resolveRef(root.dict?.maxDepth)
check('a projected field keeps its default', depth?.meta?.default, 4)

// ── 4. no stale reference to the removed API in shipped source ───────────
// Guards against a half-migration: calling `installSection` unguarded is what
// killed the settings registration while everything else kept working.
const sources = ['lib/index.js', 'lib/client.js', 'lib/state.js', 'lib/http.js', 'lib/mcp.js', 'lib/toggle.js']
const offenders = sources.filter((file) => {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  // A guarded fallback is fine and expected; an unguarded primary call is not.
  return /settingsService\.installSection\(/.test(text) && !/typeof settingsService\?\.installSection === 'function'/.test(text)
})
check('installSection is only called behind a capability check', offenders.join(',') === '' ? 'guarded' : `UNGUARDED: ${offenders.join(', ')}`, 'guarded')

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) console.log(`FAILED:\n${failed.map((entry) => `  - ${entry.label}`).join('\n')}`)
process.exit(failed.length === 0 ? 0 : 1)