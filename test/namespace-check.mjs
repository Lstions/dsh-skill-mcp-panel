/**
 * Boot the REAL settings provider and the REAL plugin together, then assert the
 * settings namespace registers and is readable.
 *
 * This is the check the GUI cannot give on demand: it exercises
 * `installSection` against the actual `@deepseek-ai/dsh-settings-file` provider
 * (not a stub) and confirms the namespace a Settings card would render.
 *
 * It needs the deployment's settings provider, so point `DSH_PROFILE_DIR` at the
 * profile (default `~/.dsh/profiles/web`) and run it directly:
 *   node test/namespace-check.mjs
 */
import { Context } from '@deepseek-ai/cordis'
import { pathToFileURL } from 'node:url'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { apply as skillNestingApply, SETTINGS_NAMESPACE, Config } from '../lib/index.js'
import { makeChecker } from './harness.mjs'

const { results, check } = makeChecker()

/**
 * Import the deployment's settings provider.
 *
 * A bare specifier would resolve against THIS file's location, not the profile,
 * so the profile directory is resolved explicitly and the package is imported by
 * absolute URL. That keeps the check runnable straight from the package without
 * requiring the profile to be the working directory.
 */
const profileDir = process.env.DSH_PROFILE_DIR ?? join(homedir(), '.dsh', 'profiles', 'web')
// The profile's own node_modules comes first, then the shared parent. Both are
// often SYMLINK FARMS whose entries may dangle after an upgrade, so a plain
// existsSync on the two literal paths silently reports "provider absent" and
// this whole suite self-skips — verified nothing while printing a green exit.
// The pnpm content store is searched as well, so the suite runs whenever the
// deployment's settings provider exists anywhere reachable.
const candidates = [
  join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-settings-file', 'lib', 'index.js'),
  join(profileDir, '..', 'node_modules', '@deepseek-ai', 'dsh-settings-file', 'lib', 'index.js'),
]

/** Locate the provider inside a pnpm store, newest layout first. */
function searchPnpmStore() {
  const root = process.env.DSH_PNPM_STORE ?? join(homedir(), '.local', 'share', 'pnpm', 'global', 'v11')
  if (!existsSync(root)) return undefined
  let stores
  try {
    stores = readdirSync(root)
  } catch {
    return undefined
  }
  for (const store of stores) {
    const pnpm = join(root, store, 'node_modules', '.pnpm')
    if (!existsSync(pnpm)) continue
    let entries
    try {
      entries = readdirSync(pnpm)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.startsWith('@deepseek-ai+dsh-settings-file@')) continue
      const lib = join(pnpm, entry, 'node_modules', '@deepseek-ai', 'dsh-settings-file', 'lib', 'index.js')
      if (existsSync(lib)) return lib
    }
  }
  return undefined
}

const providerPath = candidates.find((candidate) => existsSync(candidate)) ?? searchPnpmStore()
if (providerPath === undefined) {
  console.log('SKIP  settings provider not found; looked in:')
  for (const candidate of candidates) console.log(`  ${candidate}`)
  console.log('  and the pnpm content store under $DSH_PNPM_STORE or ~/.local/share/pnpm/global')
  console.log('Set DSH_PROFILE_DIR to the profile that owns this deployment.')
  process.exit(0)
}
const FileSettingsProvider = (await import(pathToFileURL(providerPath).href)).default

/** `skills` is a hard dependency of the plugin under test. */
class FakeSkills {
  constructor(ctx) {
    this.ctx = ctx
  }
  registerProvider(create) {
    create({ invalidate: () => {} })
    return () => {}
  }
}

const ctx = new Context()
ctx.provide('skills', new FakeSkills(ctx))

await ctx.plugin(FileSettingsProvider, { filename: '/tmp/dsh-nesting-namespace-check.yaml', pollIntervalMs: 100000 })
// Mount through the shipped plugin's own export so the real `inject`/`apply`
// pair is exercised. Two details matter:
//   - the plugin object needs a `name`, because Cordis rejects an anonymous
//     object plugin;
//   - `apply` is called from a BLOCK body. An expression-bodied arrow returns
//     the value of `skillNestingApply(...)`, and Cordis interprets a returned
//     non-function as an effect callback, failing with "Invalid effect".
await ctx.plugin(
  {
    name: 'skill-mcp-panel',
    inject: ['skills'],
    apply: (c) => {
      skillNestingApply(c, { roots: ['/tmp'], watch: false })
    },
  },
  {},
)

const settings = ctx.get('settings')
check('the settings service is present', settings !== undefined, true)

const value = settings.get(SETTINGS_NAMESPACE)
check('the namespace registers against the real provider', value !== undefined, true)

if (value !== undefined) {
  const described = settings.describe({ redactSecrets: true }).find((entry) => entry.ns === SETTINGS_NAMESPACE)
  check('the namespace is describable for a settings surface', described !== undefined, true)
  check('the descriptor carries a schema envelope for the generated form', described?.schema !== undefined, true)
  check('the resolved roots come from the composition base', [...value.roots], ['/tmp'])
  // The namespace also carries the management state this plugin persists:
  // per-skill toggles, the MCP declarations it owns, and the write-access mode.
  check('every field resolves with a default', Object.keys(value).sort().join(','), [
    'duplicatePolicy', 'includeFlatRootFiles', 'includeHidden', 'maxDepth',
    'mcpServers', 'providerName', 'rank', 'roots', 'skills', 'watch',
    'watchDebounceMs', 'writeAccess',
  ].join(','))
}

// The schema must satisfy the settings service's contract, or the generated
// client form cannot rehydrate it.
check('the schema is callable', typeof Config, 'function')
check('the schema exposes toJSON for wire serialisation', typeof Config.toJSON, 'function')
check('the schema exposes ~standard.validate', typeof Config['~standard']?.validate, 'function')

await ctx.fiber.dispose()

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)