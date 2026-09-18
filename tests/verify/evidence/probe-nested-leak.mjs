const { createMcpManager } = await import('/home/sun/workspace/dsh-plugins/lib/mcp.js')
const { createStateBuilder, maskDeep } = await import('/home/sun/workspace/dsh-plugins/lib/state.js')
const { maskDict } = await import('/home/sun/workspace/dsh-plugins/lib/contract.js')
const CANARY = 'CANARY-NESTED-SECRET-XYZ'

console.log('=== maskDeep vs maskDict on a NESTED config (devA\'s reported leak shape) ===')
const nested = { transport:'stdio', command:'node', env:{ GITHUB_TOKEN: CANARY }, headers:{ authorization:'Bearer '+CANARY } }
console.log('  maskDict (contract, shallow):', JSON.stringify(maskDict(nested)).includes(CANARY) ? 'LEAKS' : 'safe')
console.log('  maskDeep (state.js):        ', JSON.stringify(maskDeep(nested)).includes(CANARY) ? 'LEAKS' : 'safe')
console.log('  maskDeep output:', JSON.stringify(maskDeep(nested)))

console.log()
console.log('=== REAL end-to-end: declaration -> mcp.describe() -> state.build() ===')
const declarations = [
  { serverName:'nested-canary', transport:'stdio', enabled:true,
    config:{ transport:'stdio', command:'node', args:['s.js'],
             env:{ GITHUB_TOKEN: CANARY, DEEP:{ INNER_TOKEN: CANARY } },
             headers:{ authorization:'Bearer '+CANARY } } },
]
const ctx = { get:()=>undefined, logger:{info(){},warn(){},error(){}}, effect:()=>()=>{}, inject:()=>{}, on:()=>()=>{} }
const mgr = createMcpManager({ ctx, readDeclared:()=>declarations, writeDeclared:()=>{}, readConfig:()=>({}) })
const inv = await mgr.describe()
console.log('  mcp.describe() config:', JSON.stringify(inv.servers[0].config))
console.log('  describe leaks?', JSON.stringify(inv).includes(CANARY) ? 'LEAKS' : 'safe')

const b = createStateBuilder({ ctx, provider:{name:'nested-filesystem',lastReport:{roots:[],errors:[]}},
  readConfig:()=>({roots:[],maxDepth:4,rank:300,duplicatePolicy:'first-wins'}), readDisabled:()=>new Set(),
  readMcp:()=>inv, readWriteAccess:()=>'same-origin', isWritable:()=>true, log:()=>{} })
const doc = await b.build()
const text = JSON.stringify(doc)
console.log()
console.log('  >>> FULL state document contains canary?', text.includes(CANARY))
if (text.includes(CANARY)) { const at=text.indexOf(CANARY); console.log('  CONTEXT:', text.slice(Math.max(0,at-200), at+40)) }
else console.log('  no leak at any nesting depth')
