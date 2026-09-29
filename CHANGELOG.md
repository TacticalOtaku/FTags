# Changelog

## 1.3.0

### Added

- Computed D&D5e search tags for creature type, NPC CR, item type, rarity and melee/ranged weapons. Automatic tags work without manual assignments, remain hidden from directory markers, assignment dialogs and result chips, and have their own expandable filter list.
- Russian/English search aliases, quoted tag phrases and exact CR predicates with fractions and comparisons.
- Circle, square, diamond, star and triangle manual markers, preserving the existing 6px directory size and three-marker overflow behavior.
- Preparation, Story and Relationships presets with duplicate-safe application and editable colors/shapes.
- Schema 2 dictionary export with shapes; schema 1 import remains supported with circle defaults.
- Behavioral tests, template/localization validation and an isolated browser UI harness.

### Changed

- Spotlight reads selected compendium index fields, including locked packs, with bounded concurrency and partial-failure warnings. System-property and compendium changes invalidate open search indexes.
- Search refresh callbacks check GM access.

## 1.2.6

### Fixed

- Tag editing no longer fails silently. Foundry v14 `DialogV2` rejects a content element that
  carries any attribute, so the edit dialog now passes a bare wrapper, and dialog failures are
  reported instead of being swallowed.
- The "Manage tags" context action now appears for every compendium entry rather than only those
  already loaded into memory. Visibility is resolved through the pack index and the document is
  fetched on demand when the action runs.
- Folder tag propagation now works for compendium folders. Index entries are counted correctly, so
  the propagation checkbox is no longer permanently disabled, and nested subfolders are included
  because subfolder traversal falls back to `children` when `getSubfolders` returns nothing.
- The directory toolbar in compendium windows is no longer painted over by the absolutely
  positioned document list, restoring both its visibility and its click targets.
- Spotlight result tags compute background and foreground together, restoring readable contrast on
  light tag colours; white, yellow, and other bright tags previously rendered near-invisible text.
- The Spotlight window stays inside the viewport, so the footer and the end of the result list
  remain reachable while the filter panel is open.

### Changed

- Sorting Spotlight results by object type follows localized labels instead of internal document
  names.
- Clearing every object type shows a dedicated hint rather than the generic "no results" message.
- `Ctrl+Shift+F` ships as the default Spotlight keybinding and stays editable.
- The tag manager introduction states that tags are hidden from the player interface but are not a
  security boundary, since world settings remain readable by a player client.
- `Spotlight` replaces a cached window instance whose element has left the DOM.

### Removed

- The `getCompendiumEntryContext` handler and the `updateCompendium` subscription; neither hook
  exists in Foundry v14.

## 1.2.5

Previously published under the number 1.2.0; renumbered so the history stays monotonic.

- Verified compatibility with Foundry VTT 14.367.
- Added full Compendium support for documents and compendium folders.
- Registered tag flag field in `CONFIG[documentName].compendiumIndexFields` for automatic compendium indexing.
- Added GM-only "Manage tags" context menu action in Compendium pack windows.
- Added circular color indicator dots and search/manager toolbar in Compendium windows and Compendium directory tab.
- Integrated tagged compendium documents and folders into Spotlight search, including path metadata and direct sheet opening.
- Added write protection and warning feedback for locked compendium packs.
- Supported folder tag propagation across compendium folder hierarchies.
- Synchronized dictionary tag deletion across unlocked compendiums.

## 1.2.4

- Changed directory color-only markers from thin strips to compact 6×6 px circular dots.
- Preserved tag colors, composite overflow, tooltips, ARIA, Spotlight opening, row typography, and all Spotlight behavior.

## 1.2.3

- Standardized all Spotlight result tag labels on one light foreground color.
- Removed per-tag black/white foreground calculation from the Spotlight rendering path.
- Preserved tag colors, chip geometry, responsive wrapping, filters, search, and directory strips.

## 1.2.2

- Enlarged Spotlight result tags to 22 px with 11 px bold text, stronger color treatment, clearer borders, and more breathing room.
- Added readable title tooltips for truncated result tags and intentional two-line wrapping on narrow Spotlight windows.
- Improved automatic black/white foreground contrast for bright saturated tag colors.

## 1.2.1

- Replaced directory text chips with thin color-only strips so FTags does not compete with Foundry or Plutonium typography.
- Preserved per-tag Spotlight opening through accessible strip buttons and full tag-name tooltips.
- Replaced the textual `+N` badge with a composite overflow strip built from the hidden tag colors.

## 1.2.0

- Moved all active filtering out of Foundry directories and into Spotlight.
- Added per-tag include/exclude states, ANY/ALL matching, object-type filters, sorting, reset, and per-GM persistence.
- Clicking a directory tag now opens Spotlight with that tag included instead of hiding directory rows.
- Reduced directory and Spotlight result tags to a Plutonium-friendly 14 px, with 9 px start-aligned text and denser spacing.

## 1.1.5

- Kept the requested 1.1.5 release number and the previously prepared visuals.
- Enforced the 500-tag dictionary capacity consistently for creation, import, and merged imports.
- Centralized the 48-character tag-name limit across validation and manager inputs.
- Corrected current documentation to describe circular directory markers.
- Removed the obsolete per-directory `savedFilters` subsystem; filtering and persistence now belong exclusively to Spotlight.
- Added a dependency-free Foundry UI behavior harness for directories, popouts, GM/player visibility, context actions, assignment, manager creation, Spotlight opening, and close/debounce lifecycle.

## 1.1.1

- Refined directory tags into compact 17 px metadata chips that no longer inherit oversized Foundry button geometry.
- Reduced saturation, spacing, and maximum label width while preserving keyboard focus, active filters, and `3 + N` overflow.
- Kept 24 px interactive chips only for coarse-pointer devices instead of all narrow windows.

## 1.1.0

- Added a GM-only Spotlight search across tagged world documents and folders.
- Search matches object names and tag names; `#term` restricts a token to tag names.
- Added keyboard navigation, an editable Foundry keybinding action, and a directory toolbar shortcut.

## 1.0.0

- Initial Foundry VTT 14.363 release.
- GM-only shared tag dictionary and assignments for eight world document types and folders.
- Native sidebar chips, persistent OR filters, folder propagation, dictionary import/export, RU/EN localization, tests, and release documentation.
