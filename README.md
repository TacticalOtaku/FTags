# FTags

FTags is a system-independent Foundry VTT module that lets GMs attach colored tags to world documents, folders, and compendiums. Compact color-only dots are rendered next to entries in standard sidebar directories and open compendium windows without changing Foundry typography; tag names remain available in tooltips and Spotlight.

Target: **Foundry VTT 14.367**. The manifest allows the full Version 14 generation and declares build 14.367 as verified.

Author: **TacticalOtaku**.

## Features

- Actor, Item, Scene, JournalEntry, RollTable, Cards, Playlist, Macro, their world folders, and compendium documents/folders.
- Shared world tag dictionary for all GMs; no FTags UI is rendered for players.
- Assignment from the right-click context menu in world sidebars and compendium pack sheets.
- Up to three circular color dots per row, followed by a composite overflow dot made from hidden tag colors; no tag text is inserted into directory rows.
- Clicking an individual directory dot opens Spotlight with that tag included; FTags never hides core directory rows.
- Spotlight results use larger colored tags with consistent light text, readable truncation tooltips, and intentional narrow-window wrapping.
- Spotlight tag states: ignore, include, or exclude; included tags can match ANY or ALL.
- Filters for object types, relevance/name/type sorting, reset, and per-GM persistence.
- GM-only Spotlight search across tagged world and compendium objects by object name or tag name.
- `#term` Spotlight tokens search tag names only; arrow keys, Enter, and Escape provide full keyboard navigation.
- Editable Foundry keybinding with no forced default, plus a magnifying-glass shortcut in supported directory toolbars and compendium headers.
- Folder tags do not inherit automatically; a GM can explicitly add the selected tags to all current documents in that folder and its subfolders (including compendium folders).
- Protected writes: clear warnings and disabled save when trying to tag documents inside locked compendiums.
- Tag manager with create, edit, color, delete, import, and export actions.
- Versioned JSON dictionary import/export. Assignments are intentionally not exported.
- English and Russian localization.
- No runtime dependencies, external services, sockets, or secrets.

## Installation

1. Copy the module directory to `{Foundry user data}/Data/modules/ftags`.
2. Make sure `module.json` is directly inside that `ftags` directory.
3. Restart Foundry VTT and enable **FTags** in the world module manager.

For a packaged release, extract `ftags-1.2.0.zip` into `Data/modules`; the archive already contains the top-level `ftags` directory.

## Usage

1. Open **Game Settings → Configure Settings → Module Settings → FTags → Manage tags**.
2. Create tags and choose their colors.
3. Right-click a supported document or folder and choose **Manage tags**.
4. Click a rendered color dot to open Spotlight with that tag included in its filters; hover it to read the tag name.
5. When assigning tags to a folder, optionally enable the one-time action that adds the selected tags to existing documents in the folder tree.
6. Open **Game Settings → Configure Controls → FTags**, assign a key to **Open FTags Spotlight**, then use it anywhere in the world. The magnifying-glass button in a supported directory opens the same search.

Spotlight lists only supported world objects and folders that currently have at least one valid tag. Normal words may match either the object name or a tag name. Prefix a word with `#` to require a tag-name match, for example `wolf #prepared`. Multiple words use AND semantics. At most 100 matches are shown at once.

Use the sliders button in Spotlight to open advanced filters. Each tag can be ignored, included, or excluded. Included tags can require at least one match (ANY) or every selected tag (ALL). Object types and result sorting can be adjusted independently. These settings are stored for the current GM; **Reset** restores all object types, relevance sorting, and no tag restrictions.

Deleting a tag requires confirmation and removes that tag id from all supported world documents and folders. If any object cannot be updated, dictionary deletion is aborted and the tag stays available for a safe retry.

## Import and export

The manager exports a JSON document containing:

- `schemaVersion`
- export metadata
- tag ids, names, and colors

Assignments are not included. Import merges by stable tag id, updates matching ids, creates new ids, and rejects conflicting duplicate names or malformed data before changing the world dictionary.

## Data and privacy

- Tag definitions are stored in a hidden world setting.
- Assignments are stored in `flags.ftags.tagIds` on world documents and Folder documents.
- Spotlight filters use a Version 14 user-scoped setting, separately for each GM.
- The UI and all write callbacks require `game.user.isGM`.
- Foundry world data is not a secrets vault. Do not use tag names for information that must be cryptographically hidden from player clients or browser debugging.

## Deliberate limits

- No player UI.
- No JournalEntryPage support (only parent JournalEntry documents and compendium documents).
- No full-text search inside document content; Spotlight searches object and tag names only.
- No automatic folder inheritance for future documents.
- No export of assignments, arbitrary bulk editor, external database, or cloud sync.

## Development and verification

Use Node.js 20 or newer:

```text
npm test
npm run validate
npm run validate:foundry -- "PATH/TO/Foundry Virtual Tabletop/resources/app"
```

The automated suite covers tag normalization and dictionary limits, three-marker overflow partitioning, contrast selection, recursive folder traversal, Spotlight tokenization/ranking, include/exclude and ANY/ALL filtering, object types, sorting, import/export merge behavior, manifest compatibility, and localization parity. A dependency-free Foundry UI harness also executes directory/popout rendering, GM/player visibility, document and folder context actions, assignment writes, manager creation, Spotlight opening, and close/debounce behavior. The optional Foundry check verifies the directory, ApplicationV2, settings, and editable GM keybinding integration surfaces against an exact local 14.367 installation.

### Manual Foundry 14.367 matrix

Repeat the core flow for Actor, Item, Scene, JournalEntry, RollTable, Cards, Playlist, and Macro directories:

1. Create four tags as a GM.
2. Assign four or more tags to a document; verify three individual color dots plus one composite overflow dot, with no text added to the row.
3. Reload the client; verify assignments and Spotlight filters persist.
4. Click an individual directory dot; verify Spotlight opens with that tag included and no directory rows are hidden.
5. Test the same directory in the attached sidebar and a detached popout.
6. Assign a folder tag without propagation; verify children remain unchanged.
7. Repeat with propagation enabled; verify current recursive documents receive it and newly created documents do not.
8. Test compendium documents and compendium folders in unlocked packs; verify indicator dots, context menu assignment, and Spotlight indexing.
9. Verify that attempting to assign tags to locked compendiums displays an informative warning and prevents saving.
10. Log in as a player; verify no FTags toolbar, dots, manager, or context actions are visible.
11. Export and re-import the dictionary; verify preview counts and unchanged assignments.
12. Delete a tag; verify confirmation, global cleanup across world and unlocked compendiums, and stale Spotlight-filter removal.
13. Assign a Spotlight key, search by object name, tag name, and `#tag`, then open results with mouse and keyboard.
14. Verify include/exclude, ANY/ALL, object types, sorting and reset; Spotlight remains unavailable to a player.
15. Verify Spotlight result tags remain readable with bright, dark, long, and four-tag examples at normal and narrow window widths.

## Русское описание

FTags добавляет GM-метки к стандартным спискам Foundry VTT (включая компендиумы). Рядом с сущностями показываются только компактные цветные точки без текста, поэтому модуль не меняет шрифт и плотность строк Foundry/Plutonium; названия меток доступны в подсказке и Spotlight. Метки общие для всех GM мира, игрокам интерфейс модуля не показывается. Поддерживаются актёры, предметы, сцены, журналы, таблицы, карточные колоды, плейлисты, макросы, мировые папки и папки/документы компендиумов. Расширенные фильтры Spotlight поддерживают включение, исключение, режимы «любая/все», типы объектов и сортировку; настройки сохраняются отдельно для каждого GM.

Установка: распакуйте папку `ftags` в `Data/modules`, перезапустите Foundry и включите модуль в нужном мире. Управление словарём находится в настройках модулей, а назначение — в контекстном меню сущности или папки (как в боковых панелях, так и в окнах компендиумов).

Spotlight вызывается назначаемой клавишей в **Настройках управления → FTags**, кнопкой-лупой или кликом по отдельной цветной точке. Он показывает объекты мира и компендиумов с метками, ищет по названиям объектов и меток, а префикс `#` ограничивает слово названиями меток. В результатах Spotlight метки отображаются контрастными цветными чипами; длинные названия раскрываются подсказкой, а узкое окно допускает перенос на две строки. FTags больше не скрывает строки стандартных каталогов.
