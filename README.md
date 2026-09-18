# dsh-skill-mcp-panel

A recursive, multi-root skill provider for the DeepSeek Harness (DSH), with
per-skill switches, duplicate-name reporting, MCP server management, and a
bilingual settings UI.

The package at the repository root **is** the plugin: `package.json` declares
`dsh.bundle.patch`, so installing it also gives the profile a composition layer.
There is no separate subdirectory to point at.

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
│   ├── pixel-art/SKILL.md     ← never discovered
│   └── ...
├── software-development/      ← never opened
│   └── ...
└── one-flat-skill/SKILL.md    ← the only kind the built-in provider can see
```

This plugin registers an **additional** provider on the same `skills` registry.
It walks each configured root to a configurable depth, so categorised trees are
discovered, and it registers from the host composition, which puts it in the
registry's global layer where every session (subagents and agent presets
included) can see what it finds.

It also de-duplicates by **file identity** rather than by path text. That
distinction is load-bearing on a real machine: `~/.agents/skills` is often a
symlink to `~/.hermes/skills`, and comparing paths would report every skill as a
duplicate of itself.

## Install

The package root **is** the plugin, and it declares `dsh.bundle.patch`, so one
command installs *and* activates it:

```sh
dsh plugin --profile web add /absolute/path/to/this/repo
# then restart the profile
```

That works because the launcher reconciles installed dependencies against
`dsh.profile.bundles`: **a dependency that declares a bundle is selected
automatically** (this is `reconcileProfilePlugins` in `dsh-app-boot`). A
dependency *without* a bundle patch is reported as a plain dependency and
contributes no rows — which is the trap this package used to fall into when its
manifest carried no `dsh.bundle`.

Verify what happened:

```sh
# the name should appear in dsh.profile.bundles, not only in dependencies
cat ~/.dsh/profiles/web/package.json
```

### The default row carries neutral values

`cordis.patch.yml` inserts one row with **no roots configured**. Root paths are
site-specific, so they belong to the machine that mounts the plugin — set them
in the profile's own `cordis.patch.yml` (applied after every bundle layer, so it
wins), or at runtime in **Settings → Plugins**, which needs no restart:

```yaml
- insert:
    - id: skill-mcp-panel
      name: 'dsh-skill-mcp-panel'
      config:
        roots:
          - ~/.agents/skills
          - ~/.hermes/skills
          - ~/.dsh/skills
        maxDepth: 4
        duplicatePolicy: first-wins
```

### The restart matters

Module source is imported **once** and cached for the life of the process, and
this profile ships `hmr` as `disabled: true`. A composition edit reloads only the
row's **config** — the cached module callback is reused, so new *code* does not
take effect. After changing `lib/`, restart the profile. Config and Settings-card
changes are live and need no restart.

## Features

| Feature | What it does | Where |
|---|---|---|
| **Nested discovery** | Walks each root to `maxDepth`, so `<root>/<category>/<skill>/SKILL.md` is found | Provider |
| **Per-skill switches** | Turn a skill off so neither the model nor a user command can reach it | Management page |
| **Duplicate reporting** | Shows every contested name with its winner and all losers | Management page |
| **MCP management** | Lists servers from every layer; add, edit, remove, enable, disable | Management page |
| **Discovery settings** | Roots, depth, rank, duplicate policy, hidden/flat handling, watch | Card **and** page |

## Settings UI

The plugin contributes **two** surfaces, both under **Settings → Plugins**:

| Surface | Slot | What it is |
|---|---|---|
| Settings card | `settings.plugin.item` | Discovery configuration. Reads the `skill-mcp-panel` settings namespace. |
| **Management page** | `settings.plugins.tab` | Skills, conflicts, MCP servers, and discovery settings. Reads the plugin's **own HTTP channel**, not `settingsScope`. |

### The management page

The card's namespace-based data path is unavailable on a non-loopback page (see
below), so the page deliberately does not use it. It fetches
`GET /skill-mcp-panel/state` and posts `POST /skill-mcp-panel/apply`, which the
Host serves over whatever address the Web server is bound to. It has four
sections:

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
Chinese under the `zh` locale. The copy table lives in
[`docs/copy-zh-en.md`](docs/copy-zh-en.md).

### The settings card

The card follows the same conventions as the shipped plugin cards:

- **A collapsed disclosure card.** It renders an `<li>` with a header button
  (name + description + chevron) and discloses its controls in place, rather
  than spilling a flat form down the page. Collapsed is the default; it
  auto-collapses again once a save settles.
- **Bilingual.** `zh` and `en` dictionaries are registered through `ctx.locale`,
  and the slot declares its locale namespace, so the card follows the active
  locale — no re-registration needed on a language switch.
- **Staged edits.** Controls hold drafts; **Save** writes only the fields you
  changed as one atomic op list, so a value you never saw cannot be cleared.
  **Discard changes** drops the draft. A field with a user override shows an
  *Overridden* badge and a *Reset* action that writes an `unset`.
- **Per-field validation.** Out-of-range depth, a non-numeric value, an empty
  provider name and an unknown policy mark the field and disable Save with an
  explanation, instead of failing at the Host.
- **An *Unsaved* badge** marks a pending edit.

A namespace this Host does not serve renders **nothing at all**, so an
uncomposed plugin leaves no trace on the page.

### Why the card can appear empty over a non-loopback address

Reading the settings document is gated by DSH itself, not by this plugin:

```js
const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";
```

`isLoopbackHostname` accepts only `localhost`, `[::1]` and `127/8`. Open the
harness at a LAN address such as `http://100.64.0.10:3080` and the client's
settings scope starts `unavailable`, so a namespace-backed card renders nothing
(`dsh-client-ui-settings/README.md` states this as intended: *"Non-loopback pages
get no durable settings"*).

That is why the **management page** exists and why it uses this plugin's own HTTP
routes: it works over any address the Web server is bound to. The
`--trusted-host` flag does not change this; it governs the `/api` browser-trust
fence, not the settings persistence gate.

## Skill enable/disable

Turning a skill off makes it invisible to both the model catalog and user
commands, **without touching any file**. Tests assert the `SKILL.md` md5, mtime
and size are unchanged.

### Why "off" means "win the name", not "stop publishing it"

A skill provider may only **add** candidates. It cannot withdraw a candidate
another provider published, and it cannot remove a file from a user's tree. The
registry merges layers as `[global, ...scope chain]` — a **nearer** layer wins a
duplicate name outright — and within one layer candidates sort by
`rank -> providerOrder -> localOrder`, first one wins.

So "off" publishes a candidate for the **same name** at rank 0 carrying
`invocation = { modelInvocable: false, userInvocable: false }`, and answers
`get()` with `undefined`. The name **stays in `ctx.skills.list()`** — that is the
correct shape, not a defect.

The obvious alternative — simply not publishing our candidate — was **measured
and rejected**. It *yields* the name: if another provider in the same layer also
offers it, that provider takes the slot and serves the skill the user just
switched off. `tests/verify/cases/f3competitor.mjs` pins this, and goes red if
anyone "simplifies" it back.

### What cannot be disabled

A nearer layer beats our rank outright, so a skill owned by a provider mounted in
an agent preset's **scope** cannot be suppressed from here. On a real machine the
presets mount `skill-filesystem` into their own scope and it scans depth 1, so
**the skills sitting directly under a root (10 of 135 here) are owned by that
nearer layer**, while the categorised ones (125) are ours to switch off.

Every outcome is therefore **read back** from the merged catalog rather than
assumed. A skill that is still served elsewhere is reported `effective: false`
with `shadowedBy` naming that provider, and the page says so.

### The invalidate is mandatory

`registerProvider` hands back a control handle. Its `invalidate()` **must** be
called after every toggle, or the registry serves its cached collection and the
switch appears to do nothing. A test drives consecutive reads and asserts the
verdict actually flips.

## MCP management

Each MCP server is one `@deepseek-ai/dsh-mcp-client` row. The plugin reports
servers from **every** layer — the ones it declares itself, and rows an outer
patch inserted — because a list that showed only its own would hide exactly the
servers a user most likely added by hand.

Live mounting was **measured**, not assumed: the module is obtained through
`ctx.loader.import('@deepseek-ai/dsh-mcp-client')` (the plugin cannot import that
package itself — pnpm only links declared dependencies, so a bare import fails
with `ERR_MODULE_NOT_FOUND`) and mounted with `ctx.plugin(module, config)`. Note
that `mcp-client` is a **namespace plugin with no default export**, so the module
object itself is passed.

Two honesty requirements, both tested:

- **`applied` is only reported after the mount settles *and* the expected tools
  are observed in the registry.** Anything less is `restart-required`. The client
  defaults `failOnStartupError` to `false`, under which a *failed* connection
  settles successfully with zero tools — so awaiting the fiber alone would report
  success for a server that never ran. Live mounts force that flag on (affecting
  only the in-memory instance; the persisted config keeps the user's value).
- **A tool-less server is not a failed server.** A server that legitimately
  exposes no tools is reported as connected, not as broken.

## Management HTTP channel

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/skill-mcp-panel/state` | The whole state document, secrets masked. |
| `POST` | `/skill-mcp-panel/apply` | A batch of operations; returns per-op results **and** the new state. |

The paths sit **outside `/api`** deliberately: `/api` is the Typert gateway's RPC
surface, and claiming a path inside it would collide with that multiplexer.

Every write is fenced:

- **Revision fence.** The client echoes the revision it last read; a stale write
  is refused with **409** and the current state, and the page rebases and retries
  once. A stale revision is a concurrency guard, not a user error.
- **Same-origin + JSON.** A write must carry a matching `Origin` and an
  `application/json` content type. A cross-origin form post cannot set that
  content type without a preflight it will not pass.
- **`writeAccess`** may be tightened to `loopback` in configuration.

### Security — stated plainly

These endpoints are **not authenticated**. They are served to anything that can
reach the port, exactly like the rest of the Web surface. The fence stops
cross-site browser writes; it does not stop a direct network client. Treat the
bind address as the security boundary: keep the harness on loopback unless you
trust every host that can reach it.

Secrets are **never** returned in the clear. The contract's `maskDict` is
**shallow**, which left tokens nested inside a server's `env`/`headers` visible
over the wire, so `lib/state.js` walks the whole structure with `maskSecret`'s
lexicon. Submitting a mask back **preserves the stored value** rather than
overwriting a live secret with the mask.

## Configuration

All fields are optional. Any invalid value throws at mount, naming the field.

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `nested-filesystem` | Name this provider registers in the `skills` registry. |
| `roots` | `[]` | Absolute skill roots. A string is accepted as a one-item list. |
| `maxDepth` | `4` | Category levels to descend below each root. |
| `rank` | `300` | Precedence **within its layer**; lower wins. The built-in roots use 400/500. |
| `includeHidden` | `false` | Descend into dot-directories such as `.archive`. |
| `includeFlatRootFiles` | `true` | Also read skills written as `<root>/*.md`. |
| `watch` | `true` | Watch each root and refresh the catalog on edits. |
| `watchDebounceMs` | `250` | Debounce before a change refreshes the catalog. |
| `duplicatePolicy` | `first-wins` | `first-wins` keeps the first root's file; `error` withholds the name entirely. |
| `skills` | `{}` | Per-skill switches, written by the management page. |
| `mcpServers` | `[]` | MCP servers this plugin declares and owns. |
| `writeAccess` | `same-origin` | `same-origin` or the stricter `loopback`. |

## Where this row belongs

Keep this row in the **host composition** (the profile patch layer). `skills` is
a host + per-scope layered registry: registering from the host puts the provider
in the **global** layer, visible to every session. Registering it inside an agent
preset would make it visible only to sessions on that preset.

## Behaviour notes

- With **no roots**, the row mounts and contributes nothing. It logs one warning
  rather than failing, so a freshly installed bundle is inert but not broken.
- **A directory containing `SKILL.md` is a skill and is not descended into**, so
  a skill's own `references/` or `scripts/` subdirectories never become skills.
- **Duplicate resolution is per layer.** Within the layer this provider registers
  in, `rank -> providerOrder -> localOrder` decides; across layers the nearer one
  wins, whatever the ranks say.
- **The `error` policy withholds a name**, so a caller never acts on the wrong
  instructions — at the cost of the skill being unavailable rather than
  arbitrary.
- **Roots that do not exist** are reported per-root (`exists: false`) instead of
  failing the whole scan.

## Layout

```
package.json      the package MANIFEST: dsh.bundle.patch + dsh.client
cordis.patch.yml  the BUNDLE LAYER: inserts this plugin's row (neutral defaults)
lib/index.js      host half: the skill provider, settings namespace, wiring
lib/toggle.js     suppression mechanics + read-back verdicts
lib/state.js      the state document: skills, conflicts, roots, masking
lib/http.js       the two management endpoints and their write gate
lib/mcp.js        MCP server inventory, toggling and lifecycle
lib/contract.js   frozen wire contract shared by every surface and the tests
lib/client.js     browser half: the settings card AND the management page
docs/             requirements, UX notes, the zh/en copy table, acceptance record
tests/verify/     the independent adversarial acceptance suite
```

`lib/client.js` is a hand-written `window.__ModuleLoader__.load({ id, factory })`
bundle (the format `tsdown` emits), so no build step is needed. **Its `id` must
equal the package name** — the browser module table keys on it. It requires only
`react` from the platform seed; styles are injected as a scoped `<style>` tag and
UI text comes from the locale dictionaries.

A client bundle cannot `import` a sibling file — the module system resolves
package specifiers, not relative paths — so the page's copy of the wire names and
its dictionaries live inside the bundle. They are generated from `lib/contract.js`
and `docs/copy-zh-en.md` and kept honest by `test/ui-page.mjs`. Do not hand-edit
one without the other.

`dsh.client.inject` lists the client packages that must be registered **before**
this bundle (the module graph loads a row's declared inject entries first), hence
`@deepseek-ai/dsh-client-locale` alongside `@deepseek-ai/dsh-client-ui-settings`:
the page renders every string through `ctx.locale`.

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

## License

MIT