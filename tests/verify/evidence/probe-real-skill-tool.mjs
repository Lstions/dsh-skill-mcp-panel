const P = '/home/sun/.local/share/pnpm/global/v11/329139-18d64529a864fc0c-0/node_modules/.pnpm'
const find = async (n) => {
  const fs = await import('node:fs')
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
ctx.plugin(skill.default ?? skill)
ctx.plugin(tools.default ?? tools)
await new Promise(r=>setTimeout(r,80))
ctx.plugin(toolSkill.default ?? toolSkill)
await new Promise(r=>setTimeout(r,250))
console.log('tools proto:', Object.getOwnPropertyNames(Object.getPrototypeOf(ctx.tools)).join(','))
const t = ctx.tools.get?.('skill') ?? ctx.tools.getTool?.('skill')
console.log('skill tool found:', t ? 'yes' : 'no')
if (t) {
  // publish a suppressed candidate and try to load it
  ctx.skills.registerProvider(() => ({
    name: 'nested-filesystem',
    async list(){ return [{name:'ghost',description:'d',invocation:{modelInvocable:false,userInvocable:false},source:'custom',provider:'nested-filesystem',rank:300,path:'/tmp/ghost/SKILL.md',locator:{}}] },
    async get(){ return undefined },
  }))
  await new Promise(r=>setTimeout(r,60))
  const list = await ctx.skills.list()
  console.log('list():', JSON.stringify(list.map(s=>s.name)), 'modelInvocable:', JSON.stringify(list.map(s=>s.invocation.modelInvocable)))
  const got = await ctx.skills.get('ghost')
  console.log('get(ghost):', got === undefined ? 'undefined' : 'DEFINITION')
  try {
    const r = await t.execute({name:'ghost'}, { signal: undefined, agent: undefined })
    console.log('TOOL RESULT:', JSON.stringify(r).slice(0,200))
  } catch(e) { console.log('TOOL ERROR:', e.message) }
}
