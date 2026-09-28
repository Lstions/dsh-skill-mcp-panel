/**
 * 版本号管理门禁。
 *
 * 背景：这个仓库曾经把同一个版本号发过两次内容不同的提交 —— `2aa18f3` 与
 * `48cc721` 都写 `1.3.0`，但后者多 426 行、插件详情页的注册从 0 处变成 4 处。
 * 于是「1.3.0」无法唯一标识内容：拿到的是修好的那版还是空白的那版，看版本号
 * 判断不出来。`8078ad3` 与 `1735ed1` 同写 `1.2.0` 也是同样的问题。
 *
 * 这个测试守住三件事：
 *   1. `package.json` 的版本号合法，且 CHANGELOG 有对应的发布段；
 *   2. 发布段标题（`## [X.Y.Z]`）互不重复、按降序排列；
 *   3. README 与 lib/ 里不出现硬编码的包版本（版本只有一个来源）。
 *
 * 为什么重复检测只看 `## [X.Y.Z]` 而不看全文：CHANGELOG 里那张「版本历史」表
 * **故意**保留了两行 1.3.0 和两行 1.2.0，用来如实记录上面这次事故。发布段是
 * 权威发布记录，历史表是事故取证 —— 两者的重复语义不同，所以检测范围必须区分，
 * 否则要么漏检，要么把取证记录误判成回归。
 *
 * 运行：node test/version-check.mjs
 */
import { readFileSync } from 'node:fs'
import { makeChecker } from './harness.mjs'

const { results, check } = makeChecker()

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

const pkg = JSON.parse(read('package.json'))
const changelog = read('CHANGELOG.md')
const version = pkg.version

// ── 1. 版本号本身 ─────────────────────────────────────────────────────────
// 插件会写进 `dsh.profile` 的依赖表，非 semver 字符串会让 pnpm 拒绝。
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
check('package.json version is valid semver', SEMVER.test(version), true)

// 私有包不该带 build metadata —— 它不参与比较，只会让版本号看起来不一样。
check('version carries no build metadata', version.includes('+'), false)

const [, major, minor, patch] = SEMVER.exec(version) ?? []
check('major version is a number', typeof Number(major), 'number')
check('minor version is a number', typeof Number(minor), 'number')
check('patch version is a number', typeof Number(patch), 'number')

// ── 2. CHANGELOG 与 package.json 必须一致 ────────────────────────────────
// 收集发布段标题：`## [1.4.0] - 2026-09-28` 或 `## [1.4.0]`。
const RELEASE = /^##\s+\[([^\]]+)\]/gm
const releases = [...changelog.matchAll(RELEASE)].map((match) => match[1])

check('CHANGELOG declares at least one release', releases.length > 0, true)
check(`CHANGELOG documents the current version ${version}`, releases.includes(version), true)

// ── 3. 发布段标题互不重复 ────────────────────────────────────────────────
// 这是本次事故的直接回归检测。
const seen = new Map()
const duplicates = []
for (const entry of releases) {
  if (seen.has(entry)) duplicates.push(entry)
  else seen.set(entry, true)
}
check('no version is released twice', duplicates, [])

// ── 4. 发布段按降序排列 ──────────────────────────────────────────────────
// 最新版本必须在最前面，否则读者会以为顶部那版就是最新。
function orderOf(text) {
  const match = SEMVER.exec(text)
  if (match === null) return undefined
  const [, a, b, c, pre] = match
  // 预发布版本排在正式版本之前：1.0.0-rc.1 < 1.0.0
  return [Number(a), Number(b), Number(c), pre === undefined ? 1 : 0]
}
let descending = true
let outOfOrder
for (let index = 1; index < releases.length; index += 1) {
  const previous = orderOf(releases[index - 1])
  const current = orderOf(releases[index])
  if (previous === undefined || current === undefined) continue
  for (let field = 0; field < 4; field += 1) {
    if (previous[field] === current[field]) continue
    if (previous[field] < current[field]) {
      descending = false
      outOfOrder = `${releases[index - 1]} listed before ${releases[index]}`
    }
    break
  }
  if (!descending) break
}
check('releases are listed newest-first', descending ? 'ordered' : `out of order: ${outOfOrder}`, 'ordered')

// 顶部发布段必须是 package.json 的版本，否则「最新」是错的。
check('the newest CHANGELOG section is the current version', releases[0], version)

// ── 5. 版本号只有一个来源 ────────────────────────────────────────────────
// README 与 lib/ 里出现字面包版本号，迟早会与 package.json 不一致 —— 而
// 不一致的版本号正是这次要消灭的东西。
//
// 规则要精确，否则要么漏、要么误伤，两种都会让门禁失去意义：
//   - `lib/` 是运行时代码，任何字面版本号都是错的（版本只从 package.json 读）；
//   - README 的 **Versioning 章节**按设计就要写历史版本（事故取证），不能扫；
//   - README 其他位置出现的版本号**必须等于当前版本** —— 这样它不会悄悄过期。
//     直接禁止反而更糟：一个「安装 1.4.0」的示例会被删掉，而读者需要的正是它。
const literalVersion = new RegExp(`\\b${version.replaceAll('.', '\\.')}\\b`)
check('lib/ does not hard-code the package version', literalVersion.test(read('lib/index.js')), false)

const readme = read('README.md')
// 摘出 Versioning 章节（到下一个二级标题为止）。
const versioningStart = readme.indexOf('\n## Versioning')
const versioningEnd = versioningStart < 0 ? -1 : readme.indexOf('\n## ', versioningStart + 1)
const versioningSection =
  versioningStart < 0 ? '' : readme.slice(versioningStart, versioningEnd < 0 ? undefined : versioningEnd)
const readmeElsewhere = readme.slice(0, versioningStart < 0 ? undefined : versioningStart) +
  (versioningEnd < 0 ? '' : readme.slice(versioningEnd))

check('README has a Versioning section for historical versions', versioningStart >= 0, true)

// 只检查**本插件版本空间**内的字面量，即 major 相同的那些（当前 1.x）。
// README 里合法地出现着别的版本号，它们不是本插件的版本：
//   `DSH 0.1.7` / `DSH 0.2.0`  —— DSH 的版本
//   `100.64.0.10:3080`         —— IP 地址，四段数字
// 把这些算进来会让门禁变成噪声，而噪声门禁等于没有门禁。所以：
//   - 用词边界并要求不是四段点分（排除 IP）；
//   - 只要求 major 相同的版本号必须等于当前版本。
const majorPrefix = String(Number(major))
const candidate = new RegExp(`(?<![\\d.])${majorPrefix}\\.\\d+\\.\\d+(?![\\d.])`, 'g')
const elsewhereVersions = [...new Set([...readmeElsewhere.matchAll(candidate)].map((match) => match[0]))]
check(
  `every ${majorPrefix}.x version named outside the Versioning section is the current one`,
  elsewhereVersions.filter((entry) => entry !== version),
  [],
)
// 反向：Versioning 章节本身必须写上「可引用的版本从哪开始」，否则读者不知道该信哪个。
check('the Versioning section names the first referenceable version', versioningSection.includes(version), true)

// 反向检查：CHANGELOG 的顶部发布段**必须**提到当前版本，否则上面的检查会
// 因为「哪儿都没写」而假通过。
check('the version appears in the CHANGELOG release heading', changelog.includes(`## [${version}]`), true)

// ── 6. 历史记录不得被悄悄删掉 ────────────────────────────────────────────
// 事故取证表是这次修复的一半价值：删掉它，下一个人会以为从来没错过。
check('CHANGELOG keeps the forensic record of the duplicate releases', changelog.includes('同一个版本号'), true)
check('CHANGELOG states which version is first referenceable', changelog.includes('可引用的版本从'), true)

// 历史表里**故意**留着两行 1.3.0 与两行 1.2.0。有人看到重复可能会「顺手清理」，
// 那样取证就没了 —— 而这张表正是「这两行曾经同时存在」的证据。所以要求它们仍在。
const historyRows = (tableVersion) => [...changelog.matchAll(new RegExp(`^\\|\\s*${tableVersion.replaceAll('.', '\\.')}\\s*\\|`, 'gm'))].length
check('the history table still shows both 1.3.0 rows', historyRows('1.3.0') >= 2, true)
check('the history table still shows both 1.2.0 rows', historyRows('1.2.0') >= 2, true)
// 但发布段只能各有一个 —— 这两条断言合起来把「取证重复」与「重复发版」区分开。
check('the 1.3.0 release section appears exactly once', releases.filter((entry) => entry === '1.3.0').length, 1)
check('the 1.2.0 release section appears exactly once', releases.filter((entry) => entry === '1.2.0').length, 1)

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) console.log(`FAILED:\n${failed.map((entry) => `  - ${entry.label}`).join('\n')}`)
process.exit(failed.length === 0 ? 0 : 1)