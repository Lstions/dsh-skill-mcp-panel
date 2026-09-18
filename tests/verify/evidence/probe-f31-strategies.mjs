const P = '/home/sun/.local/share/pnpm/global/v11/329139-18d64529a864fc0c-0/node_modules/.pnpm'
const fs = await import('node:fs')
const find = async (n) => {
  const dirs = fs.readdirSync(P).filter(d => d.startsWith('@deepseek-ai+' + n + '@')).sort((a,b)=>a.length-b.length)
  for (const d of dirs) { const p = `${P}/${d}/node_modules/@deepseek-ai/${n}/lib/index.js`; if (fs.existsSync(p)) return p }
  throw new Error('not found ' + n)
}
const ctxMod = await import(await find('cordis'))
const skill = await import(await find('dsh-skill'))
const tools = await import(await find('dsh-tools'))
const toolSkill = await import(await find('dsh-tool-skill'))
const ctx = new ctxMod.Context()
ctx.provide('systemPrompt', { tools: () => {}, section: () => () => {} })
ctx.provide('agents', { get: () => undefined, list: () => [], on: () => () => {} })
ctx.plugin(skill.default ?? skill); ctx.plugin(tools.default ?? tools)
await new Promise(r=>setTimeout(r,80))
ctx.plugin(toolSkill.default ?? toolSkill)
await new Promise(r=>setTimeout(r,250))
const t = ctx.tools.get('skill')
const call = async (n) => t.execute({name:n},{signal:undefined,agent:undefined}).then(r=>'OK body='+JSON.stringify(r.content)).catch(e=>'ERR '+e.message)

const cand = (name) => ({name,description:'d',invocation:{modelInvocable:true,userInvocable:true},source:'custom',provider:'nested-filesystem',rank:300,path:`/tmp/${name}/SKILL.md`,locator:{}})
const suppressed = new Set()
let control
ctx.skills.registerProvider((c) => { control = c; return {
  name: 'nested-filesystem',
  async list(){ return ['alpha','beta'].filter(n=>!suppressed.has(n)).map(cand) },
  async get(c){ if(suppressed.has(c.name)) return undefined; return {...cand(c.name), content:'BODY-'+c.name} },
}})
await new Promise(r=>setTimeout(r,60))

console.log('=== STRATEGY: OMIT the candidate from list() entirely ===')
console.log('list before :', (await ctx.skills.list()).map(s=>s.name))
console.log('tool before :', await call('alpha'))
suppressed.add('alpha'); control.invalidate()
await new Promise(r=>setTimeout(r,40))
const after1 = (await ctx.skills.list()).map(s=>s.name)
console.log('list after  :', after1)
console.log('tool after  :', await call('alpha'))
console.log('  -> F3.1 "list() no longer contains the name" :', after1.includes('alpha') ? 'FAILS (still present)' : 'HOLDS')
console.log('  -> F3.1 "tool reports unknown"               :', (await call('alpha')).includes('unknown') ? 'HOLDS' : 'FAILS')
console.log()
console.log('=== CACHE TRAP: same suppression key, no invalidate() ===')
const suppressed2 = new Set()
let ctrl2
ctx2 = null
