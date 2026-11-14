#!/usr/bin/env node
/**
 * Offline tests for the bundle group and the page directory.
 *
 * The plugin is a GROUP of loader entries, not one row: the engine plus one
 * component per page. These tests pin the parts a fake can check without a
 * loader — the group class's contract (it must mount children through the
 * loader's own `cordis:group` builtin and close them on teardown), the page
 * registry semantics, and the page components' descriptors. The real loader
 * path is exercised by the live instance.
 *
 * Usage: node test/bundle.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import SkillMcpPanelBundle from '../lib/bundle.js'
import { createPageRegistry, PAGES_SERVICE } from '../lib/pages.js'
import * as skillsPage from '../lib/pages/skills.js'
import * as mcpPage from '../lib/pages/mcp.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
let failed = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`}`)
}

// ── page registry ────────────────────────────────────────────────────────
{
  const registry = createPageRegistry()
  check('an empty directory lists nothing', registry.list(), [])
  const offSkills = registry.register({ id: 'skills', labelKey: 'page.skills', order: 10 })
  registry.register({ id: 'mcp', labelKey: 'page.mcp', order: 20 })
  check('pages are listed in order', registry.list().map((page) => page.id), ['skills', 'mcp'])
  check('the label key is carried', registry.list()[0].labelKey, 'page.skills')
  offSkills()
  check('a disposer removes its page', registry.list().map((page) => page.id), ['mcp'])
  // A component can remount: the newer registration must win over a stale disposer.
  const stale = registry.register({ id: 'mcp', labelKey: 'page.mcp', order: 20 })
  registry.register({ id: 'mcp', labelKey: 'page.mcp', order: 30 })
  stale()
  check('a stale disposer keeps the newer registration', registry.list().map((page) => page.id), ['mcp'])
  check('the newer registration wins', registry.list()[0].order, 30)
  let threw = false
  try {
    registry.register({ id: '' })
  } catch {
    threw = true
  }
  check('a page without an id is refused', threw, true)
}

// ── page components ──────────────────────────────────────────────────────
{
  check('both page components inject the registry service', [skillsPage.inject[0], mcpPage.inject[0]], [PAGES_SERVICE, PAGES_SERVICE])
  const registry = createPageRegistry()
  for (const component of [skillsPage, mcpPage]) {
    const ctx = {
      get: (name) => (name === PAGES_SERVICE ? registry : undefined),
      logger: { warn() {} },
      effect: (callback) => {
        const disposer = callback()
        return typeof disposer === 'function' ? disposer : () => {}
      },
    }
    component.apply(ctx)
  }
  check('each component contributes its page', registry.list().map((page) => page.id), ['skills', 'mcp'])
  check('the components provide the tab label keys', registry.list().map((page) => page.labelKey), ['page.skills', 'page.mcp'])
}

// ── the bundle group class ───────────────────────────────────────────────
{
  const GROUP = Symbol.for('cordis.group')
  const INIT = Symbol.for('cordis.init')
  check('the group class is marked as a loader group', SkillMcpPanelBundle[GROUP], true)
  check('the group class injects the loader', SkillMcpPanelBundle.inject, ['loader'])

  const updates = []
  let stopped = 0
  class FakeGroup {
    constructor(ctx, config) {
      this.ctx = ctx
      this.config = config
    }
    async update(config) {
      updates.push(config)
    }
    stop() {
      stopped += 1
    }
  }
  const ctx = { loader: { builtins: { group: FakeGroup } } }
  const children = [{ id: 'skill-mcp-panel' }, { id: 'page-skills' }]
  const bundle = new SkillMcpPanelBundle(ctx, children)
  const iterator = bundle[INIT]()
  const first = await iterator.next()
  // The first next() runs to the yield (the disposer); the second runs the body
  // that mounts the children — exactly the sequence a service init performs.
  await iterator.next()
  check('the group mounts its children through the loader builtin', updates, [children])
  check('the group yields a disposer first', typeof first.value, 'function')
  first.value()
  check('the disposer stops the group', stopped, 1)

  const noLoader = new SkillMcpPanelBundle({}, [])
  let message = ''
  try {
    await noLoader[INIT]().next()
  } catch (error) {
    message = String(error.message ?? error)
  }
  check('a loader without the group builtin fails loudly', message.includes('cordis:group'), true)
}

// ── the bundle patch is a group with one entry per component ─────────────
{
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  check('the patch inserts one group', /- insert:\n\s+- id: skill-mcp-panel-bundle/.test(patch), true)
  check('the group row is marked group: true', /group: true/.test(patch), true)
  for (const name of ['dsh-skill-mcp-panel/bundle', "'dsh-skill-mcp-panel'", 'dsh-skill-mcp-panel/skills', 'dsh-skill-mcp-panel/mcp']) {
    check(`the group lists ${name}`, patch.includes(name), true)
  }
  check('the component ids are the plain feature names', ['skill-mcp-panel-skills', 'skill-mcp-panel-mcp'].every((id) => patch.includes('id: ' + id)), true)
  check('the engine keeps its old composition id (settings survive)', /- id: skill-mcp-panel\n\s+name: 'dsh-skill-mcp-panel'/.test(patch), true)
}

const total = 22
console.log(`\n${total - failed}/${total} checks passed`)
if (failed > 0) process.exit(1)
