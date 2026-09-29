# FTags architecture

A map of the code for anyone extending it. Supported platform: Foundry VTT 14.367; the automatic tags need dnd5e,
manual tags work on any system.

## Layers

```text
scripts/
  main.js            composition root: settings, hooks, keybinding, public API, refresh scheduling
  constants.js       ids, limits, setting and flag names, directory selectors
  runtime.js         the shared TagRepository and TagService instances
  core/              pure logic — no game/ui/Hooks access, unit tested in plain Node
    model.js           tag and dictionary validation, schema coercion, folder traversal helpers
    search.js          Spotlight query parsing and matching (Russian/English aliases, CR predicates)
    automatic-tags.js  computed dnd5e tags (creature type, CR, item type, rarity, weapon range)
    presets.js         built-in tag sets
    logger.js          the only console writer: "FTags |" prefix, debug output behind the client "debug" setting
  foundry/           Foundry-bound services
    repository.js      settings, document flags, compendium indexing
    service.js         tag operations for the UI: assign, delete with cleanup, folder propagation
  ui/                ApplicationV2 windows (tag manager, assignment, Spotlight), directory markers, context menus
```

The dependency direction is one-way: `ui` → `foundry` → `core`.

## Data

| What | Where |
| --- | --- |
| Tag dictionary (shared by all GMs) | world setting `ftags.tagDictionary`, schema version 2 |
| Spotlight filters | user setting `ftags.spotlightFilters` |
| Tags of a document or folder | flag `flags.ftags.tagIds` |

Compendium indexes include `flags.ftags` and the fields automatic tags need (`CONFIG[type].compendiumIndexFields`,
set at `init`). Locked compendiums cannot be tagged; the UI warns instead of saving.

Everything is GM-only: players see no toolbar, markers, manager or context actions, and the API returns empty lists
for them. Tag names live in a world setting, so this is not a security boundary.

## Refreshing

Document and setting changes are coalesced with `queueMicrotask` into one re-render of the directories and the open
FTags windows (`scheduleRefresh` in `main.js`).

## Localisation

`lang/en.json` and `lang/ru.json`, nested under `FTAGS`; `tools/validate.mjs` checks key parity, placeholders and
every key used in scripts and templates.

## Checks

`npm run check` runs ESLint, `tools/validate.mjs` and the `node --test` suite. `tools/check-ui.mjs` drives
`tools/ui-harness.html` in a browser against a small Foundry stand-in (screenshots go to `artifacts/`).
