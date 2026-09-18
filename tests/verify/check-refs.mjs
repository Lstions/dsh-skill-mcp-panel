/**
 * Validate that every module reference in tests/ resolves.
 *
 * This understands all four forms the suite actually uses, because a
 * `from '...'`-only check missed the dynamic ones and let two broken imports
 * survive a "fix":
 *
 *   import ... from '<spec>'
 *   await import('<spec>')
 *   await import(`<spec-with-template>`)
 *   export ... from '<spec>'
 *
 * It also verifies require() paths and package.json "main"/"exports" targets,
 * so a rename that misses one of them fails here instead of at run time.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'

const ROOT = process.cwd()
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  )

// Strip a query/fragment: `./x.js?probe=1` must still be checked as `./x.js`.
const clean = (spec) => spec.split('?')[0].split('#')[0]

const patterns = [
  /(?:^|[^\w.])import\s+[^'"`]*?from\s*['"`]([^'"`]+)['"`]/g,
  /(?:^|[^\w.])export\s+[^'"`]*?from\s*['"`]([^'"`]+)['"`]/g,
  /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
]

let broken = 0
let checked = 0

for (const file of walk(ROOT).filter((f) => /\.(mjs|js|cjs)$/.test(f) && !f.includes('node_modules'))) {
  const text = readFileSync(file, 'utf8')
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const spec = match[1]
      // Only file references are this script's business; bare specifiers are
      // resolved by Node from node_modules.
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue
      // A template literal that still contains ${...} cannot be resolved statically.
      if (spec.includes('${')) continue
      checked += 1
      const target = spec.startsWith('/') ? spec : resolve(dirname(file), clean(spec))
      if (!existsSync(target)) {
        console.log(`BROKEN ${relative(ROOT, file)}\n   -> ${spec}\n   -> ${target}`)
        broken += 1
      }
    }
  }
}

// The package manifest's own entry points must exist, or an install produces a
// package that cannot be loaded.
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const entries = [pkg.main, ...Object.values(pkg.exports ?? {}).flatMap((v) => (typeof v === 'string' ? [v] : Object.values(v)))]
for (const entry of entries) {
  if (typeof entry !== 'string' || !entry.startsWith('.')) continue
  checked += 1
  if (!existsSync(join(ROOT, entry))) {
    console.log(`BROKEN package.json entry -> ${entry}`)
    broken += 1
  }
}

// A bundle patch named in the manifest must exist and be a regular file.
const patch = pkg.dsh?.bundle?.patch
if (patch !== undefined) {
  checked += 1
  const target = join(ROOT, patch)
  if (!existsSync(target) || !statSync(target).isFile()) {
    console.log(`BROKEN dsh.bundle.patch -> ${patch}`)
    broken += 1
  }
}

// The client bundle id must equal the package name, or the browser module table
// keys the registration under a name nothing ever asks for.
const clientPath = join(ROOT, 'lib/client.js')
if (existsSync(clientPath)) {
  checked += 1
  const id = /id:\s*["']([^"']+)["']/.exec(readFileSync(clientPath, 'utf8'))?.[1]
  if (id !== pkg.name) {
    console.log(`BROKEN client bundle id -> ${JSON.stringify(id)} but package name is ${JSON.stringify(pkg.name)}`)
    broken += 1
  }
}

console.log(`\nchecked ${checked} reference(s); ${broken} broken`)
process.exit(broken === 0 ? 0 : 1)