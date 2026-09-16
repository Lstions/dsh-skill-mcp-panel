/**
 * Run the real provider against real skill roots and report what it finds.
 * Usage: node test/realtree.mjs [root ...]
 */
import { apply } from '../lib/index.js'
import { makeFsService, makeCtx } from './harness.mjs'

const roots = process.argv.slice(2)
if (roots.length === 0) roots.push('/home/sun/.agents/skills')

const harness = makeCtx(makeFsService())
apply(harness.ctx, { roots })
const provider = harness.captured.provider
const list = await provider.list()
const report = provider.lastReport

const names = list.map((c) => c.name).sort()
const categories = new Map()
for (const candidate of list) {
  const parts = candidate.locator.directory.split('/')
  const category = parts[parts.length - 2]
  categories.set(category, (categories.get(category) || 0) + 1)
}

console.log('roots:', roots.join(', '))
console.log('skills:', list.length)
console.log('unique names:', new Set(names).size)
console.log('duplicates:', report.duplicates.length)
for (const dup of report.duplicates.slice(0, 8)) {
  console.log(`  - ${dup.name}:`)
  for (const path of dup.paths) console.log(`      ${path}`)
}
console.log('skipped:', report.skipped.length)
console.log('root errors:', report.errors.length)
console.log(
  'categories (' + categories.size + '):',
  [...categories.entries()].sort().map(([k, v]) => k + '=' + v).join(' '),
)
for (const [level, message] of harness.logs) console.log(`${level}: ${message}`)