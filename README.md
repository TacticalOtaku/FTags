<div align="center">

**English** · [Русский](README.ru.md)

# FTags

**GM-only colored shaped tags & Spotlight search for Foundry VTT world documents, folders, and compendiums**

Organize world and compendium entries directly inside standard Foundry directories without cluttering row text or typography — works on any game system with zero dependencies, plus automatic D&D 5e search facets.

[![Release](https://img.shields.io/github/v/release/TacticalOtaku/FTags?style=flat-square&label=Release&color=b8860b)](https://github.com/TacticalOtaku/FTags/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/TacticalOtaku/FTags/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/TacticalOtaku/FTags/actions/workflows/ci.yml)
[![Foundry VTT](https://img.shields.io/badge/Foundry_VTT-v14_%2814.367%29-ff6400?style=flat-square)](https://foundryvtt.com/)
[![Systems](https://img.shields.io/badge/Systems-Any_%2B_D%26D_5e_Auto_Tags-7c4d2b?style=flat-square)](https://foundryvtt.com/)
[![Languages](https://img.shields.io/badge/Languages-EN_%7C_RU-2e7d32?style=flat-square)](lang/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-3b82f6?style=flat-square)](LICENSE)

[Installation](#installation) · [Features](#features) · [Usage](#usage) · [Spotlight Search](#spotlight--query-syntax) · [API & Data](#api--data-model) · [Development](#development)

</div>

---

## Installation

In Foundry VTT (**Setup → Add-on Modules → Install Module**), paste the **Manifest URL**:

```text
https://github.com/TacticalOtaku/FTags/releases/latest/download/module.json
```

**Requirements:** Foundry VTT **14** (verified `14.367`), any game system, zero runtime dependencies.  
**Manual install:** Download `ftags-v<version>.zip` from [GitHub Releases](https://github.com/TacticalOtaku/FTags/releases/latest), extract it into `{Foundry user data}/Data/modules/ftags` (with `module.json` at its root), and enable **FTags** under **Manage Modules**.

> [!NOTE]
> Everything is strictly **GM-only** (`game.user.isGM`): no FTags buttons, dots, dialogs, or context menu items are rendered for players.

---

## Overview

FTags lets GMs organize world documents, folders, and compendiums with colored, shaped manual markers directly inside standard Foundry VTT sidebar directories and compendium windows — without adding text labels or changing Foundry's row density and typography. Full tag names live in tooltips and an instant **Spotlight** search palette (`Ctrl+Shift+F`).

---

## Features

- **Broad document coverage:** Supports `Actor`, `Item`, `Scene`, `JournalEntry`, `RollTable`, `Cards`, `Playlist`, `Macro`, world folders, and unlocked compendium documents and folders.
- **Zero visual clutter:** Renders up to **3** crisp 6 px shaped markers (`● circle`, `■ square`, `◆ diamond`, `★ star`, `▲ triangle`) per directory row, plus a composite multi-color overflow segment when a document carries more than 3 tags.
- **Instant filtering from any row:** Hover any marker cluster to read all assigned tag names; click an individual marker to jump straight into **Spotlight** pre-filtered to that tag. Never hides core directory rows.
- **Spotlight palette (`Ctrl+Shift+F`):** Search world and compendium targets by object name or tag name (up to 100 results) with full keyboard navigation (`↑` `↓` `Enter` `Esc`) and high-contrast tag chips.
- **Advanced per-GM filters:** Include or exclude tags with `ANY` / `ALL` matching, filter by document type, sort by relevance/name/type, and persist preferences separately per GM.
- **Automatic D&D 5e facets:** Derived read-only search tags for creature types, NPC CR (`0–30`, `1/8`, `1/4`, `1/2`), item types, rarities, and melee/ranged weapon category with bilingual English/Russian aliases. Hidden from directory dots, assignment dialogs, and result chips.
- **Safe folder propagation & deletion:** Tags on folders do not auto-inherit into future items, keeping workflows explicit; GMs can one-click propagate selected tags recursively (including compendium folders), while locked compendiums prevent accidental writes. Deleting a tag cleans all world and unlocked compendium targets atomically — if any target fails to load or update, dictionary removal is aborted so nothing becomes orphaned.
- **Starter presets & portable dictionaries:** Three duplicate-safe starter sets (**Preparation**, **Story**, **Relationships**) and versioned Schema v2 JSON export/import with preview summary counts (legacy Schema v1 dictionaries import with circle defaults).
- **Bilingual UI & self-contained footprint:** Full English (`en`) and Russian (`ru`) localization with zero external dependencies, sockets, or third-party services.

---

## Usage

1. **Create tags or apply presets:** Open **Game Settings → Configure Settings → Module Settings → FTags → Manage tags** (or click the tag button in any supported directory toolbar). Define tags up to 48 characters (`500` max per world), choose a 6-digit hex color and marker shape (`●` `■` `◆` `★` `▲`), or expand **Ready-made tag sets**.
2. **Assign tags:** Right-click any supported document or folder in a world sidebar or open compendium window and select **Manage tags**.
3. **Propagate to folder contents (optional):** When tagging a folder, check **Also add selected tags to current folder contents** to add those tags once to existing supported documents across that folder tree (future documents created inside the folder remain untagged unless tagged manually).
4. **Search with Spotlight:** Press `Ctrl+Shift+F` (configurable under **Game Settings → Configure Controls → FTags → Open FTags Spotlight**), click the magnifying-glass button in a directory toolbar, or click any colored dot on a directory entry.

> [!TIP]
> Re-applying a preset never duplicates tags or overwrites colors/shapes you edited manually. If a compendium pack is locked, FTags disables saving in the assignment dialog and prevents writes with a clear warning.

---

## Spotlight & Query Syntax

Spotlight indexes world documents/folders and selected compendium index fields across unlocked and locked packs (loading full documents only when opened, deleted-tag cleanup runs, or folder propagation targets unlocked packs).

### Query Operators

| Query                                                         | Matches                                                                                            |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `goblin camp`                                                 | Objects whose name or manual/automatic tag matches both `goblin` **AND** `camp`                    |
| `wolf #prepared`                                              | Object matches `wolf`, and carries a tag matching `prepared` (`#` searches tags only)              |
| `#"very rare"`                                                | Multi-word tag phrase in quotes                                                                    |
| `нежить CR 3` / `undead cr:3`                                 | Undead creatures with exact Challenge Rating `3` (EN and RU aliases work in any UI language)       |
| `оружие необычной редкости ближнее` / `weapon uncommon melee` | Uncommon melee weapons                                                                             |
| `CR >= 5` / `CR 1/8` / `ПО 1/2`                               | Exact numeric/fractional CR comparisons (`=`, `<`, `>`, `<=`, `>=`; predicates combine with `AND`) |

### Automatic D&D 5e Facets

When running the `dnd5e` system, Spotlight computes automatic facets directly from document properties without writing to document flags:

- **Creatures & NPCs:** Creature type and NPC CR (`0–30`, `1/8`, `1/4`, `1/2`).
- **Items & Weapons:** Item category, rarity (`rare` matches `rare` strictly, distinct from `uncommon` and `very rare`), and melee/ranged weapon category following official dnd5e [NPC data](https://github.com/foundryvtt/dnd5e/blob/master/module/data/actor/npc.mjs), [weapon data](https://github.com/foundryvtt/dnd5e/blob/master/module/data/item/weapon.mjs), and [system config](https://github.com/foundryvtt/dnd5e/blob/master/module/config.mjs) (thrown melee weapons stay `melee`; siege weapons are `ranged`).

Click the **Sliders** button in Spotlight to open advanced filters (manual tags + expandable **Automatic tags · D&D 5e**, `ANY`/`ALL` mode, document type toggles, relevance/name/type sorting, and one-click **Reset**). Unrelated document updates such as HP changes never trigger index rebuilds.

---

## API & Data Model

### Public Macro / Module API

Once initialized, `game.modules.get("ftags").api` exposes a frozen helper object (all read/UI entry points enforce `game.user.isGM` and return `[]` / `null` for players):

| Member                       | Behavior                                                           |
| ---------------------------- | ------------------------------------------------------------------ |
| `openTagManager(parentApp?)` | Opens the GM Tag Manager window                                    |
| `openSpotlight(options?)`    | Opens Spotlight (`options.includeTagId` pre-includes a tag filter) |
| `listTags()`                 | Returns current manual tag definitions from the world dictionary   |
| `getAssignments(document)`   | Returns sanitized manual tag IDs currently assigned to `document`  |

### Storage & Import/Export

| Data                                                       | Storage Location                 | Scope                     |
| ---------------------------------------------------------- | -------------------------------- | ------------------------- |
| Tag dictionary (Schema v2: `id`, `name`, `color`, `shape`) | `ftags.tagDictionary` setting    | World (shared by all GMs) |
| Spotlight filter preferences                               | `ftags.spotlightFilters` setting | Per-user GM               |
| Tag assignments on documents and folders                   | `flags.ftags.tagIds` flag        | Document / Folder         |
| Browser console diagnostic toggle                          | `ftags.debug` setting            | Client                    |

> [!CAUTION]
> Foundry world settings are technically readable by player clients over the socket even though FTags renders no player UI. Do not put secret plot spoilers into tag names if players inspect raw world data.

- **Export / Import:** Dictionary JSON exports include schema version, timestamp, and manual tags (never assignments or automatic `auto-dnd5e-` tags). Imports preview created/updated/unchanged counts before committing, merge by stable `id`, reject conflicting names or malformed payloads (`invalid-payload`, `unsupported-schema`, `tags-required`, `duplicate-id`, `import-name-conflict`), and prune stale deleted tags from Spotlight filters.

### Deliberate Limits

- No player-facing UI or shared player tags.
- No `JournalEntryPage` support (operates at parent `JournalEntry` and compendium level).
- No full-text search inside biographies or journal body content — Spotlight searches object names and tags only.
- No continuous inheritance for future documents added to tagged folders.
- No concurrent multi-GM dictionary merge: the world dictionary is stored in one world setting (last write wins).

---

## Development

Requires **Node.js ≥ 24** (`npm ci`). GitHub Actions ([ci.yml](.github/workflows/ci.yml)) runs linting, validation, tests, and packaging on pushes and PRs; tagged releases (`v*`) publish the ZIP archive and `module.json` via [release.yml](.github/workflows/release.yml).

```bash
npm ci           # Install dev-only tooling (ESLint, Prettier, Handlebars)
npm run check    # ESLint + template/localization validator + node --test suite
npm run deploy   # Copy module files into local Foundry Data/modules/ftags
npm run package  # Validate module.json and build dist/ftags-v<version>.zip
npm run release  # Run npm run check, then build dist/ftags-v<version>.zip
```

Optional Playwright browser harness (`tools/ui-harness.html`):

```bash
node tools/check-ui.mjs
```

Set `FTAGS_PLAYWRIGHT_PATH` and `FTAGS_BROWSER_CHANNEL` if using an external Playwright/browser install.

<details>
<summary><strong>Manual Foundry VTT 14.367 Verification Matrix</strong></summary>

Repeat the core workflow across `Actor`, `Item`, `Scene`, `JournalEntry`, `RollTable`, `Cards`, `Playlist`, and `Macro`:

1. Create four tags as a GM with distinct colors and shapes (`circle`, `square`, `diamond`, `star`, `triangle`).
2. Assign 4+ tags to a document; verify 3 individual 6 px markers plus 1 composite multi-color overflow segment with zero extra text in the row.
3. Reload the client; verify assignments and Spotlight filters persist.
4. Click a directory dot; verify Spotlight opens with that tag included and never hides directory rows.
5. Test directories both docked in the sidebar and popped out in detached windows.
6. Tag a folder without propagation; verify children remain unchanged.
7. Repeat with **Also add selected tags to current folder contents** enabled; verify existing recursive documents receive tags and newly created ones do not.
8. Test unlocked compendium documents and folders (markers, context menu, and Spotlight indexing).
9. Attempt to tag locked compendiums; verify an informative warning appears and saves are blocked.
10. Log in as a player; verify no toolbar, markers, manager menu, Spotlight shortcut, or context menu items exist.
11. Export and re-import the dictionary JSON; verify preview counts and intact document assignments.
12. Delete a tag; verify confirmation dialog, cleanup across world and unlocked compendiums (or atomic abort warning on load/write failure), and stale Spotlight-filter pruning.
13. Trigger Spotlight via `Ctrl+Shift+F`, search by name, tag, and `#tag`, and open results with mouse and keyboard (`↑` `↓` `Enter` `Esc`).
14. Verify include/exclude, `ANY`/`ALL`, object-type filters, sorting, and **Reset**; confirm Spotlight stays blocked for players.
15. Verify Spotlight result chips keep readable dark/light contrast across bright, dark, long, and multi-tag items at both regular and narrow widths.

</details>

### Project Docs

| Document                                     | Purpose                                                     |
| -------------------------------------------- | ----------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md) | Layers (`core`, `foundry`, `ui`), data flow, and boundaries |
| [GLOSSARY.md](GLOSSARY.md)                   | Domain terminology                                          |
| [CHANGELOG.md](CHANGELOG.md)                 | Version-by-version release notes                            |
| [CONTRIBUTING.md](CONTRIBUTING.md)           | Issue reporting guidelines                                  |

---

## AI Disclosure

AI-assisted tools were used during development for tasks such as code drafting, refactoring, tests, documentation, and localization drafts. All architecture, code, behavior, user-facing copy, and Russian/English translations are reviewed, tested, and maintained by **TacticalOtaku**, who retains sole authorship and responsibility for the module.

All bundled package assets and user-facing materials comply with Foundry VTT's [AI Content Policy](https://foundryvtt.com/article/ai-policy/) — no pre-generated AI art, audio, or lore assets are included.

---

## Feedback & License

Pull Requests are disabled on this repository; bug reports and suggestions are welcome via [GitHub Issues](https://github.com/TacticalOtaku/FTags/issues) (see [CONTRIBUTING.md](CONTRIBUTING.md)).

Released under the **GNU General Public License v3.0** ([LICENSE](LICENSE)).
