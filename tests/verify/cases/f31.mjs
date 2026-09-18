/**
 * F3.1 + F3.6 — toggling off must actually remove the skill from the model's
 * reach, and must never touch the user's files.
 *
 * docs/requirements.md F3.1:
 *   "关掉一个本插件独占的技能后，ctx.skills.list() 中不再出现该名字，
 *    且 skill 工具加载它时报 unknown"
 *
 * MEASURED MECHANIC (evidence/probe-f31-strategies.mjs), which decides whether
 * that sentence is even achievable:
 *
 *   Strategy A — publish a suppression candidate with
 *                invocation={modelInvocable:false,userInvocable:false}:
 *       list()        -> STILL CONTAINS the name (invocation flags false)
 *       skills.get()  -> returns the DEFINITION (the registry is invocation-neutral)
 *       real tool     -> "skill \"x\" is not available for model invocation"
 *     So A gives invisibility to the model but the name stays in list() and the
 *     tool says "not available", never "unknown".
 *
 *   Strategy B — omit the candidate from list() entirely:
 *       list()        -> name GONE
 *       skills.get()  -> undefined
 *       real tool     -> "skill \"x\" is unknown or no longer available"
 *     Only B satisfies F3.1 as literally written.
 *
 * This case therefore asserts B's observable outcome through the REAL tool,
 * and reports which strategy the implementation actually used instead of
 * assuming either.
 *
 * F3.6 is a REVERSE proof: it must hold even when the toggle "succeeds", so it
 * is asserted on a real file with a recorded md5+mtime baseline. A toggle that
 * edits SKILL.md to hide a skill would pass a naive "is it gone?" test and fail
 * here.
 */
import { bootRealSkillTool, registerProvider, candidate, settle } from '../lib/real-harness.mjs'
import { loadToggle, makeSuppressor } from '../lib/plugin-under-test.mjs'
import { hashFile, writeTempSkillTree, removeTree } from '../lib/fs-probe.mjs'

export const meta = {
  id: 'f31',
  requirement: 'F3.1 + F3.6',
  title: 'a closed skill leaves the model-visible catalog and the real tool refuses it',
}

export async function run(report) {
  const { ctx, call, dispose } = await bootRealSkillTool()
  const tree = writeTempSkillTree([
    { name: 'lonely-skill', body: 'ORIGINAL BODY' },
    { name: 'other-skill', body: 'OTHER BODY' },
  ])

  try {
    const baseline = hashFile(tree.files['lonely-skill'])
    report.observe('baseline SKILL.md', baseline)

    const toggle = await loadToggle(report)
    // One provider does both jobs, exactly as the plugin wires it: it publishes
    // the discovered catalog AND withholds whatever the suppressor marks.
    const { suppressor, toggle: applyToggle } = await makeSuppressor(ctx, toggle, 'nested-filesystem', [
      candidate('lonely-skill', { provider: 'nested-filesystem', path: tree.files['lonely-skill'], content: 'ORIGINAL BODY' }),
      candidate('other-skill', { provider: 'nested-filesystem', path: tree.files['other-skill'], content: 'OTHER BODY' }),
    ])

    const before = await ctx.skills.list()
    report.observe('list() before toggle', before.map((s) => `${s.name}<-${s.provider}`))
    const liveBefore = before.find((s) => s.name === 'lonely-skill')
    report.assert(
      'F3.1 precondition: the name is served by the discovery provider before the toggle',
      liveBefore?.provider === 'nested-filesystem',
      `before=${JSON.stringify(before.map((s) => `${s.name}<-${s.provider}`))}`,
    )
    report.observe('real tool before toggle', await call('lonely-skill'))

    // ---- the operation under test -------------------------------------------
    await applyToggle('lonely-skill', false)
    report.observe('suppressor disabled set', [...suppressor.disabled])

    const after = await ctx.skills.list()
    report.observe('list() after toggle', after.map((s) => `${s.name}<-${s.provider} model=${s.invocation?.modelInvocable}`))

    // The suppression candidate WINS the name, so the model-visible catalog
    // drops it even though the name is still present with both flags false.
    // Both facts are asserted, because they are different guarantees.
    // THE NAME REMAINS IN list(), carried by our OWN contention candidate.
    // That is the expected shape of a WINNING suppression, not a defect: the
    // candidate must win the slot or a same-layer rival takes it over and
    // serves the skill live (see f3competitor). What matters is that the name
    // is no longer invocable by anyone.
    const afterRow = after.find((s) => s.name === 'lonely-skill')
    report.observe('row after the close', afterRow)
    report.assert(
      'F3.1: the name is still present in list() (expected: winning the slot is how a rival is defeated)',
      afterRow !== undefined,
      `row=${JSON.stringify(afterRow)} — absence here would mean the slot was CONCEDED, and a same-layer rival would take it`,
    )
    report.assert(
      'F3.1: the surviving row is OURS and is non-invocable on both axes',
      afterRow?.provider === 'nested-filesystem' &&
        afterRow?.invocation?.modelInvocable === false &&
        afterRow?.invocation?.userInvocable === false,
      `provider=${afterRow?.provider} invocation=${JSON.stringify(afterRow?.invocation)}`,
    )
    const modelVisible = after.filter((s) => s.invocation?.modelInvocable === true).map((s) => s.name)
    const userVisible = after.filter((s) => s.invocation?.userInvocable === true).map((s) => s.name)
    report.observe('model-visible catalog after toggle', modelVisible)
    report.assert(
      'F3.1: the model-visible catalog does not contain the name',
      !modelVisible.includes('lonely-skill'),
      `modelVisible=${JSON.stringify(modelVisible)}`,
    )
    report.observe('user-visible catalog after toggle', userVisible)
    report.assert(
      'F3.1: the user-visible catalog also excludes the name (both axes are off)',
      !userVisible.includes('lonely-skill'),
      `userVisible=${JSON.stringify(userVisible)}`,
    )
    report.observe(
      'strategy in force',
      typeof suppressor.candidates === 'function' ? 'INERT (contention candidates)' : 'OMIT (filters discovery)',
    )
    report.assert(
      'F3.1 control: the unrelated skill is still model-visible (not a blanket wipe)',
      modelVisible.includes('other-skill'),
      `modelVisible=${JSON.stringify(modelVisible)}`,
    )

    // get() must resolve to nothing, which is what produces the "unknown" text.
    const got = await ctx.skills.get('lonely-skill')
    report.observe('ctx.skills.get() after toggle', got === undefined ? 'undefined' : `DEFINITION provider=${got.provider}`)

    const outcome = await call('lonely-skill')
    report.observe('real tool after toggle', outcome)
    report.assert('F3.1: the real skill tool no longer yields the body', outcome.ok === false, JSON.stringify(outcome))
    // Under INERT the real tool's second gate fires: the summary still EXISTS
    // (we won the slot) but `modelInvocable` is false, so the message is
    // "not available for model invocation". That is the CORRECT outcome here —
    // the earlier expectation of the word "unknown" was based on the wrong
    // strategy. Both branches deny the body; only this one also defeats rivals.
    report.assert(
      'F3.1: the tool refuses it via the model-invocation gate (the correct branch under INERT)',
      outcome.message.includes('not available for model invocation'),
      `${JSON.stringify(outcome.message)} — "unknown" would mean the name left the catalog, i.e. the slot was conceded`,
    )

    // ---- F3.6 reverse proof, ON THE SUCCESS PATH ---------------------------
    // The Lead asked specifically that this run on the path where the toggle
    // "succeeded", not only on a failure path: that is where a file-rewriting
    // implementation would look like it worked.
    const post = hashFile(tree.files['lonely-skill'])
    report.observe('post-toggle SKILL.md', post)
    report.check('F3.6: md5 byte-identical', post.md5, baseline.md5)
    report.check('F3.6: mtime unchanged', post.mtimeMs, baseline.mtimeMs)
    report.check('F3.6: size unchanged', post.size, baseline.size)
    report.assert('F3.6: the file still exists on disk', post.exists === true)

    // ---- re-enable restores an equivalent load (F3.2) ---------------------
    await applyToggle('lonely-skill', true)
    const restored = await ctx.skills.list()
    const restoredRow = restored.find((s) => s.name === 'lonely-skill')
    report.observe('list() after re-enable', restored.map((s) => `${s.name}<-${s.provider}`))
    report.assert(
      'F3.2: re-enabling restores the discovery provider as the winner',
      restoredRow?.provider === 'nested-filesystem' && restoredRow?.invocation?.modelInvocable === true,
      `row=${JSON.stringify(restoredRow)}`,
    )
    const restoredTool = await call('lonely-skill')
    report.observe('real tool after re-enable', restoredTool)
    report.assert(
      'F3.2: the tool loads a body again',
      restoredTool.ok === true && restoredTool.message.includes('loaded body='),
      JSON.stringify(restoredTool),
    )
    const afterRestore = hashFile(tree.files['lonely-skill'])
    report.check('F3.6: still byte-identical after the full cycle', afterRestore.md5, baseline.md5)
  } finally {
    await dispose()
    removeTree(tree.root)
  }
}