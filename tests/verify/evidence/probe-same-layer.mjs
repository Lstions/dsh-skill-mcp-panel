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
const call = (n) => t.execute({name:n},{signal:undefined,agent:undefined}).then(r=>'OK '+JSON.stringify(r.content)).catch(e=>'ERR '+e.message)
const cand = (name, provider, rank, inv) => ({name, description:'d', invocation: inv ?? {modelInvocable:true,userInvocable:true}, source:'custom', provider, rank, path:`/tmp/${name}/SKILL.md`, locator:{}})

console.log('SCENARIO: TWO SAME-LAYER PROVIDERS both offer "x"')
console.log('  competitor (built-in skill-filesystem analogue) rank=400')
console.log('  skill-nesting rank=0 or omit')
console.log()

let mode = 'inert'
const disabled = new Set()
ctx.skills.registerProvider(() => ({
  name: 'competitor',
  async list(){ return [cand('x','competitor',400)] },
  async get(){ return {...cand('x','competitor',400), content:'COMPETITOR BODY'} },
}))
ctx.skills.registerProvider((c) => ({ name:'nested-filesystem',
  async list(){
    if (mode === 'omit') return []
    return [cand('x','nested-filesystem',0,{modelInvocable:false,userInvocable:false})]
  },
  async get(){ return undefined },
}))
await new Promise(r=>setTimeout(r,80))

for (const m of ['inert','omit']) {
  mode = m
  if (ctx.skills.invalidateCache) ctx.skills.invalidateCache()
  await new Promise(r=>setTimeout(r,80))
  const list = await ctx.skills.list()
  const row = list.find(s=>s.name==='x')
  const modelSees = list.filter(s=>s.invocation?.modelInvocable).map(s=>s.name)
  const got = await ctx.skills.get('x')
  console.log(`--- STRATEGY ${m.toUpperCase()} ---`)
  console.log('  list()      :', row ? `x<-${row.provider} model=${row.invocation.modelInvocable}` : 'x ABSENT')
  console.log('  model sees  :', JSON.stringify(modelSees))
  console.log('  get(x)      :', got === undefined ? 'undefined' : `provider=${got.provider} body=${JSON.stringify(got.content)}`)
  console.log('  tool(x)     :', await call('x'))
  console.log('  => close HONORED?', (!modelSees.includes('x') && got === undefined) ? 'YES' : 'NO — silently ignored')
  console.log()
}
