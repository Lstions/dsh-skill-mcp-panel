# 验收矩阵 · dsh-skill-mcp-panel

> 维护者：**qa-verify**（task-5）。最终结论由 testB（task-6）在本文件末尾追加。
> 采集时刻：**2026-09-18**。所有数字都在本文件里给出**分母 + 口径 + 可复跑命令**。
> 开发的自测**不作为**验收证据；下表每一行的「结果」都由独立用例在本机跑出。

---

## 0. 怎么跑（任何人可直接执行）

```bash
cd /home/sun/workspace/dsh-plugins

# 独立验收套件（本文件的主要证据来源）
node tests/verify/run.mjs              # 全部用例，含原始观测
node tests/verify/run.mjs f31 n4       # 只跑指定用例
node tests/verify/run.mjs --list       # 列出用例与对应需求编号
node tests/verify/run.mjs --json       # 机器可读汇总

# 全量门禁（开发自测 + 独立验收）
cd skill-mcp-panel && node test/all.mjs  # 任一套件红 → 整体 exit 1
```

**三种结果，没有第四种**：`PASS` / `FAIL` / `BLOCKED`。
`BLOCKED` = 功能尚未落地，**不算通过，也不计入证据**。整体退出码只看 FAIL。

---

## 1. 真实规模口径（先定分母，后谈结论）

任务书里流传过 **139**，Lead 的更正里是 **135**。两者都不是无条件成立的数字 —— 它们是**不同口径**的产物：

| 口径 | 计数 | 命令 |
|---|---|---|
| 原始 SKILL.md 文件（`/home/sun/.hermes/skills` 全树，含 `.archive`） | **164** | `find -L /home/sun/.hermes/skills -name SKILL.md \| wc -l` |
| 按 realpath 去重（`.agents/skills` 是符号链接别名） | **164** | 同上（无重复硬链接） |
| 原始技能目录名去重 | **163** | `github` 出现 2 次 |
| **插件实际产出**（`includeHidden=false` + `maxDepth=4` + 名字去重） | **135** | `node test/realtree.mjs` |
| 原始树的 SKILL.md frontmatter 名去重 | **163** | 与目录名一致 |

**135 是这样来的**（口径链，可复核）：

```
164 原始文件
- 28 落在隐藏目录（.archive）        # includeHidden:false
-  0 超过 maxDepth=4
-  1 被同名冲突合并（github 2 文件 → 1 候选）
= 135 技能 / 135 唯一名 / 1 处冲突
```

**「24 分类」是口径依赖的 —— 换一个口径就是 34，务必别只引数字：**

| 口径 | 计数 | 成员差异（实测） |
|---|---|---|
| **(a) 直接父目录名** —— `test/realtree.mjs` 的算法 | **24** | 含伪分类 `(root)`、`evaluation`、`inference`、`models`；把 depth-1 技能归入伪分类 |
| **(b) 相对根的完整分类路径** | **34** | 保留 `mlops/evaluation` 等 4 个带前缀的分类；另有 10 个 depth-1 技能目录各自成类 |

两个口径的**成员集合并不相同**，(a) 独有的 4 个是 `(root)`/`evaluation`/`inference`/`models`，
(b) 独有的 14 个是 10 个 depth-1 目录加 4 个 `mlops/*`。
`node tests/verify/run.mjs scale` 会把两个口径的成员**逐条打印**出来。

> 任务书里的「24 分类」用的是口径 (a)。本文档 §2 矩阵与 §1 分母表中的分类数**一律指 (a)**，
> 而 `scale` 用例的 `DENOMINATOR` 一行按 (b) 报 34 —— 两者不是矛盾，是口径不同。

**为什么必须写清楚**：这两个数曾被当成同一个数使用（139 与 135 的混淆也是同一类问题）。
数字对上不等于集合相同 —— 这是一次**巧合守恒**的实例，故在此显式记录。

**唯一真实同名冲突**：`github`
```
/home/sun/.hermes/skills/github/github/SKILL.md
/home/sun/.hermes/skills/software-development/github/SKILL.md
```
两个不同的真实文件 → 计入冲突。符号链接别名（`.agents` → `.hermes`）**不算冲突**（F4.4 已独立验证）。

---

## 2. 验收矩阵

| 编号 | 需求要点 | 验证方式 | 命令 / 用例名 | 预期结果 | 结果 |
|---|---|---|---|---|---|
| **F1** | 分层多根发现 | 真实树重算分母 | `node tests/verify/run.mjs scale` | 135 技能 / 冲突 1 / 别名零重复 | **PASS** |
| **F1** | 既有发现行为不退化 | 开发既有套件 | `node test/run.js` | 36 checks 全绿 | **PASS** |
| **F2** | 清单条目数 == `ctx.skills.list()` | 同一 ctx 双读比对 | `verify f44` · `state skill count equals the live registry count` | 两数相等 | **PASS** |
| **F2** | 每条 `path` 真实存在 | 冲突候选 realpath 校验 | `verify f44` · `candidates are distinct files` | 无 `MISSING:` | **PASS** |
| **F3.1** | 关闭后模型目录不再含该名字 | **真实 `skill` 工具**实测 | `verify f31` · `the model-visible catalog does not contain the name` | 不含 | **PASS** |
| **F3.1** | 关闭后 `skill` 工具拒绝加载 | 真实工具 `execute()` | `verify f31` · `the real skill tool no longer yields the body` | 抛错 | **PASS** |
| **F3.1** | **同层竞争者存在时关闭仍生效** | 构造同层 rival | `verify f3competitor` | rival 被击败 | **PASS** |
| **F3.1** | 关闭不误伤其它技能 | 对照组 | `verify f31` · `control: the unrelated skill…` | 仍在 | **PASS** |
| **F3.1** | 缓存失效（防假绿） | 前后两次 `list()` 必不同 | `verify f3cache` | before ≠ after | **PASS** |
| **F3.2** | 打开后等价恢复 | 真实工具复载 | `verify f31` · `the tool loads a body again` | 载入成功 | **PASS** |
| **F3.3** | 近层覆盖时**不得谎报已关闭** | 真实 preset scope | `verify f33` | `effective=false` + `shadowedBy` | **PASS** |
| **F3.6** | 关闭**绝不改动** SKILL.md | md5 + mtime + size | `verify f31` · 三条 `byte-identical` | 三者全等 | **PASS** |
| **F4.1** | 冲突含 winner + 全部 losers + policy + resolvable | 结构断言 | `verify f44` | 字段齐全 | **PASS** |
| **F4.2** | winner 与真实注册表一致 | 逐名核对 provider+path | `verify f44` · `every conflict winner matches the registry` | mismatches = 0 | **PASS** |
| **F4.4** | 符号链接别名不算冲突 | **真实** `.agents`→`.hermes` | `verify f44` | 无别名对冲突 | **PASS** |
| **F4.5** | 无冲突时不是空白/报错 | 类型断言 | `verify f44` · `conflicts is an array` | 是数组 | **PASS** |
| **F5.4** | 工具数来自真实 `ctx.tools` | 活体注册表 | `verify f63` · `really registered its tool` | `mcp__live-fixture__ping` | **PASS** |
| **F6.3** | 死 server **不得**报 applied | 真实子进程 + 不可达端口 | `verify f63` | `restart-required`，非 applied | **PASS** |
| **F6.3** | 失败原因可读 | `detail` 非空 | `verify f63` | 含原因 | **PASS** |
| **F6.3** | 失败后声明仍持久化 | 声明数组 | `verify f63` · `still declared` | 仍在 | **PASS** |
| **F6.3** | **正常 server 不受影响**（防矫枉过正） | 活体 fixture | `verify f63` · `control` | `applied` + 工具存在 | **PASS** |
| **F6.5** | 删除后工具从注册表消失 | 活体注册表复读 | `verify f63` | 工具为空 | **PASS** |
| **N4** | 跨源 `Origin` 被拒 | 真实 handler | `verify n4` | 403 | **PASS** |
| **N4** | 非 JSON content-type 被拒 | 3 种类型 | `verify n4` | 全部 403 | **PASS** |
| **N4** | 同源 JSON **不被误拒**（对照） | 真实 handler | `verify n4` · `control` | 200 | **PASS** |
| **N4** | GET 体**不含真密钥** | canary 子串搜索 | `verify n4` | canary 不出现 | **PASS** |
| **N4** | 密钥字段**仍在但被掩码** | 掩码存在性 | `verify n4` | 含 `••••••` | **PASS** |
| **N4** | 掩码写回保住真密钥 | 提交掩码后复读 | `verify n4` | canary 不变 | **PASS** |
| **N5** | state 接口 P95 < 500ms | 真实 handler 60 采样（预热 10 次丢弃，nearest-rank） | `verify perf` | P95 ≈ **0.45–0.53ms**（多次运行区间） | **PASS** |
| **N5** | 测量非空转 | payload 技能数 | `verify perf` | 135（非空文档） | **PASS** |
| **N6** | 无 `pluginManager` → 禁用不崩 | 缺服务 ctx | `verify degrade` | `managerAvailable=false` | **PASS** |
| **N6** | 无 `settings` → 只读不崩 | 缺服务 ctx | `verify degrade` | 读成功 | **PASS** |
| **N6** | 无 MCP 包 → 明确说明 | `describe()` | `verify degrade` | 布尔字段，不抛 | **PASS** |
| **§5.3** | 门禁**确实能变红** | 变异自证 | `verify mutation` | 红→恢复→哈希一致 | **PASS** |

> **P95 是波动的**：同一条件下多次运行得到 0.45ms / 0.53ms 等不同值（偶发单次尖峰达 3.06ms）。
> 因此矩阵给的是**区间**而非单点，并附完整原始采样。`scale` 的技能数同理 —— 技能树是活的，
> testB 复核时必须**重跑**而不是引用本行数字。

**汇总（2026-09-18 最终）**：`verify: 13 passed, 0 failed, 0 blocked`，**114/114 断言通过**。
全量门禁 `node test/all.mjs` → **ALL SUITES PASSED**，exit 0，`SUMMARY suites=10 failed=0 blocked=0`。
10 个套件 = 4 个既有 + 4 个 host（devA）+ 2 个 mcp（devB）+ 独立验收（13 用例）。

---

## 3. 通过区

以下每一项都有可复跑命令与上面的原始输出为证。

### 3.1 F3 技能开关
- **本套件自身曾用错策略，已纠正（重要）。** `tests/verify/lib/plugin-under-test.mjs`
  的 `makeSuppressor` 早期**过滤掉**禁用候选（= OMIT），于是 `f31`/`f3cache` 断言的是
  **夹具的错误策略**而非产品行为。发现路径有两条：Lead 的实测对比、以及 devA 指出
  `f3cache` 仍在用 OMIT 判据（「名字列表必须变化」）。
  **修正后判据改为「行的 payload 变化」**：`gate-b:true → gate-b:false`，而不是名字消失。
  这是本任务中最有价值的一次自我纠错 —— 一个断言错了会同时产生**假红**（对正确代码报错）
  与**假绿**（对错误策略放行）。
- **策略经独立判定为「INERT 竞争候选」而非「省略候选」**，且这是**正确的**。
  我在 `/tmp/qa-probe/samelayer.mjs`（已存为 `tests/verify/evidence/probe-same-layer.mjs`）
  构造同层 rival 实测：
  ```
  STRATEGY INERT  list: x<-nested-filesystem model=false  model sees []  get undefined  tool "not available"  => 关闭生效 YES
  STRATEGY OMIT   list: x<-competitor        model=true   model sees [x] get competitor body  tool 加载成功   => 关闭生效 NO
  ```
  **省略候选会让出名字槽位，同层 rival 立刻接手 —— 使用者的「关闭」被静默无视。**
  因此「关闭后名字仍在 `list()` 里」是**预期形状**，不是缺陷；有意义的断言是
  `list().filter(isModelInvocable)` 不含该名字。
- devA 的实现（`lib/index.js` 返回 `[...visible, ...suppressions]`）经端到端实测为 INERT，**正确**。
- **F3.3 的边界已被实测钉死**：global 层压制**赢不过** preset scope（近层优先于 rank）。
  本机 preset 的 `skill-filesystem` 只扫深度 1 → **10 个** depth-1 技能归 preset 层所有，
  在 global 视角下**关不掉**，必须报 `effective=false` + `shadowedBy`。用例 `f33` 已覆盖。

### 3.2 安全（N4）
- 跨源、三种非 JSON content-type 全部 403；同源 JSON 200（对照组证明门禁有分辨力，不是「一律拒绝」）。
- GET 体用**唯一 canary** 做子串搜索，未出现；同时断言掩码 `••••••` **存在** ——
  否则「字段被整个丢掉」也会让泄漏检查通过，两者必须区分。
- 掩码写回后 canary 不变。

### 3.3 MCP 死服务器（F6.3）
`failOnStartupError` 默认 `false` 是**静默假绿**的典型来源：只 await fiber 会对从未启动的服务器报 applied。
我独立用**真实子进程**验证：不存在的 command 与不可达端口都得到 `restart-required` 且带原因，
而**正常 fixture server 仍报 `applied` 且 `mcp__live-fixture__ping` 真的出现在注册表**（防止修法矫枉过正）。

### 3.3b 嵌套密钥（N4 深度维度）
`contract.js` 的 `maskDict` **只掩码顶层键**，因此 `{env:{GITHUB_TOKEN}}` 这类嵌套形状会泄漏真值。
devA 在 `lib/state.js` 引入递归 `maskDeep` 修正。我**独立验证**：
- `maskDict` 对嵌套形状**确实泄漏**（`n4nested` 断言这一点，防止有人误删 `maskDeep`）；
- `maskDeep` 在深度 1/2/3 全部掩码，且**保留非密钥字段**（否则配置面板就废了）；
- **端到端**：声明 → `createMcpManager.describe()` → `createStateBuilder.build()` →
  `GET /skill-mcp-panel/state` 的**原始响应文本里搜不到 canary**（子串搜索，不是结构遍历 ——
  结构断言会漏掉它忘记访问的那一层）。

**一个如实记录的中间面**：`mcpManager.describe()` 自身对**深度 ≥2** 的密钥仍会泄漏
（它调用浅层 `maskDict`）。经追踪，该输出**只**经 `readMcp()` 进入 `state.build()`，
而 `state.js` 会重新深度掩码，因此**浏览器拿到的线上文档是安全的**。
但它是一个**潜在隐患**：任何新的消费者若直接用 `describe()` 就会泄漏。
已写入 §4 作为「风险记录（非缺陷）」。

### 3.3c 活体验证（Lead 在 3199 实例上独立执行，已完成并清理）
**这是本任务唯一的真实宿主验证，不是我跑的**，故单列并注明来源：进程已终止、端口已释放、settings 残留已移除。

```
GET /skill-mcp-panel/state                 -> HTTP 200
  version 1 | revision 2 | writable true | writeAccess same-origin
  roots 3 | skills 135 | conflicts 1
  mcp.servers 0 | managerAvailable true | mcpClientAvailable true
  errors: ["root /home/sun/.dsh/skills: not a directory"]   (该目录确实不存在，ls 已核实)
  conflicts: ["github"]

POST /skill-mcp-panel/apply {revision:2, ops:[{kind:'skill.toggle', name:'api-endpoint-verification', enabled:false}]}
  -> HTTP 200 | status applied
  row: enabled=false, effective=true, modelInvocable=false, userInvocable=false,
       provider=nested-filesystem, rank=0
  SKILL.md md5  b61a980f...ed2e -> b61a980f...ed2e  (未变)
  mtime/size    1785652341/8093 -> 1785652341/8093  (未变)
  撤销后: any disabled left? []
```
→ **135 技能 / 1 冲突与 `realtree` 一致**，`github` 冲突正确，root 报错真实。
→ **F3.6 得到活体反向证明**：压制候选赢下名字且两个 invocation 标志均为 false，而**用户文件一个字节未动**。
→ **修订栅栏有效**：过期 revision 提交得到 **409 refused**（`results: ["undefined:refused"]`），无脏写入 —— 这是正确防护，不是缺陷。

> **⚠️ 语义细节（必须如实记录，已按 Lead 要求写入 §5）**：关掉一个**第一层**技能时得到
> `effective=true`。经查**不是 bug**：`effective` 按「当时可发现的所有 scope 视图」读回判定，
> 而 **scope 是会话懒创建的** —— 新建实例**没有活动会话**，故当时不存在 preset scope 视图，
> 全局视图里我们的压制候选确实是唯一胜者。有会话时会正确翻成 `effective=false` + `shadowedBy`
> （由 `f33` 以合成 scope 覆盖，13/13 复跑通过）。

### 3.4 变异自证（§5.3，本套件自身的可信度）
三条独立的变异，均为**断言失败**（不是加载错误）：
1. **F3.6 门禁**：把 provider 改成「读文件时顺手清空用户的 SKILL.md」→ 门禁红（`reason=content-changed`）→
   未变异的原件仍绿 → 恢复后 md5/size/mtime **三者与基线全等**。
2. **F3.1 竞争门禁**：把 `return [...visible, ...suppressions]` 改成 `return [...visible]`（即退回 OMIT）→
   `f3competitor` **5 条断言变红** → 恢复后哈希一致、复绿。
3. **缓存失效门禁**：从 `makeSuppressor.toggle()` 删掉 `invalidateCache()` →
   `f3cache` **3 条断言变红**（含新判据 `gate-b` 未翻转）→ 恢复后哈希一致、复绿。
   **这条证明修正后的 f3cache 判据不是空转的** —— 否则我只是把一个假红换成了一个假绿。
4. **嵌套掩码门禁**：把 `state.js` 的 `maskDeep(server?.config)` 改回浅层 `maskDict(...)`
   （并补上 import 以保证模块可加载，避免「缺符号」型假红）→ 构造嵌套 canary 后
   **原始文档文本确实包含 canary** → 恢复后 md5 一致。

另有一条**聚合门禁**的变异：给 devB 的 `test/mcp-inventory.mjs` 注入一条真实失败 →
`node test/all.mjs` **exit 1**，并打印 `FAILED: - mcp inventory (...)` 与 `SUMMARY suites=6 failed=1`。
**这证明「某个套件红了但 overall 还是 0」的假绿不会发生。** 恢复后 md5 一致。

---

## 4. 未通过区

**当前无 FAIL。** 过程中出现过、并已处置的失败如下（保留过程以便复核）：

| 曾出现的现象 | 根因 | 判定 | 处置 |
|---|---|---|---|
| `f31`：`skill` 工具报 "not available" 而非 "unknown" | 产品当时用 OMIT；后来改为 INERT | **测试标准错**（我最初的断言基于错误直觉） | 已按实测重写断言；见 §3.1 |
| `n4`：GET 体出现 canary（疑似真泄漏） | **我的 stub** 喂了 `{transport,command,env}` 形状，而真实 manager 产出的是**已展平的** secret 字典；`maskDict` 是**浅层**的 | **测试夹具错**，非产品缺陷 | 改为让 canary 走**真实** `createMcpManager` → `createStateBuilder` 全链路 |
| `perf`：`readWriteAccess is not a function` | 我的依赖包不全 | **测试夹具错** | 已补齐真实依赖 |
| `f44`/`degrade` BLOCKED | `state.js` 未落地 / 导出名漂移 | 功能未落地 | devA 落地后自动解锁，现均 PASS |
| `f3cache` 在 INERT 下报「名字列表未变化」 | **我的判据仍是 OMIT 的**：INERT 下禁用名**留在** `list()`（这正是击败同层 rival 的方式），所以名字列表本来就不该变 | **测试判据错**（假红：对正确代码报错） | 判据改为**行 payload**：`gate-b:true → gate-b:false`；并用变异证明新判据能红（§3.4 第 3 条） |
| 聚合运行时 8 个 verify 用例连带失败 | **我的 `mutation` 用例不抗崩溃**：中途抛错会把 `lib/state.js` 留在被变异状态，污染同一轮里的后续套件 | **测试自身的缺陷**，且是「测试破坏被测代码」这类最危险的缺陷 | 用例改为**捕获原始字节 + `finally` 无条件还原 + `process.once('exit')` 兜底**；已用一次完整运行验证 `md5sum -c lib/*.js` 全部 OK |

**一次真实的自我证伪记录（1）**：我曾试图用「聚合退出码变异」证明门禁有效，
第一次变异把判断条件写成 `label.includes('SERVER_NAME_PATTERN')` —— 该标签在套件里**不存在**，
于是替换**静默命中 0 次**、套件照常全绿，我一度误判为「聚合退出码有 bug」。
那正是变异自证要防的**假象 2（变异没打中目标）**。重做时改为先枚举真实标签、再断言锚点命中数，
才得到真实结论。**结论：我最初的怀疑是错的，聚合退出码本来就是对的。**

**一次真实的自我证伪记录（2）—— 两次变异都因「红得不干净」而被我自己否决**
做「嵌套掩码」变异时，我前两版都产生了**加载错误**而非断言失败，正是变异自证要防的
**假象 1（编译/加载失败的红）**：① 把 `maskDeep` 改成调用 `maskDict` → **无限递归**栈溢出；
② 改调用点但没补 import → `maskDict is not defined`。
两版都「红了」，但都**什么都没证明**。第三版同时改调用点**并补上 import**（保持模块可加载），
才得到干净的**断言级红**：`RAW STATE TEXT CONTAINS CANARY? true`。
**教训：「测试变红了」不等于「测试抓到了缺陷」——必须读出红的原因。**

---

## 5. 未覆盖区（如实列出，附原因）

| 项 | 为什么没覆盖 | 影响 / 谁来补 |
|---|---|---|
| **N1 中英双语键集合相等** | 属 client bundle（`lib/client.js`）；本套件不加载浏览器 bundle | **未覆盖**。需 devC 的 `test/client.mjs`/`ui-*.mjs` 或 testB 在浏览器侧验证 |
| **N2 视觉规范**（`--dsw-*` 令牌、折叠 `aria-expanded`、暗色主题） | 需要真实浏览器渲染 | **未覆盖**。无浏览器控制权时不得声称界面正常 |
| **N3 不依赖 loopback** | 同上，需页面在 `settingsScope` 不可用时仍渲染 | **未覆盖**。devC 声称已测；**独立验证需浏览器** |
| **F2 列表筛选/搜索/详情交互** | 前端交互 | **未覆盖**，同 N2 |
| **F5.1/F5.3 MCP 外部行与三态开关** | 需要真实 loader 行与 `pluginManager` Remote | **部分覆盖**：`f63` 覆盖了 add/remove/死服务器；`pluginManager` 三态映射仅有 devB 自测 |
| **F6.1/F6.2/F6.4 配置字段与重连** | — | **部分覆盖**：`f63` 覆盖 transport 与删除；`normalizeConfig` 边界仅在 devB 自测中 |
| **F6.6 声明持久化跨重启** | 需要真实宿主重启 | **未覆盖**。`f63` 只验证了单进程内的声明保留 |
| **F7 配置改动即时生效** | — | **未覆盖**（无独立用例） |
| **F8 错误可见 / 请求失败重试** | 前端 | **未覆盖** |
| **活体验证（3080 之外的实例）** | 本任务未起实例（端口纪律） | **已由 Lead 在 3199 上补做**，见 §3.3c；**带真实会话的端到端验证仍未做** |
| **`effective` 的 scope 依赖语义** | 无活动会话的新实例上，第一层技能可能报 `effective=true`（见 §3.3c）。触发条件依赖会话生命周期 | **未覆盖**。`f33` 用合成 scope 覆盖了机制本身；**真实会话（浏览器/会话上下文）下的行为未验** |
| **N4 嵌套密钥的中间面** | `mcpManager.describe()` 对深度 ≥2 的密钥仍会泄漏，仅因 `state.js` 重新深度掩码而**未到达浏览器** | **风险记录（非缺陷）**：线上文档安全，但任何新消费者直接使用 `describe()` 即会泄漏。建议 devB 在 `describe()` 内也用 `maskDeep` |

> **口径提醒**：上表「未覆盖」指的是**本套件**未覆盖，不等于产品未实现。
> task-6 需在真实实例上补齐活体验证，并明确区分「代码层通过」与「浏览器视觉未验证」。

---

## 6. 给 task-6（testB）的交接说明

1. **不要引用本文档的数字而不重跑** —— 技能树是活的。至少重跑
   `node tests/verify/run.mjs scale` 与 `node test/all.mjs`，确认 135/1/24(a) 仍然成立。
2. **本文档的结构已按你的需求分区**：矩阵区（§2）/ 通过区（§3）/ 未通过区（§4）/ 未覆盖区（§5）。
   请把最终结论追加到 §7，**不要重写上面各节**（它们是过程证据）。
3. **活体验证**是最大缺口，也是最可能发现真问题的部分：
   - 起 3199+ 实例（**绝不碰 3080**），`GET /skill-mcp-panel/state` 结构性断言；
   - 真实 HTTP 执行一次技能开关，复读 state 与 `ctx.skills` 视角是否一致；
   - 断言启动日志无报错，完成后**清理进程**。
4. **本套件的 BLOCKED 语义**：BLOCKED = 功能未落地，**不是通过**。若你看到 BLOCKED，先确认开发是否已完成，
   再决定是补实现还是改验收标准 —— 不要把它当作「已通过」写进结论。
5. 若你改动 `tests/verify/**`，请保留 §3.4 的变异自证并重跑：
   **一个从未红过的门禁不是门禁，是一段注释。**

---

## 7. task-6 最终结论（testB / qa-accept）

> 结论时刻：**2026-09-18T11:38+08:00**；**11:44 在最新代码上复验过一遍**（结果见本节末尾「复验」）。
> 以下每个数字都是**我自己重跑**得到的原始输出。
> 代码仍在变动，故附上当时 md5，便于判断结论对应的到底是哪一版。

| 文件 | md5（结论时刻） |
|---|---|
| `lib/index.js` | `2dd513a146b52008652f3389f4315cc7` |
| `lib/toggle.js` | `a9c3934f1d4fdcf53182dbec8ffe19df` |
| `lib/state.js` | `4e3944170d19d42583ef658c9b402edd` |
| `lib/mcp.js` | `d58fccd6b97f1a9dfce64e2f6c0bafe1` |
| `lib/http.js` | `9151d6cbf340870854c98743ee531c1f`（11:44 复验时已更新） |
| `lib/contract.js` | `4ef32584fee11a0bb5449f13f456acd4`（冻结，我未改动） |
| `lib/client.js` | `fd67472010f539750373656be9876a29` |
| `tests/verify/cases/f3cache.mjs` | `071382978e5c16149c00cabbcaa3640e` |

### 7.0 计数（通过 / 未通过 / 未覆盖）

| 区 | 条数 | 位置 |
|---|---|---|
| **通过** | **17** | §7.1 |
| **未通过** | **3** | §7.2（含 1 条**交付缺失**，见 §7.2-3） |
| **未覆盖** | **5** | §7.3 |

### 7.1 通过区（我自己跑出来的证据）

| # | 项 | 我跑的命令 | 原始结果 |
|---|---|---|---|
| 1 | 全量门禁 | `cd skill-mcp-panel && npm test` | **exit 0**、`ALL SUITES PASSED`、`SUMMARY suites=6 failed=0 blocked=0` |
| 2 | 既有 4 套件不退化 | `node test/run.js` / `watch.mjs` / `client.mjs` | **36/36**、**7/7**、**52/52** |
| 3 | 独立验收套件 | `node tests/verify/run.mjs` | `12 passed, 1 failed, 0 blocked (of 13)`、`107/108 断言` |
| 4 | 真实规模（带分母口径） | `node skill-mcp-panel/test/realtree.mjs` | **135 唯一技能 / 24 分类 / 1 冲突(github)**；raw `SKILL.md`=164；口径见 §1 |
| 5 | 变异自证（F3.6 门禁） | `node tests/verify/run.mjs mutation` | 改坏→**红**(`reason=content-changed`)→恢复后 md5/size/mtime **三者与基线全等** |
| 6 | **活体：state 端点** | `GET http://127.0.0.1:3211/skill-mcp-panel/state` | **HTTP 200**；`version=1 revision=1 writable=true writeAccess=same-origin`；`MISSING KEYS: []`（contract 的 version/roots/skills/conflicts/mcp/config 全在） |
| 7 | **活体：启动日志无报错** | `grep -cE 'error\|Error\|ERR_' live-3211.log` | **0 行**；日志仅一行 `dsh web: http://127.0.0.1:3211/?token=…` |
| 8 | **活体：真实 HTTP 技能开关** | `POST /skill-mcp-panel/apply`（同源 `Origin` + `application/json`） | **HTTP 200**、`{"ok":true,"status":"applied"}`；随后 GET state 该行为 `enabled:false, modelInvocable:false, userInvocable:false, provider:"nested-filesystem", rank:0` |
| 9 | **活体：关技能不动文件（F3.6）** | 开关前后 `md5sum` + `stat -c %y` | md5 `b169f8658683a47165c83ff5f084d2a4` **一致**；mtime `2026-05-11 15:58:07` **一致** |
| 10 | **活体：F3.4 跨真实重启持久** | 关 → `kill` 进程 → 重启 → 读 state | 重启后仍 `enabled=false effective=true`；开启后恢复 `enabled=true` |
| 11 | **活体：N4 写门禁** | 跨源 Origin / 非 JSON content-type | **403 / 403**（`status:"refused"`）；同源 JSON **200**（对照组，证明门禁有分辨力） |
| 12 | **F3.3 真实 preset 层**（真实 `skill-filesystem` 挂进真实 preset scope） | `/tmp/qa-accept/probe-depth1.mjs` | preset provider 独占 **10** 个 depth-1 技能；关闭 `cpp-test-coverage-analysis` → `effective=false`、`shadowedBy="filesystem"`、文案 `is NOT disabled … still served by "filesystem"`，**未谎报成功** |
| 13 | **F3.1/F3.6 真实宿主内进程复验** | `/tmp/qa-accept/probe3.mjs`（真实 `index.js` + 真实 `dsh-fs-local` + 真实 `skill` 工具，走插件自己的 route handler） | 关闭后 `get()=undefined`、真实 `skill` 工具拒绝加载；`md5`/`mtime` 与基线**全等**；再开 body 与 md5 复原 |
| 14 | **N1 zh/en 键集合相等** | 独立解析 `client.js` 的 `zh`/`en` 字典并展平比对 | **40 / 40 叶子键**，`only in zh=[]`、`only in en=[]` → **PASS** |
| 15 | **F5.1(a) 本插件声明的 MCP 行** | `node test/mcp-live.mjs` | 真实 stdio 子进程挂载成功、`declared=true`、`mcp__live-fixture__ping` 真的出现在 `ctx.tools` |
| 16 | **F5.1(b) 外部行（进程内）** | `node test/mcp-live.mjs` | `PASS declared=false for an external server`（**真实宿主上无此行，见 §7.3-3**） |
| 17 | 端口纪律与清理 | `kill` 我方 pid + `ss -ltn` | 我方端口**已释放**；**3080 全程未触碰**（每轮均确认仍由 pid 3368002 持有） |

口径补注（避免误读）：
- §1 的「24 分类」是**口径 (a) 直接父目录名**；口径 (b) 相对根完整路径为 **34**，两者都对，已在 §1 写明。
- `npm test` 必须在 **`skill-mcp-panel/` 目录**下跑才会命中该插件脚本。**仓库根没有 `package.json`**，
  在根目录跑会落到 `sun@1.0.0` 并 `Error: no test specified`（exit 1）——**调用姿势问题，非产品缺陷**。

### 7.2 未通过区（滚动：3 条 → **2 条**）

> **滚动更新（11:48）**：原第 (1) 条 `verify:f3cache` **已被 qa-verify 修复**，我复验通过（13/13、114/114），
> 已移出未通过区，过程保留在下方以留痕。
> **当前未通过 = 2 条**：(2) 裸宿主 depth-1 的 `effective` 语义（活体断言未过，非代码缺陷）；
> (3) **task-4 管理页面未交付**（结论时刻 `client.js` 仍为 Sep 16；11:43 后 devC 才开始产出 `ui-model.js`）。

#### (1) `verify:f3cache` —— 套件内部自相矛盾 —— ✅ **已于 11:47 由 qa-verify 修复，我复验通过**

**原始现象（我实测，md5 `071382978e5c16149c00cabbcaa3640e`）**：

```
--- FAIL    f3cache ---
  · gate names before the toggle: ["gate-a","gate-b"]
  · suppressor disabled set: ["gate-b"]
  · gate names after the toggle: ["gate-a","gate-b"]
  FAIL F3 cache gate: list() after the toggle DIFFERS from before (a stale cache would be identical)
  ok   the toggled name is gone from the model-visible catalog
  ok   control: the sibling from the same provider survives (the toggle is per-name)
verify: 0 passed, 1 failed, 0 blocked (of 1)
```

**最小复现**：`cd /home/sun/workspace/dsh-plugins && node tests/verify/run.mjs f3cache`
→ 我当时连跑 **3 次全部 FAIL**。

**根因**：`f3cache` 仍按**旧的 OMIT 策略**断言「开关后 `list()` 必须与之前不同」，
而同套件的 `f31` 已被改写为按**INERT 策略**断言「名字**仍在** `list()` 里」——两者对同一机制的要求**互相排斥**。
产品实现是 INERT（`lib/index.js` 返回 `[...visible, ...suppressions]`，§3.1 已判定其**正确**），
所以 `list()` **本来就不该变化**，该断言必然红。**判定：测试标准错，非产品缺陷。**

**✅ 复验（11:47，新 md5 `a118793d69e27e7dd022ac312a7aa637`）**——已按我建议的口径改写，现在断言
「被压制的名字解析为 nothing（工具拒绝）」而非「`list()` 整体变化」：

```
  ok   F3 cache gate: the suppressed name resolves to nothing (so the tool refuses it)
  ok   the toggled name is gone from the model-visible catalog
  ok   control: the sibling from the same provider survives uncancelled (the toggle is per-name)
  ok   re-enabling returns the payload to its original value
verify: 1 passed, 0 failed, 0 blocked (of 1)   |  9/9 断言
```

**全量复验（11:48，最新代码）**：`node tests/verify/run.mjs` → **`13 passed, 0 failed, 0 blocked (of 13)`、`114/114 断言`**。
**此项已从未通过区移出**（保留过程记录以留痕）；§7.0 的计数见下方「滚动更新」。

#### (2) 活体：无 preset scope 的裸宿主上，depth-1 技能被报成「已彻底关闭」

**现象**（真实 `dsh web` 实例，3211 端口）：

```
POST /apply -> {"ok":true,"status":"applied","detail":"\"gnome-remote-desktop\" is disabled: neither the model nor the user catalog can reach it any more."}
GET  /state -> {"name":"gnome-remote-desktop","enabled":false,"effective":true,"shadowedBy":null,"provider":"nested-filesystem","rank":0}
```

`effective:true` + `shadowedBy:null` 即**声称已彻底关闭**；而按 F3.3 设计事实，这 10 个 depth-1 技能由 preset 层拥有、
global 层关不掉，本应报 `effective=false`。

**根因已定位（不是产品谎报）**：`verifyDisabled` 只能看到**本进程实际存在的 scope**。在裸实例里我实测
`discoverScopes(ctx)` 返回 **0 个 scope** —— preset scope 是**会话建立时才挂载**的。没有 scope 就没有「近层仍在 serving」的证据，
此时报 `effective=true` 是**当时事实的忠实反映**。我随后把**真实的** `skill-filesystem` 挂进真实 preset scope 复验
（§7.1 第 12 条），同一名字立刻变为 `effective=false, shadowedBy="filesystem"` —— **逻辑本身正确**。

**判定：未通过的是「活体断言」而非代码逻辑**。**风险提示**：在 preset 会话真正建立前，界面会把这 10 个显示为已关闭，
用户此时使用模型可能发现技能仍在。建议开发确认该时间窗是否可接受（或 UI 上标注不确定性）。
我**不记为代码缺陷，也不记为通过**。

> 附注：Lead 在 §3.3c 独立得到同一结论（`effective` 的 scope 懒创建语义）。两条独立观察互相印证，
> 且我额外用**真实** `skill-filesystem` preset scope 拿到了翻转为 `effective=false` 的正向证据（§7.1 第 12 条）。

#### (3) **task-4（devC/UI）的交付物整体缺失 —— 管理页面从未落地** ⚠️

**这是本轮最重要的发现。** `lib/client.js` 的 mtime 是 **2026-09-16 21:21:35**，即 task-4 开始后**一个字节都没被改过**。
以 md5 与穷尽搜索为证（结论时刻 `fd67472010f539750373656be9876a29`）：

```
$ grep -rn "settings.plugins.tab" skill-mcp-panel/lib/     -> (NOT PRESENT in any lib file)
$ grep -rln "plugins.tab" . | grep -v node_modules       -> (none anywhere)
$ grep -cE "fetch\(|/skill-mcp-panel/state|/skill-mcp-panel/apply" skill-mcp-panel/lib/client.js -> 0
$ grep -nE "slots\.register" skill-mcp-panel/lib/client.js
  718:  ctx.slots.register({ name: "settings.plugin.item", key: NS, locale: NS }, (props) =>
$ ls skill-mcp-panel/test/ui-*.mjs                          -> No such file or directory
$ node skill-mcp-panel/test/client.mjs                      -> 52/52（与改动前完全一致，无新增用例）
```

**含义**：task-4 要求的四分区管理页、`settings.plugins.tab` 挂载点、HTTP 数据通道（`fetch` 契约端点）、
MCP 增改删表单、掩码回显、三态文案、错误重试、`ui-*.mjs` 测试 —— **全部不存在**。
client 侧仍然**只有**改动前那张 `settings.plugin.item` 设置卡（依赖 `settingsScope`，正是 N3 明确要摆脱的东西）。

**因此受影响的验收项**：**N3**（页面数据通道不依赖 loopback）、**F2 前端**（列表面板/搜索/筛选/详情）、
**F4 前端**（冲突展示）、**F5 前端**（MCP 分区与开关 UI）、**F7 前端**（配置分区即时生效）、
**F8**（错误可见 + 重试）、**N1**（双语——字典存在且键集合相等，40/40 我已验证，但**承载它的页面不存在**）、
**N2**（视觉规范——无页面可评）。
**即：后端契约与宿主 API 已完成且经我活体验证；用户可见的管理界面完全未交付。**

**必须纠正的一处误记**：§5 未覆盖区把 N3 写成「devC 声称已测；独立验证需浏览器」。
按上述证据，**不存在可测的页面**——这不是「未覆盖」，而是**未交付**。请勿把 task-4 视为已完成。

**复核建议（给 Lead）**：在 task-4 标记完成前，要求其给出
(a) `grep -c "settings.plugins.tab" lib/client.js` ≥ 1；
(b) `ls test/ui-*.mjs` 存在且新增用例数 > 52；
(c) 一条**真实浏览器**里页面渲染 + 成功执行一次开关的截图或 CDP 记录。
在此之前，任何「管理页面已完成」的表述都是**未经证实**的。

### 7.3 未覆盖区（5 条，全部附原因）

| # | 项 | 为什么没覆盖 |
|---|---|---|
| 1 | **N2 视觉规范 / 浏览器渲染**（`--dsw-*` 令牌、默认折叠、`aria-expanded`、亮暗主题、139 行不卡） | **我没有浏览器控制权**。只能给出 client bundle 的**语法/契约/单测层**结论（`client.mjs` 52/52、N1 键集合 40/40 我已独立复跑）。**不得**声称界面已渲染或好看。 |
| 2 | **N3 非 loopback 页面实测** | **平台硬阻断，无法构造**：`dsh web --host 0.0.0.0` → usage error（`intentionally not supported yet for safety`）；`--host 192.168.20.3` → schema 拒绝（`$.host expected "127.0.0.1" \| "0.0.0.0"`）。故 `http://192.168.20.3:3199` 与 `http://100.64.0.10:3199` 均连不通（`curl` exit 7）。**代码层**有独立证据：state 全部数据来自自有 HTTP 通道（§7.1 第 6、8 条），`n4`/`n4nested` 套件内通过；但**局域网页面可用性未在活体验证**。 |
| 3 | **F5.1(b) 真实宿主上的外部 MCP 行** | 本机**不存在**任何外部 MCP 行：`grep -rn "mcp-client" /home/sun/.dsh/profiles/*/cordis.patch.yml` → 无匹配；活体 `state.mcp.servers = []`。仅有**进程内**证据（§7.1 第 16 条）。**如实写「本机无外部 MCP 行，未覆盖」，不编造。** |
| 4 | **F5.3 MCP 三态开关活体** | 需要真实 `pluginManager` Remote 与可寻址外部行；本机无 MCP 行可寻址。开发自测覆盖了映射，**我未独立复现**。 |
| 5 | **F2/F8 前端交互**（搜索、筛选、详情、错误重试、白屏） | 同第 1 条：无浏览器控制权。 |

**另需指出的既有假绿（非我引入，但影响门禁可信度）**：
`test/namespace-check.mjs` 在 `node test/all.mjs` 里**永远 SKIP**（打印 `SKIP settings provider not found`，exit 0）。
它硬编码的两个候选路径（`profiles/web/node_modules/…` 与 `profiles/node_modules/…`）在本机**都不存在**——
包实际只在 pnpm store 里。我用**真实包路径**手工喂进去后，同一套件 **9/9 全绿**。
即：**「9/9 通过」在默认路径下从未被执行过**，它在 `npm test` 里只是一句 SKIP。
建议像 `tests/verify/lib/real-harness.mjs` 那样**按 glob 在 store 中查找包**，而非硬编码两个失效路径。

### 7.4 我对本机 settings 的改动与还原（如实交代）

活体验证会写真实 settings，我用**测试用技能 `minecraft-modpack-server`**（nested，depth 2）做开关：

- 改动键：`~/.dsh/settings.yaml` → `skill-mcp-panel.skills.<name>: true`（关闭）/ 删除该键（开启）。
- **已还原**：最终 `skill-mcp-panel.skills` 为空表，之后该键整体从 `settings.yaml` 消失（回到基线形状）。
- 另在多次试验中临时关闭过 `api-endpoint-verification`、`gnome-remote-desktop`、`yuanbao`、`cpp-test-coverage-analysis`，**均已还原为开启**。
- **所有被开关技能文件的 md5/mtime 全程未变**（逐次比对，见 §7.1 第 9 条）。
- 结束状态：`GET /state` → `total:135, disabled:0`。**3080 全程未被触碰**；我方端口（3199/3211）**已释放**。
- 说明：结论时刻 `settings.yaml` 出现 `pixel-art: true`，是**其他队友正在其自建实例上测试**所致，**不是我改的**，我未干预。

### 7.5 我对本文档的处理

按 §6 第 2 条：**§1–§6 原文未改写**（保留为过程证据）。但请注意 §2 第 89 行与 §4「当前无 FAIL」在结论时刻**已不成立**
（`verify:f3cache` 实测红，见 §7.2-1）；请以本 §7 的计数为准。

### 7.6 复验（11:44，代码更新后重跑）

`lib/http.js` 在我出结论后又变更了一次，故我**在最新代码上整轮复跑**，结论不变：

| 复验项 | 结果 |
|---|---|
| `node tests/verify/run.mjs` | `12 passed, 1 failed, 0 blocked (of 13)`、**111/112** 断言（唯一红仍是 `f3cache`） |
| `cd skill-mcp-panel && npm test` | `SUMMARY suites=10 failed=1 blocked=0`（套件已从 6 增至 10），**唯一红仍是 `f3cache`** |
| 活体（新起 3213）：`GET /state` | **HTTP 200**，`version=1 ... skills=135 conflicts=1`，`mcp.servers=0` |
| 活体启动日志 | **NO ERROR LINES MATCHED** |
| 活体开关 + md5 | disable `{"ok":true,"status":"applied"}` → `enabled:false,effective:true,modelInvocable:false`；md5 前后均 `b169f8658683a47165c83ff5f084d2a4`（**未变**）；恢复后 `disabled:0`、md5 仍一致 |
| 清理 | 3213 **已释放**；**3080 仍由 pid 3368002 持有，全程未动** |
| settings 归位 | `skill-mcp-panel.skills: {}` |

**因此 §7.0 的计数（17 通过 / 2 未通过 / 5 未覆盖）在最新代码上依然成立。**

---

## §8 Lead 收口（2026-09-18 14:xx）

§7 的结论在**其结论时刻**成立。此后 Lead 接管了未交付的 task-4（管理页面）并修掉 §7.2 报告的红，
本节记录**变化**，不改写 §1–§7 作为过程证据。

### 8.1 task-4 由 Lead 接管并交付（§7.2-3 的「未交付」已不再成立）

devC 在 45+ 分钟内零产出，Lead 于 14:xx 中断它并亲自实现：

| 产物 | 内容 |
|---|---|
| `lib/client.js` | 新增 `settings.plugins.tab` 管理页：技能 / 冲突 / MCP / 配置四分区；`PageApi`（GET `state` / POST `apply`，含 409 重试）；`groupByCategory` / `filterSkills` / `stateOf` / `statusOf`；`McpServerRow`；110 键中英字典由 `docs/copy-zh-en.md` 生成 |
| `test/ui-page.mjs` | **72/72** 断言 |
| `docs/copy-zh-en.md` | Lead 撰写，110 键 zh/en（键集合相等由 ui-page 断言） |
| `test/client.mjs` | 修 harness：按 **slot 名**捕获组件，而非「最后一次注册」（否则新增 slot 会静默把断言指向错误组件） |

### 8.2 修掉 §7.2 报告的 f3cache 红

`tests/verify/cases/f3cache.mjs` 原按 **OMIT** 策略断言「`list()` 必须变化」，而产品是 **INERT**
（§7.2-1 判定正确：测试标准错，非产品缺陷）。QA 已修；Lead 复核后 **`tests/verify` 13/13 通过、114/114 断言**，
`f3cache` 不再红。

### 8.3 消除一个「空转的绿」（§7 其他两点之一）

`test/namespace-check.mjs` 原硬编码两个已失效的 symlink 路径 → 在 `npm test` 里**永远 SKIP**，
即「9/9 通过」从未真正执行。Lead 改为**在 pnpm store 中搜索**该包，并修了两处 harness 问题
（plugin 对象需 `name`；`apply` 必须用块体，否则返回值被 Cordis 当成 effect 回调 → `Invalid effect`）。
现在它**真的运行**，并因此暴露了一个过期断言：schema 已合法新增 `mcpServers`/`skills`/`writeAccess`
（已同步）。`test/all.mjs` 从此报 `skipped=0`。

### 8.4 最终门禁（Lead 亲跑）

```
$ cd skill-mcp-panel && npm test
verify: 13 passed, 0 failed, 0 blocked (of 13)
verify: 114/114 individual assertions passed
ALL SUITES PASSED
SUMMARY suites=11 failed=0 blocked=0 skipped=0     EXIT=0
```

### 8.5 活体验证（Lead，端口 3215，已清理）

```
GET /skill-mcp-panel/state            -> HTTP 200；version=1 skills=135 conflicts=1 mcp.servers=0 roots=3
启动日志                            -> 0 条 error
boot graph 含 dsh-skill-mcp-panel/client.js
取回该 combo（HTTP 200, 5,185,625 bytes）:
  "settings.plugins.tab" 出现 13 次 · "/skill-mcp-panel/state" 出现 · "技能与 MCP" 出现
=> 管理页面确实随宿主 bundle 送达浏览器（非仅单测层）
技能开关（真实 HTTP，同源 + JSON） -> status:"applied"
  row: enabled=false effective=true modelInvocable=false provider=nested-filesystem rank=0
  SKILL.md md5 前后 b61a980f4fcf35987d18005ec140ed2e（未变），mtime/size 亦未变
过期 revision 提交 -> HTTP 409 refused（栅栏有效，未写入脏数据）
清理: 3215 已释放；3080 全程未动；settings 残留已移除
```

### 8.6 仍然未覆盖（不得读作通过）

1. **N2 浏览器视觉** —— 无浏览器控制权。已证明 bundle 送达且含页面代码，**未**证明像素级渲染正确。
2. **N3 非 loopback 实测** —— QA 已查明平台硬阻断（`--host 0.0.0.0` 与真实 IP 均被拒），
   故以「settingsScope 不可用时页面仍渲染并成功开关」的单测作为替代证据（`ui-page.mjs` 断言
   `scopeReads.length === 0`）。
3. **F6.6 跨重启持久化** —— QA 在 3199/3211 上实测通过（关→重启→仍 disabled），Lead 未重复。
4. **F5.1(b) 真实外部 MCP 行** —— 本机 profile 无任何 mcp-client 行，只有进程内构造证据。
5. **`effective` 语义**：裸宿主（无活动会话）上 depth-1 技能报 `effective=true` 是**当时事实**
   （scope 懒创建）；有真实 preset scope 时正确翻成 `effective=false`（QA 与 Lead 各自复现）。
   未做事：带**真实会话**的端到端 `effective=false` 验证。
