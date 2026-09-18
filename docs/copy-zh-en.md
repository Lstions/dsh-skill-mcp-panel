# 界面文案表（zh / en）

> 供 `lib/client.js` 直接落地为 `ctx.locale.register("skill-mcp-panel", { zh, en })`。
>
> **两个字典的键集合完全一致**：各 **110** 个键（本文件末尾有计数校验证）。
> 键名用点分层级；`{name}` / `{provider}` / `{count}` / `{reason}` 是插值占位，
> 由 `t(key, params)` 替换 —— 不要把它们写死进译文。

## 落地约定

- 全部界面文案**必须**经 `t()` 取得，不得硬编码英文句子（需求 N1）。
- 插值占位在两语中都要保留，且**不要**假设语序相同。
- `status.restartRequired` 与 `status.applied` 的措辞必须可区分：
  前者是「已保存，重启后生效」，**绝不可**读作成功。
- `skills.state.shadowed` 与 `skills.state.disabled` 的措辞必须可区分：
  前者表示**没有真正关闭**（仍由别人提供），后者才是关闭成功。

## 页面与分区

| 键 | 中文 | English |
|---|---|---|
| `tab.label` | 技能与 MCP | Skills & MCP |
| `page.title` | 技能与 MCP 管理 | Skill & MCP management |
| `page.subtitle` | 管理分层技能发现、技能开关、同名冲突与 MCP 服务器。 | Manage nested skill discovery, per-skill switches, duplicate names, and MCP servers. |
| `page.refresh` | 刷新 | Refresh |
| `page.loading` | 正在读取宿主状态… | Reading host state… |
| `page.section.skills` | 技能 | Skills |
| `page.section.conflicts` | 冲突 | Conflicts |
| `page.section.mcp` | MCP 服务器 | MCP servers |
| `page.section.config` | 发现配置 | Discovery settings |

## 状态与反馈

| 键 | 中文 | English |
|---|---|---|
| `status.applied` | 已生效 | Applied |
| `status.restartRequired` | 已保存，重启宿主后生效 | Saved — takes effect after the host restarts |
| `status.refused` | 已被拒绝 | Refused |
| `status.unchanged` | 无需更改 | No change needed |
| `status.working` | 处理中… | Working… |
| `status.stale` | 状态已过期，正在重新读取 | State was stale; re-reading |
| `status.staleRetry` | 状态已过期，已重新读取并重试 | State was stale; re-read and retried |

## 错误与空态

| 键 | 中文 | English |
|---|---|---|
| `error.load` | 无法读取宿主状态。 | The host state could not be read. |
| `error.loadDetail` | 无法读取宿主状态：{reason} | The host state could not be read: {reason} |
| `error.retry` | 重试 | Retry |
| `error.write` | 写入未成功：{reason} | The write did not succeed: {reason} |
| `error.unavailable` | 管理接口不可用（宿主未挂载该端点）。 | The management endpoint is unavailable on this host. |
| `empty.skills` | 没有发现任何技能。请检查「发现配置」中的根目录。 | No skills were discovered. Check the roots under Discovery settings. |
| `empty.conflicts` | 没有同名冲突。 | No duplicate skill names. |
| `empty.mcp` | 还没有配置 MCP 服务器。 | No MCP servers are configured yet. |
| `empty.search` | 没有匹配「{query}」的技能。 | No skills match “{query}”. |

## 技能分区

| 键 | 中文 | English |
|---|---|---|
| `skills.count` | 共 {count} 个技能 | {count} skills |
| `skills.disabledCount` | 已关闭 {count} 个 | {count} disabled |
| `skills.ineffectiveCount` | {count} 个未能真正关闭 | {count} could not be fully disabled |
| `skills.search` | 搜索技能 | Search skills |
| `skills.searchPlaceholder` | 按名称或描述搜索 | Search by name or description |
| `skills.filterRoot` | 按根目录筛选 | Filter by root |
| `skills.filterRootAll` | 全部根目录 | All roots |
| `skills.group.expand` | 展开分组 | Expand group |
| `skills.group.collapse` | 收起分组 | Collapse group |
| `skills.group.count` | {count} 个 | {count} |
| `skills.uncategorised` | （根目录直接层） | (directly under root) |
| `skills.toggle.enable` | 启用「{name}」 | Enable “{name}” |
| `skills.toggle.disable` | 关闭「{name}」 | Disable “{name}” |
| `skills.state.enabled` | 已启用 | Enabled |
| `skills.state.disabled` | 已关闭 | Disabled |
| `skills.state.shadowed` | 已隐藏但未生效，仍由 {provider} 提供 | Hidden here, but still served by {provider} |
| `skills.state.shadowedHint` | 该技能由更近的注册表层提供，本插件无法关闭它。它对模型仍然可见。 | A nearer registry layer provides this skill, so this plugin cannot turn it off. The model can still see it. |
| `skills.state.ineffective` | 已隐藏但未生效 | Hidden but not effective |
| `skills.field.path` | 文件 | File |
| `skills.field.root` | 根目录 | Root |
| `skills.field.category` | 分类 | Category |
| `skills.field.provider` | 提供方 | Provider |
| `skills.field.rank` | 优先级 | Rank |
| `skills.field.model` | 模型可调用 | Model-invocable |
| `skills.field.user` | 用户可调用 | User-invocable |
| `skills.bulk.disableGroup` | 关闭该分组全部技能 | Disable every skill in this group |
| `skills.bulk.enableGroup` | 启用该分组全部技能 | Enable every skill in this group |
| `skills.bulk.result` | 成功 {ok} 个，失败 {failed} 个 | {ok} succeeded, {failed} failed |

## 冲突分区

| 键 | 中文 | English |
|---|---|---|
| `conflicts.count` | {count} 处同名冲突 | {count} duplicate names |
| `conflicts.policy` | 当前策略：{policy} | Current policy: {policy} |
| `conflicts.policy.firstWins` | 先出现的文件获胜 | The first file wins |
| `conflicts.policy.error` | 该名字整个撤下 | The name is withheld entirely |
| `conflicts.winner` | 生效 | In effect |
| `conflicts.loser` | 被覆盖 | Overridden |
| `conflicts.resolvable` | 可通过调整根目录顺序或策略解决 | Resolvable by reordering roots or changing the policy |
| `conflicts.unresolvable` | 本插件无法改变该结果 | This plugin cannot change the outcome |
| `conflicts.explain.firstWins` | 根目录顺序决定胜者；把想要的根目录排到前面即可改判。 | Root order decides the winner; put the root you want first. |
| `conflicts.explain.error` | 策略为「error」时，该名字不会出现在目录中，调用方绝不会读到错的那份。 | Under the “error” policy the name is absent from the catalog, so a caller can never act on the wrong instructions. |

## MCP 分区

| 键 | 中文 | English |
|---|---|---|
| `mcp.count` | {count} 个服务器 | {count} servers |
| `mcp.add` | 添加服务器 | Add server |
| `mcp.edit` | 编辑 | Edit |
| `mcp.remove` | 删除 | Remove |
| `mcp.cancel` | 取消 | Cancel |
| `mcp.confirmRemove` | 确定删除「{name}」？ | Remove “{name}”? |
| `mcp.toggle.enable` | 启用「{name}」 | Enable “{name}” |
| `mcp.toggle.disable` | 关闭「{name}」 | Disable “{name}” |
| `mcp.field.serverName` | 名称 | Name |
| `mcp.field.transport` | 传输方式 | Transport |
| `mcp.field.command` | 命令 | Command |
| `mcp.field.args` | 参数（每行一个） | Arguments (one per line) |
| `mcp.field.env` | 环境变量 | Environment variables |
| `mcp.field.cwd` | 工作目录 | Working directory |
| `mcp.field.url` | 地址 | URL |
| `mcp.field.headers` | 请求头 | Headers |
| `mcp.field.timeout` | 调用超时（毫秒） | Tool call timeout (ms) |
| `mcp.field.failOnStartup` | 启动失败即报错 | Fail on startup error |
| `mcp.target` | 目标 | Target |
| `mcp.phase` | 状态 | Phase |
| `mcp.tools.count` | {count} 个工具 | {count} tools |
| `mcp.tools.none` | 无工具 | No tools |
| `mcp.tools.list` | 已注册工具 | Registered tools |
| `mcp.declared.own` | 本插件配置 | Configured here |
| `mcp.declared.external` | 外部层配置 | Configured by an outer layer |
| `mcp.readonly.managementRequired` | 该行由 DSH 自身管理，不能从这里改动 | The harness manages this row; it cannot be changed here |
| `mcp.readonly.unaddressable` | 该行不在可管理的配置层中 | This row is not in a manageable configuration layer |
| `mcp.external.immutable` | 外部层的服务器只能开关，不能在这里改配置或删除 | Servers from an outer layer can only be toggled, not edited or removed here |
| `mcp.unavailable` | 本机未安装 MCP 客户端，无法连接服务器 | The MCP client is not installed on this host, so servers cannot be connected |
| `mcp.managerUnavailable` | 本机没有插件管理器，只能查看不能开关 | No plugin manager on this host: servers can be listed but not toggled |
| `mcp.nameInvalid` | 名称只能包含字母、数字、下划线或连字符，长度 1–32 | A name may contain only letters, digits, underscores, or hyphens, 1–32 characters |
| `mcp.nameDuplicate` | 名称「{name}」已被占用 | The name “{name}” is already in use |
| `mcp.secretMasked` | 已隐藏（保存时保留原值） | Hidden — the stored value is kept on save |

## 配置分区

| 键 | 中文 | English |
|---|---|---|
| `config.roots` | 技能根目录 | Skill roots |
| `config.rootsHint` | 绝对路径，每行一个。 | Absolute paths, one per line. |
| `config.rootsMissing` | 根目录 {path} 不存在或不是目录 | The root {path} does not exist or is not a directory |
| `config.maxDepth` | 最大深度 | Max depth |
| `config.rank` | 优先级 | Rank |
| `config.duplicatePolicy` | 同名冲突策略 | Duplicate name policy |
| `config.includeHidden` | 包含隐藏目录 | Include hidden directories |
| `config.includeFlatRootFiles` | 包含根目录下的平铺文件 | Include flat files directly under a root |
| `config.watch` | 监视文件变化 | Watch for changes |
| `config.watchDebounceMs` | 监视防抖（毫秒） | Watch debounce (ms) |
| `config.providerName` | Provider 名称 | Provider name |
| `config.save` | 保存配置 | Save settings |
| `config.saved` | 配置已保存 | Settings saved |
| `config.dirty` | 有未保存的修改 | Unsaved changes |

## 计数校验

两个字典必须各含以下 **110** 个键，且集合完全相等：

```
tab.label, page.title, page.subtitle, page.refresh, page.loading,
page.section.skills, page.section.conflicts, page.section.mcp, page.section.config,
status.applied, status.restartRequired, status.refused, status.unchanged,
status.working, status.stale, status.staleRetry,
error.load, error.loadDetail, error.retry, error.write, error.unavailable,
empty.skills, empty.conflicts, empty.mcp, empty.search,
skills.count, skills.disabledCount, skills.ineffectiveCount, skills.search,
skills.searchPlaceholder, skills.filterRoot, skills.filterRootAll,
skills.group.expand, skills.group.collapse, skills.group.count, skills.uncategorised,
skills.toggle.enable, skills.toggle.disable,
skills.state.enabled, skills.state.disabled, skills.state.shadowed,
skills.state.shadowedHint, skills.state.ineffective,
skills.field.path, skills.field.root, skills.field.category, skills.field.provider,
skills.field.rank, skills.field.model, skills.field.user,
skills.bulk.disableGroup, skills.bulk.enableGroup, skills.bulk.result,
conflicts.count, conflicts.policy, conflicts.policy.firstWins, conflicts.policy.error,
conflicts.winner, conflicts.loser, conflicts.resolvable, conflicts.unresolvable,
conflicts.explain.firstWins, conflicts.explain.error,
mcp.count, mcp.add, mcp.edit, mcp.remove, mcp.cancel, mcp.confirmRemove,
mcp.toggle.enable, mcp.toggle.disable,
mcp.field.serverName, mcp.field.transport, mcp.field.command, mcp.field.args,
mcp.field.env, mcp.field.cwd, mcp.field.url, mcp.field.headers,
mcp.field.timeout, mcp.field.failOnStartup,
mcp.target, mcp.phase, mcp.tools.count, mcp.tools.none, mcp.tools.list,
mcp.declared.own, mcp.declared.external,
mcp.readonly.managementRequired, mcp.readonly.unaddressable,
mcp.external.immutable, mcp.unavailable, mcp.managerUnavailable,
mcp.nameInvalid, mcp.nameDuplicate, mcp.secretMasked,
config.roots, config.rootsHint, config.rootsMissing, config.maxDepth, config.rank,
config.duplicatePolicy, config.includeHidden, config.includeFlatRootFiles,
config.watch, config.watchDebounceMs, config.providerName,
config.save, config.saved, config.dirty
```

上面这张清单必须与实现里的 `Object.keys(zh)` / `Object.keys(en)` **逐字相等**。
`test/ui-i18n.mjs` 会断言两件事：两字典键集合相等；且这个清单里的每个键都在实现中存在。
