const P = '/home/sun/.local/share/pnpm/global/v11/329139-18d64529a864fc0c-0/node_modules/.pnpm'
const fs = await import('node:fs')
const find = async (n) => {
  const dirs = fs.readdirSync(P).filter(d => d.startsWith('@deepseek-ai+' + n + '@')).sort((a,b)=>a.length-b.length)
  for (const d of dirs) { const p = `${P}/${d}/node_modules/@deepseek-ai/${n}/lib/index.js`; if (fs.existsSync(p)) return p }
  throw new Error('not found ' + n)
}
const ctxMod = await import(await find('cordis'))
const skill = await import(await find('dsh-skill'))
const scopeMod = await import(await find('dsh-scope'))
const nfs = await import(await find('dsh-skill-filesystem'))
const ctx = new ctxMod.Context()
ctx.plugin(skill.default ?? skill)
await new Promise(r=>setTimeout(r,60))

// GLOBAL layer: our plugin, scanning nested at maxDepth 4 (this is skill-mcp-panel)
const suppressed = new Set()
let control
ctx.skills.registerProvider((c) => { control = c; return {
  name: 'nested-filesystem',
  async list() { return [] },   // replaced below by the real repo provider
  async get() { return undefined },
}})
await new Promise(r=>setTimeout(r,40))

// PRESET layer: the REAL skill-filesystem, exactly as presets/ptc mounts it
const scoped = scopeMod.createScope(ctx, { preset: 'ptc' }, {})
scoped.ctx.plugin(nfs.default ?? nfs, { includeDefaultRoots: true, dshHome: "/home/sun/.dsh", agentsHome: "/home/sun/.agents", bundledSkillDir: undefined, watch: false })
await new Promise(r=>setTimeout(r,400))

const key = scopeMod.scopeOf(scoped.ctx)
const presetView = await ctx.skills.list({ scope: key })
const globalView = await ctx.skills.list()
console.log('PRESET view count:', presetView.length)
console.log('GLOBAL view count:', globalView.length)
const byProvider = {}
for (const s of presetView) byProvider[s.provider] = (byProvider[s.provider]||0)+1
console.log('preset view providers:', JSON.stringify(byProvider))
const gByProvider = {}
for (const s of globalView) gByProvider[s.provider] = (gByProvider[s.provider]||0)+1
console.log('global view providers:', JSON.stringify(gByProvider))
console.log()
console.log('names in preset view:', presetView.map(s=>s.name).slice(0,20).join(', '))
