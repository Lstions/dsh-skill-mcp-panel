/**
 * 用 DSH 自己的兼容性判定函数检查本插件的 peer 范围。
 *
 * 为什么需要这个门禁
 *
 * DSH 0.2.0-rc.1 上线后，插件在插件列表里被标成「异常」：
 *
 *   dsh-skill-mcp-panel@1.3.0 与 DSH 0.2.0-rc.1 不兼容
 *   （要求 @deepseek-ai/dsh-settings ^0.1.7-alpha.1）
 *
 * 但实际不兼容并不存在 —— settings / skill / webserver / tool 的 API 一个都没少，
 * 连 plugins.detail.section 的 subject 契约都一字未改。真正的原因只是范围写法：
 * npm 的预发布语义下 `^0.1.7-alpha.1` 匹配不到 0.2.0（`^0.x` 锁定次版本号），
 * 于是 0.2.0 被判为不满足。
 *
 * 这类问题有两个特点，所以值得一道门禁而不是靠人记得：
 *   1. 它是**静默**的：插件照常安装、照常加载，只是被标记异常并被拒绝启用；
 *   2. 它**伪装成代码不兼容**：报错说「可能导致崩溃或数据丢失」，让人以为要大改。
 *
 * 这个测试直接调用 DSH 装好的 `evaluatePluginCompatibility`，用真实规则而不是
 * 自己复刻的 semver 逻辑判定，所以规则变了它也会跟着变。
 *
 * 运行：node test/compat-check.mjs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeChecker } from './harness.mjs'

const { results, check } = makeChecker()

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// ── 载入 DSH 自己的判定函数 ───────────────────────────────────────────────
// 优先用部署里的 app-boot（就是运行时真正执行判定的那份代码）；找不到时退回
// 原型仓库的源码，这样在开发机上也能跑。
function locateAppBoot() {
  const profileDir = process.env.DSH_PROFILE_DIR ?? join(homedir(), '.dsh', 'profiles', 'web')
  const literals = [
    join(profileDir, '..', 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'),
    join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'),
  ]
  for (const candidate of literals) if (existsSync(candidate)) return candidate
  const root = process.env.DSH_PNPM_STORE ?? join(homedir(), '.local', 'share', 'pnpm', 'global', 'v11')
  if (!existsSync(root)) return undefined
  for (const store of readdirSync(root)) {
    const pnpm = join(root, store, 'node_modules', '.pnpm')
    if (!existsSync(pnpm)) continue
    for (const entry of readdirSync(pnpm)) {
      if (!entry.startsWith('@deepseek-ai+dsh-app-boot@')) continue
      const lib = join(pnpm, entry, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')
      if (existsSync(lib)) return lib
    }
  }
  return undefined
}

// 原型仓库的源码入口（TS），仅在部署缺失时兜底。
function locateSourceCheckout() {
  const checkout = process.env.DSH_CHECKOUT ?? join(homedir(), 'workspace', 'deepseek-harness')
  const source = join(checkout, 'packages', 'boot', 'app-boot', 'src', 'plugin-compatibility.ts')
  return existsSync(source) ? source : undefined
}

const appBoot = locateAppBoot()
check('found the deployment\'s compatibility checker', appBoot !== undefined, true)
if (appBoot === undefined) {
  console.log('  原型源码:', locateSourceCheckout() ?? '(未找到)')
  const failed = results.filter((entry) => !entry.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(1)
}
console.log(`using ${appBoot}`)

const { evaluatePluginCompatibility } = await import(pathToFileURL(appBoot).href)
check('evaluatePluginCompatibility is exported', typeof evaluatePluginCompatibility, 'function')

// ── peer 范围必须覆盖插件实际支持的运行时 ────────────────────────────────
// 这些是插件真正验证过、且 API 已逐项核对存在的版本。新增支持时在这里加一行；
// 一个版本如果没验证过就不要写进来 —— 门禁宽于事实等于没有门禁。
const SUPPORTED = ['0.1.7-alpha.1', '0.1.7-rc.2', '0.2.0-rc.1']
// 已知不支持：0.1.6 及更早用的是 installSection（0.1.7 已移除），0.3.0 尚未验证。
const UNSUPPORTED = ['0.1.6-alpha.2', '0.3.0']

for (const runtime of SUPPORTED) {
  const issue = evaluatePluginCompatibility(manifest, {}, runtime)
  check(
    `dsh ${runtime} is accepted by this plugin's peer ranges`,
    issue === undefined ? 'accepted' : `REJECTED: ${JSON.stringify(issue.peers)}`,
    'accepted',
  )
}
for (const runtime of UNSUPPORTED) {
  const issue = evaluatePluginCompatibility(manifest, {}, runtime)
  check(
    `dsh ${runtime} is NOT claimed (unverified or API-incompatible)`,
    issue === undefined ? 'accepted (range too wide)' : 'rejected',
    'rejected',
  )
}

// ── 范围写法本身也要检查 ─────────────────────────────────────────────────
// 一条容易再犯的规则：`^0.x.y` 在 semver 里锁定次版本号，所以 `^0.1.7-alpha.1`
// 永远匹配不到 0.2.0。这正是本次事故的根因，固化成断言。
const peers = manifest.peerDependencies ?? {}
for (const [name, range] of Object.entries(peers)) {
  // 只有 @deepseek-ai/dsh 与 @deepseek-ai/dsh-* 会被判定，其余名称跳过。
  if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
  check(`${name} must not use a caret range on a 0.x version`, /^\^0\./.test(range), false)
}

// peer 必须声明为 optional：本插件的宿主依赖在安装期不一定就位，写成必需会让
// pnpm 在安装时报 unmet peer。
const meta = manifest.peerDependenciesMeta ?? {}
for (const name of Object.keys(peers)) {
  check(`${name} is declared optional (the host supplies it)`, meta[name]?.optional, true)
}

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) console.log(`FAILED:\n${failed.map((entry) => `  - ${entry.label}`).join('\n')}`)
process.exit(failed.length === 0 ? 0 : 1)