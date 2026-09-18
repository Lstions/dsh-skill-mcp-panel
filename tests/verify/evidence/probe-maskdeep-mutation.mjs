// MUTATION PROOF: revert the CALL SITE from the deep mask to the contract's
// shallow maskDict — exactly the code state that leaked. This is a purely
// behavioural change: both helpers exist, the module loads, no symbol is
// renamed, so any red is an assertion failure rather than a load error.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const target = 'lib/state.js'
const original = readFileSync(target, 'utf8')
const before = createHash('md5').update(original).digest('hex')

// Find the real call site in sanitiseMcp.
const lines = original.split('\n')
const idx = lines.findIndex(l => l.includes('maskDeep(') && l.includes('config'))
if (idx < 0) { console.log('CALL SITE NOT FOUND — refusing, proof would be vacuous'); process.exit(2) }
const originalLine = lines[idx]
console.log('call site:', originalLine.trim())
const mutatedLine = originalLine.replace(/maskDeep\(([^)]*)\)/, 'maskDict($1)')
if (mutatedLine === originalLine) { console.log('replacement was a no-op — refusing'); process.exit(2) }
lines[idx] = mutatedLine
// Also add the import so the mutation is BEHAVIOURAL, not a missing-symbol
// load error (假象 1: a red from "maskDict is not defined" would prove nothing).
const importIdx = lines.findIndex(l => l.startsWith('import ') && l.includes('contract.js'))
if (importIdx < 0) { console.log('no contract import — refusing'); process.exit(2) }
if (!lines[importIdx].includes('maskDict')) {
  lines[importIdx] = lines[importIdx].replace(/import \{([^}]*)\}/, (m, names) => `import {${names}, maskDict }`)
}
console.log('import line now:', lines[importIdx].trim())
writeFileSync(target, lines.join('\n'))
console.log('mutated call site ->', mutatedLine.trim())

const { createStateBuilder } = await import('./lib/state.js')
const CANARY = 'CANARY-NESTED-MUTATION'
const nested = { transport:'stdio', env:{ GITHUB_TOKEN: CANARY, DEEP:{ INNER_TOKEN: CANARY } } }
const built = createStateBuilder({
  ctx: { get:()=>undefined, logger:{info(){},warn(){},error(){}}, effect:()=>()=>{}, on:()=>()=>{}, inject:()=>{} },
  provider:{name:'p',lastReport:{roots:[],errors:[]}},
  readConfig:()=>({roots:[],maxDepth:4,rank:300,duplicatePolicy:'first-wins'}),
  readDisabled:()=>new Set(),
  readMcp:()=>({servers:[{serverName:'x',transport:'stdio',config:nested}],managerAvailable:false,mcpClientAvailable:false}),
  readWriteAccess:()=>'same-origin', isWritable:()=>true, log:()=>{},
})
const text = JSON.stringify(await built.build())
const leaks = text.includes(CANARY)
console.log()
console.log('RAW STATE TEXT CONTAINS CANARY?', leaks)
console.log(leaks ? '>>> GATE GOES RED as required (assertion would fail)' : '>>> GATE STAYS GREEN — assertion is VACUOUS!')

writeFileSync(target, original)
const after = createHash('md5').update(readFileSync(target)).digest('hex')
console.log('restore md5 match:', before === after, `(${before})`)
