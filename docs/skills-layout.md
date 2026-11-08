# 技能库布局（`dsh-plugins/skills/`）

本机技能库的新家：`/home/sun/workspace/dsh-plugins/skills`，和各个插件项目并列放在
插件集合目录里（不是某个插件的源码目录内部）。

## 目录规则

```
skills/
├── <分类>/            # 可选，任意层级，最深 maxDepth 层（默认 4）
│   └── <技能>/
│       ├── SKILL.md   # 必须有，且以 YAML front matter 开头
│       ├── references/
│       └── scripts/
└── <技能>/            # 也可以直接平铺在根下
    └── SKILL.md
```

- 一个目录里只要有 `SKILL.md`，它就是一个技能，插件**不会**再向下遍历，
  所以技能自带的 `references/`、`scripts/` 不会被误当成子技能。
- `SKILL.md` 必须以 `---` 开头，front matter 里 **`name` 和 `description`
  是必填**，缺任何一个都会被跳过并在面板的 errors 里报告。`name` 需匹配
  `^[A-Za-z0-9_-]{1,32}$`。
- `includeFlatRootFiles: true` 时，根目录下的**平铺 `*.md`** 也会被当作技能
  候选（兼容内置布局）。因此 **不要**在这个目录里放 `README.md` 之类的说明
  文档——它会被解析失败并计入 errors。说明文档放这里（`docs/`）。

最小可用示例：

```markdown
---
name: my-skill
description: "一句话说明什么时候用这个技能。"
---

# My Skill

正文……
```

## 配置位置

技能根目录在 profile patch 里配置，改完即时生效（无需重启）：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: skill-mcp-panel
  config:
    roots:
      - /home/sun/workspace/dsh-plugins/skills
      - /home/sun/.agents/skills
```

运行时也可以在 Web UI 的 **设置 → 插件 → 技能与 MCP** 页直接改。

## 版本管理

`dsh-plugins/` 是一个**插件集合目录**，不是仓库：每个插件项目是它自己的子目录
（`skill-mcp-panel/`、`loop-guard/`、`web-password-auth/`），各自带自己的 git
仓库（`loop-guard` 暂无）；`skills/` 与它们并列，是独立内容。

所以技能库不属于任何插件的仓库，要版本化就在
`/home/sun/workspace/dsh-plugins/skills` 里单独 `git init`。