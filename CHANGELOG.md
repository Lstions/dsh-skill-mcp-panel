# 变更记录

本文件记录 `dsh-skill-mcp-panel` 的每个版本。

版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)；每个已发布版本都对应一个
`vX.Y.Z` git tag，tag 指向的提交就是该版本的确定内容。

---

## 版本历史（含一次未能守住的记录）

| 版本 | 日期 | 提交 | 内容 |
|---|---|---|---|
| 1.4.2 | 2026-11-08 | 见下 | 源码移入插件集合目录的子目录；文档随之更新 |
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

---

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
