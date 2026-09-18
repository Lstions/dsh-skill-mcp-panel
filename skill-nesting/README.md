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

The plugin contributes **two** surfaces, both under **Settings → Plugins**:

| Surface | Slot | What it is |
|---|---|---|
| Settings card | `settings.plugin.item` | Discovery configuration (roots, depth, rank, policy, watch). Reads the `skill-nesting` settings namespace. |
| **Management page** | `settings.plugins.tab` | Skills, conflicts, MCP servers, and discovery settings. Reads the plugin's **own HTTP channel**, not `settingsScope`. |

### The management page

The card's namespace-based data path is unavailable on a non-loopback page (see
the section below), so the page deliberately does not use it. It fetches
`GET /skill-nesting/state` and posts `POST /skill-nesting/apply`, which the Host
serves over whatever address the Web server is bound to. It has four sections:

- **Skills** — grouped by category with every group **collapsed by default**
  (a real tree here has 135 skills, which must not all render at once).
  Searching or filtering opens the matching groups automatically, because a
  filtered list the user cannot see reads as "no results". Each row shows name,
  description, path, root, provider, rank and both invocation flags, and carries
  one switch.
- **Conflicts** — every name claimed by more than one file, with the winner and
  all losers (path, root, provider, rank) and the policy in force.
- **MCP servers** — every server from every layer, with transport, target, live
  phase, tool count and registered tool names (counted from the real tool
  registry, never inferred from configuration). Servers this plugin declared can
  be added, edited, removed and toggled; rows from an outer layer can only be
  toggled, and a row the harness itself manages is shown read-only with the
  reason.
- **Discovery settings** — roots, depth, rank, duplicate policy, hidden/flat
  handling, watch and debounce.

Two wording rules are load-bearing, and both are asserted by tests:

1. **`restart-required` is never worded as success.** A server that could not be
   mounted live says "saved — takes effect after the host restarts".
2. **A skill that could not actually be disabled is never shown as off.** When a
   nearer registry layer still serves the name, the row reads "hidden here, but
   still served by `<provider>`" with an explanation, rather than claiming the
   switch worked.

**Bilingual** throughout: `zh` and `en` dictionaries are merged into a single
registration per locale (the locale service rejects a second registration for a
locale a namespace already has), and every visible string — including
`aria-label`s and error copy — resolves through `t()`. The two dictionaries are
asserted to have identical key sets, and the page is asserted to render in
Chinese under the `zh` locale.

### The settings card

The card follows the same conventions as the shipped plugin cards:

- **A collapsed disclosure card.** It renders an `<li>` with a header button
  (name + description + chevron) and discloses its controls in place, rather
  than spilling a flat form down the page. Collapsed is the default; it
  auto-collapses again once a save settles.
- **Bilingual.** `zh` and `en` dictionaries are registered through `ctx.locale`,
  and the slot declares its locale namespace, so the card follows the active
  locale — no re-registration needed on a language switch. Labels, hints and
  validation messages are all translated.
- **Staged edits.** Controls hold drafts; **Save** writes only the fields you
  changed as one atomic op list, so a value you never saw cannot be cleared.
  **Discard changes** drops the draft. A field with a user override shows an
  *Overridden* badge and a *Reset* action that writes an `unset`.
- **Per-field validation.** Out-of-range depth, a non-numeric value, an empty
  provider name and an unknown policy mark the field and disable Save with an
  explanation, instead of failing at the Host.
- **An *Unsaved* badge** marks a pending edit.

The intro copy is shown only once expanded. A namespace this Host does not serve
renders **nothing at all**, so an uncomposed plugin leaves no trace on the page.

Changes take effect immediately with no restart and no composition edit. The
composition row's `config` remains the base layer; the settings document layers
over it, and the plugin falls back to the row if settings detach.

### Why the card can appear empty over a non-loopback address

Reading the settings document is gated by DSH itself, not by this plugin:
`dsh-client-ui-settings` computes

```js
const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";
```

and `isLoopback` is true only for `localhost`, `[::1]`, and `127/8`. On any other
address — `100.64.0.10`, `192.168.20.3`, `R5-5600.local` — persistence is
`memory`, the scope starts `unavailable`, and the mirror never crosses the wire.
This is documented as a known limitation in `dsh-client-ui-settings`:

> Non-loopback pages get no durable settings — this Client keeps Host persistence
> disabled there, so a scope starts `unavailable` and never crosses the wire;
> every row it backs is inert even though Connection authentication covers the API.

Note the plugin **list** still renders over such an address, because it reads a
different source (`remote.pluginInventory`, a plain RPC). So "plugin list is
visible but every configuration card is empty" is the expected signature of this
gate. Use `http://127.0.0.1:<port>` (or an SSH tunnel) to configure plugins. The
namespace itself registers fine either way.

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
| `skills` | `{}` | Persisted disable table: `{ '<name>': true }` means "disabled". |
| `writeAccess` | `same-origin` | `same-origin` or `loopback` (see Security below). |
| `mcpServers` | `[]` | MCP servers this plugin declares and owns. |

## Skill enable/disable

Disabling a skill changes **only what this provider advertises**. It never
edits, moves, or deletes a `SKILL.md` — a test asserts the file's md5 and mtime
are unchanged across a toggle.

### Why "off" means "win the name", not "stop publishing it"

A provider may only ADD candidates to the registry; it cannot withdraw one
another provider published. Two strategies were measured against the real
`SkillRegistry` **with a same-layer competitor also publishing the name**:

| Strategy | Catalog result | Model catalog | `get(name)` |
| --- | --- | --- | --- |
| **inert** (used here) — win the name with `invocation: {modelInvocable:false, userInvocable:false}` | `x <- nested-filesystem (model=false)` | `[]` | `undefined` |
| **omit** — stop publishing the name | `x <- same-layer-competitor (model=true)` | `[x]` | competitor's real body |

Omitting **fails silently exactly when it matters**: yielding the name hands it
to whoever else claims it, so the skill stays live and loadable while the user
believes it is off. Winning the name is the only strategy that actually
suppresses it.

The consequence is that a disabled name **stays in `ctx.skills.list()`**, carried
by this plugin's suppression candidate with both invocation flags false. That is
correct, not a defect: every model-facing and user-facing consumer filters on
invocation policy, so both catalogs show nothing, and `ctx.skills.get()` returns
`undefined`, which the `skill` tool reports as unknown. A UI must therefore judge
"did the toggle work?" by the invocation flags and the winning provider — never
by the name's presence in `list()`.

### What cannot be disabled

A skill owned by a **nearer** registry layer — a preset that mounts its own
`skill-filesystem` into its own scope — cannot be suppressed from here. The
registry merges `[global, ...scope chain]`, and a nearer layer wins a duplicate
name **outright**; `rank` is only consulted *within* one layer. Such a skill is
reported `effective: false` with `shadowedBy` naming the provider that still
serves it, and its `detail` says so in plain words. It is never reported as
disabled.

### The invalidate is mandatory

`SkillRegistry` memoises collected catalogs per revision. Changing what `list()`
returns without calling the registration's `control.invalidate()` leaves the OLD
catalog in place, and the toggle appears to do nothing. `lib/index.js` funnels
every toggle path through one `syncToggles()`, so no path can forget it.

## Management HTTP channel

The Settings card cannot work over a non-loopback address (see above), so this
plugin also publishes its own endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/skill-nesting/state` | The whole state document, secrets masked. |
| `POST` | `/skill-nesting/apply` | A batch of operations; returns per-op results **and** the new state. |

Deliberately **not** under `/api`, which is the gateway's RPC surface.

### Security — stated plainly

**There is no authentication.** Reads are safe by construction: secret-bearing
configuration is masked before it leaves the process, so a token never reaches
the browser. Writes require a same-origin request with
`Content-Type: application/json` (via the contract's `isSameOriginWrite`), which
blocks cross-site form posts; `writeAccess: 'loopback'` tightens that further to
loopback sockets only. The intended deployment is a **trusted LAN** — this is not
an internet-facing control plane.

Masking covers **every depth**, not just the top level: an MCP config hides its
secrets inside `env` / `headers`, so a top-level-only pass would leak them. The
key grammar is still the contract's own `maskSecret`.

If a deployment has no `webServer` service, the endpoints are simply not
registered; every other feature keeps working.

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
lib/index.js    host half: the skill provider, settings namespace, wiring
lib/toggle.js   suppression mechanics + read-back verdicts
lib/state.js    the state document: skills, conflicts, roots, masking
lib/http.js     the two management endpoints and their write gate
lib/mcp.js      MCP server inventory, toggling and lifecycle
lib/contract.js frozen wire contract shared by every surface and the tests
lib/client.js   browser half: the settings card AND the management page
```

`lib/client.js` is a hand-written `window.__ModuleLoader__.load({ id, factory })`
bundle (the format `tsdown` emits), so no build step is needed. It requires only
`react` from the platform seed — styles are injected as a scoped `<style>` tag
and UI text comes from the locale dictionaries, so it needs no other package. If
it ever grows a real build step, keep the bundle path in `exports["./client"]`
and the `dsh.client` block in `package.json` in sync.

A client bundle cannot `import` a sibling file — the module system resolves
package specifiers, not relative paths — so the page's copy of the wire names
(`PAGE_CONTRACT`) and its dictionaries live inside the bundle. They are generated
from `lib/contract.js` and `docs/copy-zh-en.md` and are kept honest by
`test/ui-page.mjs`, which asserts the page dictionary's key set and the
`zh`/`en` sets stay identical. Do not hand-edit one without the other.

## Tests

```sh
npm test                              # all suites, non-zero on any failure
node test/run.js                      # provider: discovery, dedupe, policy, config
node test/watch.mjs                   # watcher invalidation and re-watch
node test/client.mjs                  # settings card: render, diff, write
node test/ui-page.mjs                 # management page: sections, N3, three-state, i18n
node test/namespace-check.mjs         # namespace against the REAL settings provider
node test/realtree.mjs [root ...]     # report what the real tree yields

# Host half (real `SkillRegistry`, real HTTP server, real skill tree)
node test/host-toggle.mjs             # suppression mechanics, read-back verdicts
node test/host-state.mjs              # skills, conflicts, roots, masking, cache
node test/host-http.mjs               # the wire contract: origin gate, status codes
node test/host-live.mjs               # toggle end to end + real-tree scale and P95

# MCP (real Cordis tree, real MCP stdio server)
node test/mcp-inventory.mjs           # discovery, masking, validation, status mapping
node test/mcp-live.mjs                # mount, tool registration, dispose, dead servers
```

`npm test` also runs the independent adversarial suite in `tests/verify`, which
carries its own mutation proofs. It reports `BLOCKED` separately from `FAIL` and
names any `SKIPPED` suite loudly, because a suite that self-skips has verified
nothing and must never read as green.

The `host-*` suites boot the **real** `@deepseek-ai/dsh-skill` registry rather
than a stub, because the behaviours under test — layer priority, the
`rank -> providerOrder -> localOrder` tie-break, the collect cache — are the
registry's, not this plugin's beliefs about them. They include the decisive
"same-layer competitor" case that distinguishes winning the name from yielding
it, and an end-to-end suite that drives a toggle through the real HTTP endpoint
and reads the result back out of the live catalog.

`test/mcp-live.mjs` mounts `@deepseek-ai/dsh-mcp-client` for real against a real
MCP stdio server process, and asserts the tool appears in the registry and
disappears on dispose. It also pins the honesty requirement: a server whose
command does not exist must report `restart-required`, never `applied`.

`test/namespace-check.mjs` boots the deployment's actual
`@deepseek-ai/dsh-settings-file` provider, so it proves `installSection`
succeeds for real rather than against a stub. Point `DSH_PROFILE_DIR` at another
profile if needed. It locates the package through the profile and then the pnpm
content store, so it does not silently self-skip when a profile symlink dangles —
a skip there once made "9/9 passed" a green that never executed.

`test/client.mjs` and `test/ui-page.mjs` load the real browser bundle under a
minimal React, locale, and slot harness. They drive the UI as a user would —
expand a card, open a category, flip a switch — and assert collapsed-by-default
disclosure, diff-based writes, per-field validation, override/reset, that both
dictionaries are complete and resolve under a locale switch, and (the
load-bearing one) that the **management page still renders and still toggles with
no usable settings scope**, which is what a non-loopback page gets. That is the
only way to exercise this behaviour without a browser.

## Requirements

Node.js ≥ 20.13 for `fs.watch(..., { recursive: true })`, plus
`@deepseek-ai/schemastery` for the settings schema.