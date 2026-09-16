# dsh-plugins

Plugins for the DeepSeek Harness (DSH), one directory per plugin.

Each plugin is a self-contained package with a host half (`lib/index.js`) and,
where one is needed, a browser half (`lib/client.js`). See each plugin's README
for what it does and how to install it.

## Plugins

| Plugin | Purpose |
| --- | --- |
| [`skill-nesting`](skill-nesting/) | Recursive, multi-root skill discovery with a settings UI and identity-based duplicate handling. |

## Installing a plugin into a profile

A plugin is published to a DSH profile as a dependency plus one composition row.

```sh
# 1. Install the package into the profile
dsh plugin --profile <profile> add /absolute/path/to/dsh-plugins/<plugin>

# 2. Add its row to the profile's patch layer
#    (~/.dsh/profiles/<profile>/cordis.patch.yml)
#    See the plugin's README for the exact row.

# 3. Restart the profile
```

### Why a restart is required after changing a plugin's code

Module source is imported once and cached for the life of the process. A
composition edit reloads only a row's **config** — the loader reuses the cached
module callback — and the common profile ships `hmr` as `disabled: true`. So:

- **config** changes (including a plugin's own Settings UI) apply live;
- **code** changes under `lib/` need a profile restart.

## Working on a plugin

```sh
cd <plugin>
npm install     # only when the plugin declares dependencies
npm test
```

## License

MIT