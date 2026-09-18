const P = '/home/sun/.local/share/pnpm/global/v11/329139-18d64529a864fc0c-0/node_modules/.pnpm'
const CORDIS = P + '/@deepseek-ai+cordis@4.0.2_@deepseek-ai+cordis-plugin-include@1.0.7_@deepseek-ai+cordis-plugin-loader@1.0.3/node_modules/@deepseek-ai/cordis'
const SKILL = P + '/@deepseek-ai+dsh-skill@0.1.6-alpha.2_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-llm@0.1_754b13eb5fb13f944a0c135080e7412e/node_modules/@deepseek-ai/dsh-skill'
const SCOPE = P + '/@deepseek-ai+dsh-scope@0.1.6-alpha.2_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-invaria_8802cbeca2a66ef97a5b4e663664f4cd/node_modules/@deepseek-ai/dsh-scope'
const { scopeOf, scopeChainOf } = await import(SCOPE + '/lib/index.js')
const { Context } = await import(CORDIS + '/lib/index.js')
const skillMod = await import(SKILL + '/lib/index.js')
const { createScope } = await import(SCOPE + '/lib/index.js')
const { isModelInvocable } = skillMod

const mk = (prov, inv) => ({ name: 'contested', description: prov, invocation: inv, source: 'custom', provider: prov, rank: 300, path: '/tmp/' + prov + '/SKILL.md', locator: {} })

const ctx = new Context()
ctx.plugin(skillMod.default ?? skillMod)
await new Promise(r => setTimeout(r, 50))

ctx.skills.registerProvider(() => ({
  name: 'nested-filesystem',
  async list() { return [mk('nested-filesystem', { modelInvocable: false, userInvocable: false })] },
  async get() { return { ...mk('nested-filesystem', { modelInvocable: false, userInvocable: false }), content: 'GLOBAL-SUPPRESSED' } },
}))
await new Promise(r => setTimeout(r, 20))

// preset-side plugin, mounted into a scope the way a preset composition does
const scoped = createScope(ctx, { preset: 'demo' }, {})
scoped.ctx.plugin({
  name: 'preset-skills',
  inject: ['skills'],
  apply(c) {
    c.skills.registerProvider(() => ({
      name: 'preset-nested',
      async list() { return [mk('preset-nested', { modelInvocable: true, userInvocable: true })] },
      async get() { return { ...mk('preset-nested', { modelInvocable: true, userInvocable: true }), content: 'PRESET-LIVE' } },
    }))
  },
})
await new Promise(r => setTimeout(r, 60))

const g = (await ctx.skills.list()).find(s => s.name === 'contested')
const p = (await ctx.skills.list({ scope: scopeOf(scoped.ctx) })).find(s => s.name === 'contested')
console.log('GLOBAL view  :', g ? `provider=${g.provider} modelInvocable=${isModelInvocable(g)}` : 'ABSENT')
console.log('PRESET view  :', p ? `provider=${p.provider} modelInvocable=${isModelInvocable(p)}` : 'ABSENT')
console.log()
console.log('>>> F3.3 near-layer: global suppression does NOT hide it in the preset scope ->',
  p && isModelInvocable(p) ? 'CONFIRMED: still live; interface must report effective=false' : 'suppression held')

console.log('chainLen(scoped)  =', scopeChainOf(scopeOf(scoped.ctx)).length)
const layers = ctx.skills.layers
console.log('global providers  =', [...layers.global.providers.keys()])
console.log('peek(scoped)      =', layers.peek(scopeOf(scoped.ctx)) ? [...layers.peek(scopeOf(scoped.ctx)).providers.keys()] : 'NO LAYER')
