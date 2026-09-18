# tests/verify — independent adversarial acceptance suite

Owned by **qa-verify** (task-5). This suite does **not** re-run the developers' own
tests and treat them as evidence. It boots the **real** Cordis context with the
**real** `@deepseek-ai/dsh-skill` registry and asserts against real observed values.

## Why it can import the real packages

The plugin's own `node_modules` cannot resolve `@deepseek-ai/dsh-skill`
(symlinks are stale / the package is not a dependency). So `lib/real-harness.mjs`
resolves the packages by **absolute path** out of the pnpm store. The store path
contains a hash, so it is discovered by glob at runtime, never hard-coded.

## Run

```bash
cd /home/sun/workspace/dsh-plugins
node tests/verify/run.mjs                  # every case, grouped
node tests/verify/run.mjs f31 f33          # only named cases
node tests/verify/run.mjs --list           # names only
```

Exit code is non-zero if any case fails. `test/all.mjs` runs this
whole suite as its last group, so `npm test` covers it.

## Case index

| Case | Requirement | What it independently proves |
|---|---|---|
| `f31` | F3.1 + F3.2 + F3.6 | Close reaches the **real** `skill` tool; re-open restores; `SKILL.md` md5+mtime+size unchanged |
| `f3strategy` | F3.1 | Inert contention defeats a same-layer rival; omitting the name concedes it |
| `f3competitor` | F3.1 | **The highest-value case**: with a same-layer rival, close must still take effect (drives the shipped provider) |
| `f3cache` | F3.1 | A toggle really invalidates the registry cache (`before !== after`), with a live-cache self-check |
| `f33` | F3.3 | Near-layer (preset scope) override reported honestly as `effective=false`, never "closed" |
| `f44` | F4.2 + F4.4 | Real symlink alias is not a conflict; conflict winners match the live registry |
| `f63` | F6.3 + F6.5 | A dead MCP server is never `applied`; a live one really registers its tool |
| `scale` | F1 + F4 | Real-tree denominators recomputed from scratch, with the口径 and both category conventions printed |
| `n4` | N4 | Cross-origin / non-JSON rejected (with a same-origin control); no real secret in a GET body; mask write-back preserves it |
| `perf` | N5 | `state` endpoint P95 with raw per-sample numbers **and** a payload-size non-vacuity guard |
| `degrade` | N6 | Missing `pluginManager` / `settings` / MCP client degrade loudly, never crash |
| `mutation` | §5.3 | Gate self-proof: break → **assertion** red → restore → hash identical |

Cases whose feature has not landed yet report **BLOCKED** (not PASS). A blocked
case never counts as evidence.