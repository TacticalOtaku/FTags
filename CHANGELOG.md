# Changelog

## 1.1.5

- Kept the requested 1.1.5 release number and the previously prepared visuals.
- Enforced the 500-tag dictionary capacity consistently for creation, import, and merged imports.
- Centralized the 48-character tag-name limit across validation and manager inputs.
- Corrected current documentation to describe circular directory markers.
- Removed the obsolete per-directory `savedFilters` subsystem; filtering and persistence now belong exclusively to Spotlight.
- Added a dependency-free Foundry UI behavior harness for directories, popouts, GM/player visibility, context actions, assignment, manager creation, Spotlight opening, and close/debounce lifecycle.

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
