# FTags architecture

A map of the code for anyone extending it. Supported platform: Foundry VTT 14.367; the automatic tags need dnd5e,
manual tags work on any system.

## Layers

```text
scripts/
  main.js                    composition root: instantiates adapter, workspace, coordinator, UI controllers, hooks, and public API
  constants.js               ids, limits, setting and flag names, supported document types
  core/                      pure domain & engine logic — zero game/ui/Hooks/CONFIG/foundry access, unit tested in plain Node
    dictionary.js            tag and dictionary validation, schema coercion, duplicate detection, presets, and import planning
    spotlight.js             computed D&D5e facets, query parsing, ranking, chip contrast, filter pruning, and SpotlightSession state
    refresh.js               RefreshCoordinator: watched-field matching, filter-save echo suppression, selective invalidation, microtask coalescing
    logger.js                the only console writer: "FTags |" prefix, debug output behind the client "debug" setting
  foundry/                   Foundry VTT boundary behind one narrow port (`FoundryWorldPort`)
    foundry-adapter.js       production `FoundryWorldPort` wrapping Foundry globals (`game`, `ui`, `CONFIG`, `foundry.utils`, `fromUuid`)
    workspace.js             deep `TagWorkspace`: dictionary persistence, assignments, locked-pack checks, folder propagation, index deduplication, Spotlight projection
  ui/                        ApplicationV2 windows and directory/context-menu integration (receiving `workspace`/`coordinator` via injection)
    tag-manager.js           tag dictionary manager window (create, edit, delete, presets, export, preview + confirm import)
    tag-assignment.js        tag assignment dialog for world/compendium documents and folders
    spotlight.js             Spotlight search & filter ApplicationV2 controller backed by `SpotlightSession`
    directory-integration.js unified sidebar/compendium row dots, toolbar controls, shared folder resolution, and context menus
    notifications.js         i18n error/info/warning wrappers mapping structured validation error codes to localized messages
```

The dependency direction is strictly one-way: `ui` → `foundry` → `core`. No runtime singleton module exists;
`tests/memory-adapter.js` provides a second real `FoundryWorldPort` implementation for plain-Node verification.

## Data

| What | Where |
| --- | --- |
| Tag dictionary (shared by all GMs) | world setting `ftags.tagDictionary`, schema version 2 |
| Spotlight filters | user setting `ftags.spotlightFilters` |
| Tags of a document or folder | flag `flags.ftags.tagIds` |

Compendium indexes include `flags.ftags` and the fields automatic tags need (`CONFIG[type].compendiumIndexFields`,
set at `init`). Compendium index reads are deduplicated in memory (`TagWorkspace.ensurePackIndexed`), and locked
compendiums reject all tag mutations with `locked-compendium`.

Everything is GM-only: players see no toolbar, markers, manager or context actions, and the API returns empty lists
for them. Tag names live in a world setting, so this is not a security boundary.

## Refreshing

Document updates, folder/document lifecycle events, and settings changes flow into `RefreshCoordinator`, which filters
out non-watched field updates (e.g., hit points), suppresses self-triggered Spotlight filter save echoes, tracks
separate invalidation targets (`directories`, `dictionaryApps`, `assignmentApps`, `spotlightIndex`, `spotlightFilters`),
and coalesces rapid bursts via `queueMicrotask`.

## Localisation

`lang/en.json` and `lang/ru.json`, nested under `FTAGS`; `tools/validate.mjs` checks key parity, placeholders and
every key used in scripts and templates.

## Checks

`npm run check` runs ESLint, `tools/validate.mjs` and the `node --test` suite. `tools/check-ui.mjs` drives
`tools/ui-harness.html` in a browser against a Foundry stand-in wired to the real `TagWorkspace` and UI apps
(screenshots go to `artifacts/`).
