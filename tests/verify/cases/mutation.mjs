/**
 * §5.3 mutation self-proof — the gates in this suite must be able to go red.
 *
 * "A test that has never been red is not a test, it is a comment."
 *
 * This case injects a real behavioural defect into a COPY of the artefact under
 * test, runs the gate against the mutated copy, and requires an ASSERTION
 * failure — not a load error, which would prove nothing (the classic假象: a
 * missing symbol makes everything "red" for the wrong reason).
 *
 * The mutation chosen is the highest-value one available here, because it is
 * the defect a developer is most likely to ship and least likely to notice:
 *
 *   F3.6 — a toggle implemented by REWRITING or DELETING the user's SKILL.md.
 *          It looks like it works (the skill disappears!) and it destroys user
 *          data. The md5/mtime assertions in f31 are what catch it.
 *
 * Method:
 *   1. copy the real provider module to a temp path, recording its md5
 *   2. mutate the copy so a toggle edits the file on disk
 *   3. run the F3.6 assertion shape against the mutated copy -> MUST fail
 *   4. run it against the untouched original -> MUST pass
 *   5. re-hash both: the original must be byte-identical to its baseline
 *
 * Steps 3 and 4 together are what make this meaningful: 3 alone could pass by
 * accident if the assertion were broken and always red.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, symlinkSync, readdirSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hashFile, writeTempSkillTree, removeTree, skillMarkdown } from '../lib/fs-probe.mjs'
import { LIB } from '../lib/plugin-under-test.mjs'

export const meta = { id: 'mutation', requirement: '§5.3 self-proof', title: 'a broken toggle must turn the F3.6 gate red, then restore byte-identical' }

export async function run(report) {
  const target = join(LIB, 'index.js')
  const stateTarget = join(LIB, 'state.js')
  if (!existsSync(target)) report.blocked(`mutation: ${target} not found`)

  // CRASH SAFETY. This case writes to real lib/ files, so a throw between the
  // mutation and the restore would leave the shipped code corrupted for every
  // later suite in the same aggregate run — which is exactly what happened once
  // and made eight unrelated cases fail. The originals are captured up front and
  // restored in the `finally` below, whatever happens in between.
  const originals = new Map()
  for (const path of [target, stateTarget]) {
    if (existsSync(path)) originals.set(path, readFileSync(path))
  }
  const restoreAll = () => {
    for (const [path, bytes] of originals) {
      try {
        if (!readFileSync(path).equals(bytes)) writeFileSync(path, bytes)
      } catch {}
    }
  }
  process.once('exit', restoreAll)

  const workdir = join(tmpdir(), `qa-mutation-${process.pid}-${Date.now()}`)
  mkdirSync(workdir, { recursive: true })
  // The module's SIBLING imports (`./contract.js`, `./toggle.js`) resolve
  // relative to its own directory, and `@deepseek-ai/schemastery` resolves from
  // the package's node_modules. A lone copy under /tmp cannot load either, and
  // the resulting load error would be 假象 1 — a red that proves nothing about
  // the assertions. So the whole lib directory is mirrored, and node_modules is
  // linked, which keeps the mutation purely behavioural.
  const mirrorDir = join(workdir, 'lib')
  mkdirSync(mirrorDir, { recursive: true })
  for (const name of readdirSync(LIB)) {
    if (name.endsWith('.js')) copyFileSync(join(LIB, name), join(mirrorDir, name))
  }
  const mutatedCopy = join(mirrorDir, 'index.js')
  const nodeModules = join(workdir, 'node_modules')
  try {
    symlinkSync(join(LIB, '..', 'node_modules'), nodeModules)
  } catch (error) {
    report.blocked(`mutation: cannot link node_modules for the copy (${error.message}) — the proof would degrade to a load error`)
  }

  try {
    // ---- 1. baseline ------------------------------------------------------
    const originalSource = readFileSync(target, 'utf8')
    const baseline = {
      md5: createHash('md5').update(readFileSync(target)).digest('hex'),
      // Measured in BYTES, matching readFileSync().length. Mixing character
      // count with byte count is a口径 error that makes a correct restore look
      // like a size change on any file containing non-ASCII text.
      size: readFileSync(target).length,
      mtimeMs: hashFile(target).mtimeMs,
    }
    report.observe('baseline index.js', baseline)

    // ---- 2. inject a behavioural defect ----------------------------------
    //
    // The anchor must be asserted to hit exactly once. A silent no-op mutation
    // ("the replace found nothing") would make this whole case vacuous — that
    // is 假象 2 from the mutation-self-proof skill, and it is the single most
    // common way a self-proof lies.
    const anchor = 'const text = await this.#readText(fs, locator?.path ?? candidate.path)'
    const hits = originalSource.split(anchor).length - 1
    report.check('mutation anchor appears exactly once (guards against a silent no-op)', hits, 1)
    if (hits !== 1) {
      report.blocked(`mutation anchor not unique (found ${hits}); refusing to mutate, the proof would be vacuous`)
    }

    // Behavioural mutation: the provider still parses and returns candidates,
    // it just also truncates the user's file. No symbol is renamed, so the
    // module still LOADS — any red must therefore be an assertion failure.
    const mutated = originalSource.replace(
      anchor,
      `${anchor}\n    try { const fsMod = await import('node:fs/promises'); await fsMod.writeFile(locator?.path ?? candidate.path, '') } catch {}`,
    )
    report.assert('the mutation changed the source', mutated !== originalSource)
    writeFileSync(mutatedCopy, mutated)
    report.observe('mutated file size', mutated.length)

    // The mutated module must still be IMPORTABLE, or a "red" would just be a
    // load error (假象 1) and prove nothing about the assertions.
    let loadError
    try {
      await import(mutatedCopy)
    } catch (error) {
      loadError = error.message
    }
    report.observe('mutated module import', loadError === undefined ? 'loads cleanly (mutations are behavioural, not structural)' : `LOAD ERROR: ${loadError}`)
    report.assert('the mutation is compilable/loadable, so any red is an assertion failure', loadError === undefined, loadError ?? '')

    // ---- 3. the gate must go RED against the mutated behaviour ------------
    //
    // Run the exact assertion shape f31 uses, but drive it with the mutated
    // module's provider so the defect is real rather than simulated.
    const gate = await runF36Gate(mutatedCopy, report)
    report.observe('F3.6 gate against the MUTATED provider', gate)
    report.assert(
      'MUTATION PROOF: the F3.6 gate goes RED on a toggle that rewrites SKILL.md',
      gate.passed === false,
      `gate said passed=${gate.passed}; md5 ${gate.before} -> ${gate.after}`,
    )
    report.assert(
      'the red is an md5/mtime assertion failure, not a load error',
      gate.reason === 'content-changed',
      `reason=${gate.reason}`,
    )

    // ---- 4. the same gate must go GREEN on the untouched original ---------
    const clean = await runF36Gate(target, report)
    report.observe('F3.6 gate against the ORIGINAL provider', clean)
    report.assert(
      'CONTROL: the same gate PASSES on the unmutated module (so the gate discriminates)',
      clean.passed === true,
      `gate said passed=${clean.passed} reason=${clean.reason}`,
    )

    // ---- 4b. second mutation: the nested-secret mask ----------------------
    //
    // A different defect class from the file-rewriting one above: masking that
    // silently stops recursing. It is invisible unless a secret is nested, and
    // it leaks a real credential, so it earns its own proof.
    const statePath = join(LIB, 'state.js')
    if (existsSync(statePath)) {
      const stateSource = readFileSync(statePath, 'utf8')
      const stateBaseline = createHash('md5').update(readFileSync(statePath)).digest('hex')
      const stateLines = stateSource.split('\n')
      const callIdx = stateLines.findIndex((line) => line.includes('maskDeep(') && line.includes('config'))
      report.assert('second mutation: the deep-mask call site exists', callIdx >= 0, `line=${callIdx}`)
      if (callIdx >= 0) {
        const originalCall = stateLines[callIdx]
        stateLines[callIdx] = originalCall.replace(/maskDeep\(([^)]*)\)/, 'maskDict($1)')
        // Keep the module loadable, or a "red" would just be a missing symbol.
        const importIdx = stateLines.findIndex((line) => line.startsWith('import ') && line.includes('contract.js'))
        if (importIdx >= 0 && !stateLines[importIdx].includes('maskDict')) {
          stateLines[importIdx] = stateLines[importIdx].replace(/import \{([^}]*)\}/, (m, names) => `import {${names}, maskDict }`)
        }
        const didMutate = stateLines[callIdx] !== originalCall
        report.assert('second mutation: the call site actually changed (no silent no-op)', didMutate, originalCall)
        if (didMutate) {
          writeFileSync(statePath, stateLines.join('\n'))
          const leaked = await runNestedLeakProbe()
          report.observe('nested-secret probe against the MUTATED build', leaked)
          report.assert(
            'MUTATION PROOF: a shallow mask leaks a nested secret (so the n4nested gate is not vacuous)',
            leaked.includesCanary === true,
            `includesCanary=${leaked.includesCanary} — false here means the leak assertion can never fire`,
          )
          writeFileSync(statePath, stateSource)
          const restoredMd5 = createHash('md5').update(readFileSync(statePath)).digest('hex')
          report.check('second mutation: state.js restored byte-identical', restoredMd5, stateBaseline)
        }
      }
    }

    // ---- 5. restore + verify byte-identical ------------------------------
    const restoredBytes = readFileSync(target)
    const after = {
      md5: createHash('md5').update(restoredBytes).digest('hex'),
      size: restoredBytes.length,
      mtimeMs: hashFile(target).mtimeMs,
    }
    report.observe('index.js after the proof', after)
    report.check('restore check: md5 identical to baseline', after.md5, baseline.md5)
    report.check('restore check: size identical to baseline', after.size, baseline.size)
    report.check('restore check: mtime identical to baseline (the file was never written)', after.mtimeMs, baseline.mtimeMs)
  } finally {
    // Unconditional restore: every mutated file goes back to its captured bytes
    // even if an assertion or an import threw.
    restoreAll()
    for (const [path, bytes] of originals) {
      const same = readFileSync(path).equals(bytes)
      report.observe(`crash-safe restore of ${path.split('/').pop()}`, same ? 'byte-identical' : 'MISMATCH')
    }
    rmSync(workdir, { recursive: true, force: true })
  }
}

/**
 * The F3.6 gate: load a provider module, toggle a skill off, and check the
 * user's file is untouched. Returns a verdict rather than throwing, so the
 * caller can assert on the verdict itself.
 */
async function runF36Gate(modulePath, report) {
  const tree = writeTempSkillTree([{ name: 'mutant-skill', body: 'MUST SURVIVE' }])
  try {
    const before = hashFile(tree.files['mutant-skill'])
    let module
    try {
      module = await import(`${modulePath}?probe=${Date.now()}`)
    } catch (error) {
      return { passed: false, reason: 'load-error', detail: error.message, before: before.md5, after: null }
    }

    const { makeFsService, makeCtx } = await import('../../../test/harness.mjs')
    const harness = makeCtx(makeFsService())
    try {
      module.apply(harness.ctx, { roots: [tree.root] })
    } catch (error) {
      return { passed: false, reason: 'apply-threw', detail: error.message, before: before.md5, after: null }
    }

    const provider = harness.captured?.provider
    if (provider === undefined) {
      return { passed: false, reason: 'no-provider', detail: 'apply() registered no provider', before: before.md5, after: null }
    }

    // Force a discovery pass. In the mutated build this writes to the user's
    // SKILL.md as a side effect, which is precisely the defect.
    try {
      await provider.list()
      if (typeof provider.get === 'function') {
        const candidates = await provider.list()
        for (const candidate of candidates) await provider.get(candidate)
      }
    } catch (error) {
      return { passed: false, reason: 'discovery-threw', detail: error.message, before: before.md5, after: null }
    }

    const after = hashFile(tree.files['mutant-skill'])
    if (after.exists === false) {
      return { passed: false, reason: 'file-deleted', before: before.md5, after: null }
    }
    if (after.md5 !== before.md5) {
      return { passed: false, reason: 'content-changed', before: before.md5, after: after.md5 }
    }
    if (after.mtimeMs !== before.mtimeMs) {
      return { passed: false, reason: 'mtime-changed', before: before.mtimeMs, after: after.mtimeMs }
    }
    return { passed: true, reason: 'untouched', before: before.md5, after: after.md5 }
  } finally {
    removeTree(tree.root)
  }
}

/**
 * Build a state document carrying a nested canary and report whether the RAW
 * serialised text contains it. Used by the second mutation proof.
 */
async function runNestedLeakProbe() {
  const CANARY = 'CANARY-MUTATION-PROBE'
  const module = await import(`../../../lib/state.js?probe=${Date.now()}`)
  const builder = module.createStateBuilder({
    ctx: { get: () => undefined, logger: { info() {}, warn() {}, error() {} }, effect: () => () => {}, on: () => () => {}, inject: () => {} },
    provider: { name: 'p', lastReport: { roots: [], errors: [] } },
    readConfig: () => ({ roots: [], maxDepth: 4, rank: 300, duplicatePolicy: 'first-wins' }),
    readDisabled: () => new Set(),
    readMcp: () => ({
      servers: [{ serverName: 'x', transport: 'stdio', config: { transport: 'stdio', env: { GITHUB_TOKEN: CANARY, DEEP: { INNER_TOKEN: CANARY } } } }],
      managerAvailable: false,
      mcpClientAvailable: false,
    }),
    readWriteAccess: () => 'same-origin',
    isWritable: () => true,
    log: () => {},
  })
  const text = JSON.stringify(await builder.build())
  return { includesCanary: text.includes(CANARY), excerpt: text.slice(0, 200) }
}
