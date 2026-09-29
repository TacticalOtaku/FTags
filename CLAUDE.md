# FTags — project rules

GM-only coloured tags and Spotlight search for Foundry VTT 14.367 world documents, folders and compendiums. The code
map is in `docs/architecture.md`.

## Commands

- `npm run check` — ESLint + `tools/validate.mjs` + `node --test`. Must be green before claiming anything.
- `npm run deploy` — copies the module to `%LOCALAPPDATA%/FoundryVTT/Data/modules/ftags`
  (or `FOUNDRY_DATA` / `--data <path>`, the Foundry `Data` folder).
- `npm run release` — check + `tools/package.mjs`: validates module.json against package.json and writes
  `dist/ftags-v<version>.zip`; it refuses to replace an existing archive. From the next version on, tags are
  `v<version>` and `download` in module.json must use that form (1.3.0 was published without the `v`).

## Foundry API truth

Never guess v14 APIs. Read the installed client: `D:\Foundry\Foundry Virtual Tabletop\resources\app`
(`client/`, `common/`, `public/css/foundry2.css`).

## Architecture invariants

- `scripts/core/` stays importable in plain Node; settings, flags and compendium access live in `scripts/foundry/`.
- Nothing is shown to players: the UI and the public API are GM-only (`game.user.isGM`). New entry points must
  keep that check.
- Directory markers stay compact dots without text, so Foundry's row height and fonts are untouched.
- Automatic dnd5e tags are computed, never stored, and never appear as markers or in assignment dialogs.
- Deleting a tag cleans it from the world and unlocked compendiums; failures are reported, never swallowed.
- Refreshes are coalesced into one microtask (`scheduleRefresh`).
- Localisation keys live under `FTAGS`; en and ru keep the same keys and placeholders.
- Adding a stylesheet or language to `module.json` needs a Foundry server restart, not F5.

## Live verification (Foundry 14.367)

- The manual matrix is in `README.md` ("Manual Foundry 14.367 matrix").
- The user may be playing in world `test`: never shut down or relaunch it without asking.
