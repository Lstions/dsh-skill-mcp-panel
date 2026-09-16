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
import { existsSync } from 'node:fs'
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
// The profile's own node_modules comes first; the shared parent holds the
// deployment packages the profile hoists from.
const candidates = [
  join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-settings-file', 'lib', 'index.js'),
  join(profileDir, '..', 'node_modules', '@deepseek-ai', 'dsh-settings-file', 'lib', 'index.js'),
]
const providerPath = candidates.find((candidate) => existsSync(candidate))
if (providerPath === undefined) {
  console.log('SKIP  settings provider not found; looked in:')
  for (const candidate of candidates) console.log(`  ${candidate}`)
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
await ctx.plugin(
  { inject: ['skills'], apply: (c) => skillNestingApply(c, { roots: ['/tmp'], watch: false }) },
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
  check('every field resolves with a default', Object.keys(value).sort().join(','), [
    'duplicatePolicy', 'includeFlatRootFiles', 'includeHidden', 'maxDepth',
    'providerName', 'rank', 'roots', 'watch', 'watchDebounceMs',
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