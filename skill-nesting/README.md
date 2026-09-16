# dsh-skill-nesting

A recursive, multi-root skill provider for the DeepSeek Harness, with a settings
UI and identity-based duplicate handling.

## The problem it solves

The built-in skill provider (`@deepseek-ai/dsh-skill-filesystem`) scans each
skill root **exactly one level deep**. In `discoverRoot()` a direct child
directory counts as a skill only when it contains `SKILL.md`; otherwise the file
is ignored and the directory is never opened. Its filesystem watcher is depth-1
for the same reason, so an edit below the first level never refreshes the catalog.

A categorised skill tree — the layout most skill collections actually use —
therefore contributes nothing at all:

```
~/.agents/skills/
├── creative/                  ← no SKILL.md, so the built-in provider stops here
│   ├── ascii-art/SKILL.md     ← never discovered
│   └── pixel-art/SKILL.md     ← never discovered
└── hf-cli/SKILL.md            ← the only kind that is discovered
```

On this machine that meant 10 of 164 skills were visible and 154 were silently
invisible.

`dsh-skill-nesting` registers an **additional** provider on the same `skills`
registry. The built-in provider keeps running, so nothing is lost: the nested
skills are added alongside the flat ones.

## Duplicate handling

Two different things are easy to conflate. They are treated separately.

**Overlapping roots are not duplicates.** `~/.agents/skills` is commonly a
symlink to `~/.hermes/skills`, so listing both reaches the identical files.
Dedupe is therefore by **canonical file identity** (`ctx.fs` returns a realpath
`targetKey`), not by path text. The same file seen twice is one skill. Before
this, a mirrored root produced one bogus conflict per skill — 139 of them here.

**A name claimed by two distinct files is a real conflict**, and
`duplicatePolicy` decides it:

| Policy | Behaviour |
| --- | --- |
| `first-wins` (default) | The first root that supplies the name keeps it. Safest: never changes what a name already resolved to. |
| `error` | The name is withheld from the catalog entirely, so a caller can never act on the wrong instructions. |

Either way the conflict is reported once per refresh as a single warning naming
the skill and its competing files, rather than one line per duplicate.

## Settings UI

The plugin registers the `skill-nesting` settings namespace, so it appears in
**Settings → Plugins** (that tab enumerates registered Host namespaces and
dispatches a card keyed by namespace).

The card edits every field live — roots, depth, duplicate policy, watch
behaviour, provider name. Apply writes **only the fields you changed** as one
atomic op list, so a value you never saw cannot be cleared by a save.

Changes take effect immediately with no restart and no composition edit. The
composition row's `config` remains the base layer; the settings document layers
over it, and the plugin falls back to the row if settings detach.

## Install

```sh
# 1. Add the package to the profile (installs a link: dependency)
dsh plugin --profile web add /home/sun/workspace/dsh-plugins/skill-nesting

# 2. Add the row to the profile's patch layer
$EDITOR ~/.dsh/profiles/web/cordis.patch.yml

# 3. Restart the profile
```

The row:

```yaml
- insert:
    - id: skill-nesting
      name: 'dsh-skill-nesting'
      config:
        providerName: nested-filesystem
        roots:
          - ~/.agents/skills
          - ~/.hermes/skills
          - ~/.dsh/skills
        maxDepth: 4
```

> `dsh plugin add` reports *"declares no dsh.bundle — installed as a plain
> dependency"*. That warning is correct and harmless: this is a plugin package
> with a browser half, not a bundle that patches the tree itself.

### The restart matters

Module source is imported **once** and cached for the life of the process, and
this profile ships `hmr` as `disabled: true`. A composition edit reloads only the
row's **config** — the cached module callback is reused, so new *code* does not
take effect. After changing `lib/`, restart the profile. Config and Settings-card
changes are live and need no restart.

## Configuration

All fields are optional. Any invalid value throws at mount, naming the field.

| Field | Default | Meaning |
| --- | --- | --- |
| `providerName` | `nested-filesystem` | Provider name in the `skills` registry. |
| `roots` | `[]` | Skill roots to scan. A bare string is accepted for one root. `~` expands. |
| `maxDepth` | `4` | Category levels to descend below each root. |
| `rank` | `300` | Precedence within its layer; lower wins. Built-in root rows use 400/500. |
| `includeHidden` | `false` | Descend into dot-directories such as `.archive` / `.system`. |
| `includeFlatRootFiles` | `true` | Also read flat `<root>/*.md`, matching the built-in layout. |
| `watch` | `true` | Recursively watch each root and refresh the catalog on change. |
| `watchDebounceMs` | `250` | Invalidation debounce. |
| `duplicatePolicy` | `first-wins` | `first-wins` or `error` (see above). |

## Where this row belongs

In the **host composition** (a profile patch layer), not in an agent preset.
`skills` is a host + per-scope layered registry: a provider registered from the
host lands in the GLOBAL layer, so every session — every agent preset and every
subagent — sees the nested catalog. Registering this from one preset would hide
it from all the others.

## Behaviour notes

- **A directory containing `SKILL.md` is a skill and is not descended into**, so
  a skill's own `references/` bundle can never be mistaken for skills.
- **A missing or unreadable root is skipped**, never fatal.
- **Model-blocked skills are excluded.** `disable-model-invocation: true` keeps a
  skill out of the model catalog; `user-invocable: false` is preserved and still
  advertised.
- Frontmatter parsing reads only the top-level `name`, `description`,
  `disable-model-invocation` and `user-invocable` keys, tolerating quoted
  scalars, block scalars (`|`, `>`, and chomping variants), CRLF, a UTF-8 BOM,
  and nested mapping keys such as `metadata.hermes.tags`.

## Layout

```
lib/index.js    host half: the skill provider + the settings namespace
lib/client.js   browser half: the Settings → Plugins card
```

`lib/client.js` is a hand-written `window.__ModuleLoader__.load({ id, factory })`
bundle (the format `tsdown` emits), so no build step is needed. It requires only
`react` from the platform seed. If it ever grows a real build step, keep the
bundle path in `exports["./client"]` and the `dsh.client` block in `package.json`
in sync.

## Tests

```sh
npm test                              # all suites
node test/run.js                      # provider: discovery, dedupe, policy, config
node test/watch.mjs                   # watcher invalidation and re-watch
node test/client.mjs                  # settings card: render, diff, write
node test/namespace-check.mjs         # namespace against the REAL settings provider
node test/realtree.mjs [root ...]     # report what the real tree yields
```

`test/namespace-check.mjs` boots the deployment's actual
`@deepseek-ai/dsh-settings-file` provider, so it proves `installSection`
succeeds for real rather than against a stub. Point `DSH_PROFILE_DIR` at another
profile if needed; it skips cleanly when the provider is absent.

`test/client.mjs` loads the real browser bundle under a minimal React and slot
harness, which is the only way to exercise the card's actual diffing behaviour
without a browser.

## Requirements

Node.js ≥ 20.13 for `fs.watch(..., { recursive: true })`, plus
`@deepseek-ai/schemastery` for the settings schema.