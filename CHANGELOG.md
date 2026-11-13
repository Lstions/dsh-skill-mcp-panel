# 变更记录

本文件记录 `dsh-skill-mcp-panel` 的每个版本。

版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)；每个已发布版本都对应一个
`vX.Y.Z` git tag，tag 指向的提交就是该版本的确定内容。

---

## 版本历史（含一次未能守住的记录）

| 版本 | 日期 | 提交 | 内容 |
|---|---|---|---|
| 1.8.0 | 2026-11-13 | 见下 | 支持 `${credential:NAME}` 凭据模板：原样保存、自动展开、保存前解析并拒绝未配置的引用；模板不掩码 |
| 1.7.0 | 2026-11-13 | 见下 | 导入合并为一个表单（名称必填 + 备注可选）；保存前校验命令；挂载失败带真因；修主按钮对比度 |
| 1.6.0 | 2026-11-13 | 见下 | 导入改为两步：先预览，逐台**确认名称（必填）与备注（可选）**，再写入 |
| 1.5.0 | 2026-11-13 | 见下 | 新增 JSON 导入：粘贴 `mcpServers` 文档即可批量添加 MCP 服务器 |
| 1.4.4 | 2026-11-08 | 见下 | 澄清 MCP 面板的作用范围：只覆盖 DSH 组合层，不读其它客户端配置 |
| 1.4.3 | 2026-11-08 | `891f1a8` | 在 DSH 0.2.2-rc.1 上逐项验证；测试门禁不再依赖已删除的技能树 |
| 1.4.2 | 2026-11-08 | `036e8fb` | 源码移入插件集合目录的子目录；文档随之更新 |
| 1.4.1 | 2026-11-08 | `e4e215a` | 修复重启后已声明的 MCP 服务器不恢复、开关卡死 |
| 1.4.0 | 2026-09-28 | `1c56d5b` | 支持 DSH 0.2.0；修正 peer 范围；新增兼容性门禁 |
| 1.3.0 | 2026-09-22 | `48cc721` | 插件详情页注册；MCP 新增 / 修改 / 删除 |
| 1.3.0 | 2026-09-22 | `2aa18f3` | 迁移到 DSH 0.1.7 API；配置可编辑 |
| 1.2.0 | 2026-09-18 | `1735ed1` | 文档补充；`49ded37` 起重构为可安装 bundle 并改名 |
| 1.2.0 | 2026-09-18 | `8078ad3` | 技能开关、冲突报告、MCP 管理 |
| 1.1.0 | 2026-09-16 | `6a91986` | 初始版本：递归多根技能发现 + 设置卡片 |

### 这张表里有两行是同一个版本号 —— 这是缺陷，不是笔误

`1.3.0` 与 `1.2.0` 各自对应**两个内容不同的提交**：

- `2aa18f3` 与 `48cc721` 都写着 `1.3.0`，但后者多出 426 行，并且插件详情页的
  注册从 0 处变成 4 处 —— 也就是说 `2aa18f3` 的详情页是空白的，`48cc721` 才修好。
  用户报告「点进插件什么都没有」时，界面显示的正是 `1.3.0`。
- `8078ad3` 与 `1735ed1` 都写着 `1.2.0`，但 `49ded37` 把仓库从 `skill-nesting/`
  子目录改成了根目录包，包名也从 `dsh-skill-nesting` 改成 `dsh-skill-mcp-panel`。
  这是破坏性变更（安装路径与包名同时改变），按语义化版本应当升 major，实际却
  没有升版本号。

后果是：**在 1.4.0 之前，版本号无法唯一标识内容**。看到「1.3.0」无法判断拿到的是
修好的那版还是空白的那版。

因此：**可引用的版本从 `1.4.0` 开始**。更早的提交不补 tag —— 给一个本身有歧义的
版本号补 tag，只会把歧义固化成「官方发布」。历史保留原样，在此如实记录。

`test/version-check.mjs` 会阻止这件事再次发生：同一个版本号在下方出现两次即测试失败。

## [1.8.0] - 2026-11-13

### 新增：`${credential:NAME}` 凭据模板（F6.11）

MCP 的传输字符串（stdio 的 `command` / `args` / `env` 值 / `cwd`，HTTP 的
`url` / `headers` 值）现在支持宿主的凭据模板：

@@@json
{
  "mcpServers": {
    "magpie": {
      "url": "http://100.64.0.7:3425/mcp/magpie/hub",
      "headers": { "Authorization": "Bearer ${credential:SUN_MAGPIE_API_KEY}" }
    }
  }
}
@@@

- 模板**原样保存**，并自动打开客户端的 `expandTemplates` —— 不要求用户再写第二个
  开关（否则字面 token 会被当成请求头发出去）。
- 保存前按宿主的 `credentials` 服务逐个解析引用：未配置的引用 `refused` 并点名
  （`credential "X" is not configured — store it in the harness credentials and retry`），
  **不写盘**；宿主没有 credentials provider 时同样拒绝并说明。禁用条目豁免。
- 语法在保存前校验：任何 `${…}` 出现都必须是合法模板，否则拒绝并指出是哪个值。
- 模板是**引用不是秘密**：列表里直接显示 `Bearer ${credential:...}`，不再显示成
  掩码点；真实秘密仍按 key 掩码。解析后的值不会进入声明或状态接口。
- 挂载失败时 detail 带上客户端 `cause` 链。

- 修复一个被视觉复核暴露的既有 bug：`McpServerRow.config` 以前只回 `env`/`headers`
  字典，行内编辑表单因此默认回 stdio、丢掉 URL。现在回**完整**的（掩码后）传输配置；
  URL 在状态里脱敏（userinfo 与秘密查询参数），把脱敏后的 URL 原样保存会还原真实值。
- 修复启动顺序竞态：宿主启动时 `credentials` 服务可能还没就绪，带模板的服务器在
  `restoreDeclared` 阶段会被跳过、重启后一直离线。`mount` 现在最多等 5 秒等服务出现。

### 测试

- `test/mcp-inventory.mjs`：模板自动开启 expansion、原样保存、掩码豁免、非法语法
  拒绝、已解析凭据 applied、未配置凭据 refused 不写盘、无 provider 拒绝、禁用豁免、
  导入路径同样预检、启动时 credentials 服务延迟出现仍能挂载。
- `test/ui-page.mjs`：19b 用真实载荷形状（完整 config）驱动编辑表单，确认
  transport / url / headers 预填且模板原样保存。

### 测试
- 真实活体：临时 DSH 实例 + 真实 `.credentials.yaml` 里的 `SUN_MAGPIE_API_KEY`，
  导入用户给的 magpie 配置 → applied、工具注册；未配置引用被拒（
  `docs/acceptance.md` §11）。

---

## [1.7.0] - 2026-11-13

### 修复：主按钮在暗色主题下白底白字

`--dsw-alias-brand-primary` 在暗色主题里是**近白色**（`neutral-bluish-50`），而
`.skn_buttonPrimary` 把文字写死成 `#fff` —— 于是「解析预览 / 导入」变成了一个
没有文字的白色方块（用户截图可见）。改用主题自己的 on-brand 令牌
`--dsw-alias-label-primary-foreground`：暗色下近黑、亮色下近白，两种主题都可读。

### 导入：一个表单、名称必填、备注可选（去掉中间步骤）

上一版把导入拆成「贴文档 → 预览 → 逐台确认」两步，多了一次点击，而且预览里的
名称输入框让人以为还要再确认一遍。现在只有一个表单：

@@@
MCP JSON        [textarea]
名称（必填）      [input]
备注（可选）      [input]
                [导入] [取消]
@@@

- `mcp.import` 新增 `name` / `note` 字段：页面把文档原文、名称、备注一次发过去，
  主机解析后把名称/备注应用到**那一台**服务器。
- **一份文档只导入一台**（名称/备注只能描述一台）。多台文档会被 `refused` 并提示
  「一次导入一台」；脚本仍可用 `entries` 形式批量导入。
- 名称必填且校验字符集；备注可选、≤200 字符。名称决定 `mcp__<name>__` 工具前缀。
- **落盘后表单关闭并清空**（`applied` / `restart-required` / `unchanged` 都算写入
  成功）；全部被拒时保留输入，方便就地修改。之前"已保存，重启后生效"之后表单还挂着
  上一轮内容，被误以为没创建。
- 备注仍随声明持久化、显示在列表、可随时编辑。

### 新增：保存前校验命令（F6.10）

stdio 服务器的 `command` 现在在**写入之前**按宿主的 PATH 解析：

- 裸命令（`npx`、`node`）→ 在 `process.env.PATH` 的各目录里查找可执行文件；
- 绝对/相对路径 → 检查存在且可执行；
- 找不到 → `refused` 并说明（`command "npx" was not found on PATH`），**不写盘**。
- `enabled: false` 的条目豁免（现在不 spawn，命令可以以后装）。

这正是用户遇到的「创建后无工具」的根因：宿主 PATH 里没有 `npx`，旧行为先写声明、
连接失败后只留下一行「已保存，重启后生效」，永远不会有工具。

### 修复：挂载失败的说明带上了真正的原因

MCP 客户端只抛出包装句「initial connection or tool synchronization failed」，真正原因
在 `error.cause` 里（spawn ENOENT、握手失败、连接被关闭）。现在 `describeFailure()`
遍历 cause 链并把每层消息拼进结果 detail：

@@@
"dies" was declared but cannot be mounted live (mcp-client(dies): initial connection
or tool synchronization failed: Connection closed); it takes effect after a restart.
@@@

### 契约

- `mcp.import`：新增可选 `name` / `note`（页面使用）；`json` / `servers` /
  `entries` 形式保留。
- `mcp.preview` 保留给脚本（页面不再调用）。
- 新增导出 `resolveCommand()`、`describeFailure()`，供主机与测试共用。

### 测试

- `test/ui-page.mjs`：一个表单里贴文档 + 填名称 + 填备注 → 提交；名称为空时禁用
  导入；提交后表单关闭并清空；被拒时保留输入；按钮样式走主题令牌（键表 130）。
- `test/mcp-inventory.mjs`：名称/备注解析与落盘、多台文档拒绝、名称/备注校验、
  命令预检（真解析器）、disabled 豁免、cause 链。
- `test/mcp-live.mjs`：缺失命令 → refused 且不写盘；命令存在但进程即退 →
  restart-required 且 detail 带 "Connection closed"。
- `tests/verify/cases/f63.mjs`：区分「缺失命令不落盘」与「不可达端点保留重试」。

---

## [1.6.0] - 2026-11-13

### 新增：导入时命名、可选备注（F6.9）

**问题**：1.5.0 能粘贴 JSON 了，但“原始格式”常常是一个裸的 `{command,args}` 对象 ——
它**没有名字**，而 MCP 的工具命名空间正是 `mcp__<name>__`。自动编号（`server-1`）
或拿命令名凑一个，都会在列表里留下分不清的行；两台相似的 `npx` 服务器更是只能靠猜。

**做法**：导入改成两步，命名与备注是硬要求。

1. **粘贴 → 解析预览**（新 op `mcp.preview`）。解析仍在主机侧，预览返回每台服务器的
   名字、配置，以及名称/配置各自的问题；**不写盘、不启动进程**。
2. **逐台确认名称（必填）+ 备注（可选）→ 导入**。名称预填文档里的键、可改：
   - 裸 `{command,args}` 对象现在会解析成一条**无名字**的条目，由这一步补名字；
   - 名称清空则提交按钮禁用；API 直接收到空名字则 `refused`；
   - 备注 ≤ 200 字符，随声明持久化、显示在列表里，之后可编辑或清空；
   - 已有名字不覆盖（`unchanged`），外部层占用报 `refused`。

新增与编辑表单也加了**备注**字段；没有备注的行不占位。备注只存在于设置文档，
**不会**进入 MCP 客户端的连接配置（工具/命令行为完全不变）。

### 契约变化（向后兼容）

- 新 op `mcp.preview`：入参与 `mcp.import` 的文档形式相同，返回**每台一条**结果，
  每条携带 `preview: { serverName, note, config, enabled, nameError, configError }`。
- `mcp.import` 新增 `entries: [{ serverName, note, config, enabled }]` 形式（页面走
  这条路径）；原有的 `json` / `servers` 形式保持不变。
- `parseMcpServers()` 的返回从 `{entries, servers, errors}` 收窄为 `{entries}`，每条
  为 `{serverName, config, enabled, nameError, configError}` —— 名称问题不再让整条
  解析失败，因为它正是 review 步骤要修的东西。
- 声明与服务器行新增可选 `note`；`mcp.add` / `mcp.configure` 接受 `note`。

### 测试

- `test/mcp-inventory.mjs`：预览不写盘、裸对象无名字、名称必填、备注裁剪/上限/
  保留语义、同一批重复名字、一次写盘。
- `test/ui-page.mjs`：贴文档 → `mcp.preview` 原样转发 → 逐行名称/备注 → 清空名称
  时禁用提交 → `mcp.import` 带 `entries`；全部成功才收起；新增/编辑的备注字段与
  列表显示。
- `test/host-live.mjs`：真实插件管线 + 真实 HTTP 路由上的 preview / entries /
  备注落盘。
- `test/mcp-live.mjs`：reviewed 条目挂载**真实子进程**并注册工具，备注出现在 describe。
- `tests/verify/cases/f68.mjs`：27 条断言（预览、命名、备注、不覆盖）。

### 版本说明

`1.5.0`（同日）是这件事的第一半（JSON 导入本身），从未推送；`1.6.0` 交付完整的
「导入 + 命名 + 备注」。两者各有自己的提交与 tag，历史保留原样。

---

## [1.5.0] - 2026-11-13

### 新增：粘贴 JSON 导入 MCP 服务器

**问题**：MCP 服务器只能一台一台手填表单。用户手上通常已经有一段现成的
`mcpServers` 配置（Claude Desktop / Claude Code / Cursor / VS Code），逐项重填
既慢又容易抄错参数。

**做法**：MCP 分区新增「导入 JSON」。粘贴一段文档即可，解析在主机侧完成：

```json
{
  "mcpServers": {
    "bing-search": { "command": "npx", "args": ["-y", "bing-cn-mcp"] }
  }
}
```

- 接受 `mcpServers`（Claude / Cursor）与 `servers`（VS Code）两种外层键，也接受
  直接以服务器名为键的裸映射；一次可导入任意多台。
- `stdio`（`command` / `args` / `env` / `cwd`）与 `streamable-http`
  （`url` / `headers`）都支持；`type: "http"` 与 `type: "streamable-http"` 等价。
- **`sse` 明确拒绝**，不会偷偷映射成 streamable-http：宿主没有 SSE 传输，
  假装接受只会把失败推迟到连接时。
- `disabled: true` / `enabled: false` 的条目照常声明，但不立即连接。
- 整个文档**一次写入**，然后逐台挂载。任一名字非法、或已存在，只影响它自己：
  每台服务器各自一条结果（`applied` / `restart-required` / `refused` /
  `unchanged`），页面逐行显示，不做「一句话汇总」。
- 已由本插件声明的同名服务器**不会被覆盖**（报 `unchanged`）；要改配置仍走
  「编辑」或 `mcp.configure`。由外部层挂载的同名服务器报 `refused` 并说明原因。
- 新操作 `mcp.import`（`{kind: "mcp.import", json: "…"}` 或 `servers: {…}`）走同一条
  `/skill-mcp-panel/apply` 通道，因此脚本也能用；它是唯一返回**多条**结果的
  操作，顺序与文档一致。

### 实现

- `lib/mcp.js` 新增纯函数 `parseMcpServers()`：不抛异常，每条拒绝都带可执行的
  原因（哪个名字、哪个字段、为什么）。它复用 `normalizeConfig()` 作为唯一的
  模式校验，因此导入能存下的东西与等价表单提交完全一致。
- `lib/contract.js` 新增 `OP.MCP_IMPORT`；`lib/index.js` 在派发处把数组结果展平，
  线上契约保持「一个扁平结果列表」。

### 测试

- `test/mcp-inventory.mjs`：两份用户给的示例文档逐字段断言；14 类非法文档；
  一次写盘、部分成功、外部层冲突、写盘失败、禁用条目、批量结果展平。
- `test/ui-page.mjs`：表单 → 提交 → **原样**转发文本 → 逐行结果；
  有失败项时表单保持打开。
- `test/host-live.mjs`：真实插件管线 + 真实 HTTP 路由上跑一次导入，断言
  **一次**设置写入、重复导入 `unchanged`、坏 JSON 被拒绝。

### 顺手修掉的两个缺陷

- **测试夹具**：`ctx.plugin` 引用了不存在的 `options`，错误被 `mount()` 吞成
  `restart-required`，于是离线夹具从来没有真正走过「挂载成功」分支。现在
  `onMount` 是夹具的真实参数，`dispose()` 也会撤销它注册的工具。
- **文案表**：`docs/copy-zh-en.md` 声明「110 个键」，实现里已是 122 个，清单
  还漏记了 `mcp.hint.stdio`、`mcp.hint.http`、`mcp.save`、`mcp.create`。
  现在清单与实现逐键相等、数量也一致，并由 `test/ui-page.mjs` 断言
  （此前没有任何东西执行这个声明）。

---

## [1.4.4] - 2026-11-08

### 文档

- README 的「MCP servers」一节原文写的是 “every server from every layer”，
  实际范围是 **Cordis/DSH 组合层**（bundle → profile → preset → session plugin），
  只包含本插件自己声明的服务器与外部层插入的 `@deepseek-ai/dsh-mcp-client` 行。
  这句话被读成“机器上所有 MCP 服务器都会出现在这里”，从而在面板为空时被误判
  为丢配置。现改为明确写出边界：本面板**从不读取其它客户端的 MCP 配置**
  （`~/.codex/config.toml`、Claude 等），每个产品各自维护自己的 MCP 注册表；
  想让 DSH 用某个服务器，需要在本面板里显式添加。

无行为变更，仅措辞。

## [1.4.3] - 2026-11-08

### 兼容性验证（DSH 0.2.2-rc.1）

在本机真实部署（DSH 0.2.2-rc.1 + Cordis 4.1.0）上逐项核对，未发现需要适配的
API 变更，但验证过程本身暴露了三处**测试门禁**的问题，一并修掉：

- `test/compat-check.mjs` 的已支持矩阵补入 `0.2.2-rc.1` 与 `0.2.2`。此前矩阵
  停在 `0.2.0-rc.1`，虽然 peer 范围（`>=0.1.7-alpha.1 <0.3.0`）本来就能接受
  0.2.2，但「已验证」这件事没有记录，下一个人无从判断。
- `tests/verify/lib/real-harness.mjs`：`dsh-tool-skill` 在 0.2.2 的 `inject` 列表
  里**新增了 `workingDirectory`**。缺这个服务时该插件根本不进入 apply()，
  `ctx.tools.get('skill')` 恒为 `undefined`，于是 f31 / f3strategy / f3competitor /
  f3cache 四条通过**真实 skill 工具**测量的用例全部报「工具没注册」——看起来像
  API 不兼容，其实是脚手架少 provision 了一个服务。补上后四条全部通过。
- 真实技能树的用例不再写死回答：本机 `~/.hermes/skills` 的 164 个技能已于
  2026-11-07 被删除，而 `host-live.mjs` / `f44` / `scale` / `perf` 里写死的
  「至少 100 个技能」「24 个分类」「恰好一处 github 冲突」在空树上必然失败。
  `host-live.mjs` 改成**先统计磁盘上真实的 SKILL.md 数量**再按这个分母断言
  （任何规模下都成立，并支持 `SKILL_MCP_PANEL_TEST_TREE` 指向别的树）；
  另外三条在树为空时改为 `BLOCKED`——空树上的比例断言不构成任何证据。

### 验证

- `node test/all.mjs`：suites=14、failed=0、blocked=3（f44 / scale / perf，原因
  是真实技能树为空，不是功能缺失）。
- 真实部署上的功能实测：技能开关（勾选→`applied`→读回 `modelInvocable:false`
  →恢复）、`config.set`/`config.unset` 写回 profile patch 且读回一致、
  MCP 新增真 stdio 服务器（1 个工具 `mcp__compatprobe__ping` 进入注册表）→
  关闭→删除（无残留子进程）、跨站 origin 与 text/plain 写入均 403、陈旧
  revision 写入 409。
- 浏览器实测（headless Chromium）：Settings → Built-in plugins → 「Skills & MCP」
  渲染出两个技能根、12 个技能、devops/xag 分类、MCP 空态文案与全部发现设置项；
  展开分类后 10 个 xag 技能逐个列出；点击技能开关返回 `Applied`；
  「Add server」弹出 Transport / Command 表单；控制台无错误。

## [1.4.2] - 2026-11-08

### 变更

- **仓库位置**：本包不再位于 `dsh-plugins/` 根，而是 `dsh-plugins/skill-mcp-panel/`。
  `dsh-plugins/` 是**插件集合目录**（多插件并列 + 本机技能库），不是某个插件的
  源码根；它自己不构成仓库，也不参与任何 profile 安装。包内容与包名未变，
  变的是 checkout 路径，因此按 patch 发布。
- README 的 Layout 与 Install 示例按新位置改写，并说明父目录是容器；
  `docs/skills-layout.md` 明确技能库与各插件项目并列。
- `docs/acceptance.md`、`tests/verify/README.md` 与取证脚本里写死的绝对路径
  更新为新的 checkout 路径。

### 验证

在新位置重跑：包结构引用检查（138 处引用 0 断）、`version-check`、`ui-page`、
`client`、`mcp-live`，并用 `dsh --profile web --dump-config` 确认组合树正常。

## [1.4.1] - 2026-11-08

### 修复

- **宿主重启后，已声明的 MCP 服务器不再启动，而面板仍显示「已启用」。**
  声明存在设置文档里，宿主不会自己实例化它；旧代码只在 add / toggle /
  configure 时挂载，启动路径（`lib/index.js` 的 apply）没有任何 reconcile。
  结果：配置还在、开关是绿的、工具是空的。现在启动后调用
  `mcpManager.restoreDeclared()` 把每条 `enabled: true` 的声明重新挂载；
  挂不上的留下并逐个告警，不会因为一个死服务器拖垮整行插件。
- **开关卡死：`mcp.toggle` 只比较 `mounts`，不比较持久化的意图。**
  重启后 `mounts` 为空而声明仍是 `enabled: true`，于是浏览器发
  `enabled: false`、服务端回 `unchanged「already disabled」`、界面继续显示开启，
  再点还是 `unchanged` —— 点多少次都关不掉，只能靠「编辑并保存」绕开。
  现在 no-op 判定以声明里的意图为准：意图与请求一致才算 `unchanged`，
  「声明为开但没在跑」的关闭请求按 `applied` 处理并落盘。

### 文档

- 新增 `docs/skills-layout.md`：本机技能库 `skills/` 的目录约定、
  `SKILL.md` front matter 要求（`name`/`description` 必填）、以及在
  profile patch 里改根目录的位置。

### 验证

- `test/mcp-live.mjs` 增补 10 条断言覆盖这两条缺陷：启动 reconcile 真的挂载、
  死服务器不谎报 applied、重启后的关闭请求真的落盘。
- 在真实宿主上复现并验证：杀掉已挂载的子进程后触发一次 profile recomposition，
  插件重新实例化并重新拉起子进程（说明修复在运行中的宿主里已生效，无需重启服务）。

## [1.4.0] - 2026-09-28

### 修复

- **DSH 0.2.0-rc.1 把插件标成「异常」并拒绝启用。** 逐项核对 0.2.0 源码后确认，
  插件用到的每个 API 都还在、签名未变；真正的原因是 peer 范围写法：npm 预发布
  语义下 `^0.x.y` 锁定次版本号，`^0.1.7-alpha.1` 等价于 `>=0.1.7-alpha.1 <0.2.0`，
  永远匹配不到 0.2.0。改为显式区间 `>=0.1.7-alpha.1 <0.3.0`。

### 新增

- `test/compat-check.mjs`：调用**部署里那一份** `evaluatePluginCompatibility`
  校验 peer 范围，断言哪些 DSH 版本必须被接受、哪些必须被拒绝，并单独禁止对
  `0.x` 版本使用 caret 范围（即本次事故的写法）。
- README 增补「DSH version compatibility」章节：判定规则、`0.x` caret 陷阱、
  支持矩阵，以及新增 DSH 支持时「先验证 API 再放宽范围」的做法。

### 验证

在隔离安装的真实 DSH 0.2.0-rc.1 上端到端验证：安装后自动选入 bundles 且无异常
标记，`/skill-mcp-panel/state` 返回 200，客户端模块图包含本插件，浏览器打开
「主页 → Plugins → 插件详情页」渲染出完整管理界面且控制台无错误。

## [1.3.0] - 2026-09-22

### 新增

- **插件详情页入口**（提交 `48cc721`）。此前只注册了 `settings.plugins.tab`
  （设置 → 插件），而用户实际走的是「主页 → Plugins → Installed → 本插件」，那个
  页面的扩展点是 `plugins.detail.section`，于是详情页只有 harness 自己渲染的插件
  信息、没有任何设置项。现在两处都注册同一个管理页，并按 `subject` 形状自行判断
  归属，避免出现在别的插件页面上。
- **MCP 新增 / 修改 / 删除**（提交 `48cc721`）。主机端 `lib/mcp.js` 一直实现了
  `mcp.add` / `mcp.configure` / `mcp.remove`，客户端却从未发出过这三种操作，所以
  页面只能切换已有服务器。补齐连接表单：`stdio` 填 `command` / `args` / `env` /
  `cwd`，`streamable-http` 填 `url` / `headers`；密钥始终不明文往返。

### 修复

- **插件详情页空白**（提交 `48cc721`）。归属判断函数定义在 `apply()` 内部，而页面
  组件声明在模块顶层，渲染时抛 `ReferenceError`。该错误只在渲染期出现：模块照常
  激活、设置页照常工作，只有详情页一片空白。修复方式是把 helper 提到顶层作用域，
  并让测试直接渲染详情页组件 —— 此前所有断言都基于设置页标签，碰不到这个组件。

### 变更

- **迁移到 DSH 0.1.7 的插件 API**（提交 `2aa18f3`）。`settings.installSection`
  被移除，改用 `settings.configure({ auto: false })`；可编辑字段必须带
  `.volatile()`（schemastery ≥ 3.18.3）；`settingsScope` 客户端服务被移除。
  上述 API 的移除都是静默失败，因此补了 `test/namespace-check.mjs` 直接对真实包
  做断言。

## [1.2.0] - 2026-09-18

### 新增

- **技能开关、冲突报告、MCP 管理**（提交 `8078ad3`）。开关通过 rank-0 抑制候选
  实现：同名技能被本插件以
  `invocation={modelInvocable:false,userInvocable:false}` 占位，`get()` 返回
  `undefined`，因此名字仍在 `list()` 中但不可调用；变更后必须调用
  `control.invalidate()` 让注册表缓存失效。
- **可安装 bundle 形态**（提交 `49ded37`）。仓库根目录即包：`cordis.patch.yml`
  声明插入行，`locale/*.json` 提供插件显示名与描述，`icon.svg` 提供图标。

### 变更（破坏性，但当时未升版本号 —— 见上文说明）

- 包名从 `dsh-skill-nesting` 改为 `dsh-skill-mcp-panel`。
- 仓库从 `skill-nesting/` 子目录改为根目录即包。

## [1.1.0] - 2026-09-16

### 新增

- 初始版本（提交 `4c9522d` → `6a91986`）。递归、多根的技能发现 provider，可配置
  深度、rank、重复策略、隐藏文件处理与监听；附带一张设置卡片。
