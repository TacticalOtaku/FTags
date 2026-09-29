# Automatic Tags Implementation Plan

**Goal:** Deliver the approved automatic D&D5e search, manual presets and compact shapes.
**Architecture:** Pure system adapter produces stable automatic facet definitions and assignments. Service combines manual and computed tags for indexing; presentation filters automatic tags out. Repository loads only required pack fields with bounded concurrency.
**Tech Stack:** ES modules, Foundry ApplicationV2/Handlebars, CSS, Node test runner.
**Spec:** ../specs/2026-09-08-automatic-tags-design.md

## Global constraints
Foundry VTT 14; GM-only; no runtime dependencies; preserve legacy assignments and import schema 1.

## Execution
- [x] Add behavioral tests in tests/features.test.js for CR exact/fractional queries, bilingual category searches, filter combinations, shapes/import and preset idempotence. Run `npm test` and confirm failures before implementation.
- [x] Implement scripts/core/automatic-tags.js with `getAutomaticTags(document, {systemId, documentName, language})`, `getAutomaticTagLibrary({systemId, language})` and `getAutomaticIndexFields(documentName, systemId)`; add scripts/core/presets.js. Modify model.js to normalize shapes and accept old imports.
- [x] Extend search.js to tokenize quoted text and CR predicates, match automatic aliases exactly, and preserve manual search. Extend service.js to merge computed tags, expose search library, apply presets and retain automatic filters during cleanup. Add repository `prepareCompendiumIndexes()` and hook property/lifecycle invalidation in main.js. Run `npm test`.
- [x] Extend tag manager create/edit/preset actions, templates and CSS. Filter result chips to manual tags; render automatic filter labels with an explicit automatic annotation. Localize English/Russian controls and query help.
- [x] Add integration tests for locked pack reads, failure recovery, update hooks and UI contexts. Add tools/validate.mjs for syntax, localization parity and template compilation when Handlebars is available. Run `npm test` and `npm run validate`; review resulting changes and update README/CHANGELOG.

Execution proceeds inline in the approved workspace. User approval already covers implementation; no further design gate is needed.

## Verification record
All five implementation steps completed. Node behavioral suite: 15 tests. Validation compiles all four Handlebars templates and checks script syntax and 114 localization keys. Headless Edge harness covers create/edit/export shapes, preset application, automatic search, visibility boundaries, 6px directory markers/overflow and narrow layout. Independent review found a cross-system CR search regression; a failing regression test reproduced it, and structured parsing was restricted to the active D&D5e adapter. Live Foundry world verification remains a manual integration check.

