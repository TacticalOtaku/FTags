# FTags Domain Glossary

Shared vocabulary for organizing and locating GM-only categorized content inside a Foundry VTT world and its compendiums.

## Language

**Tag**:
A user-defined label with a unique name, six-digit hex color, and marker shape used to categorize content.
_Avoid_: Label, badge (for the core entity), keyword

**Tag Dictionary**:
The world-wide, GM-shared catalog containing all defined tags and schema metadata.
_Avoid_: Tag list, tag registry, catalog (alone)

**Preset**:
A built-in starter set of editable tags that adds missing entries without overwriting existing customized tags.
_Avoid_: Template, starter pack

**Assignment**:
The set of tag identifiers stored on a document or folder as metadata.
_Avoid_: Binding, attachment, link

**Folder Propagation**:
A one-time additive operation that applies selected tags to existing supported documents within a folder and its subfolders without establishing inheritance for future items.
_Avoid_: Inheritance, recursive sync, cascade

**Automatic Facet**:
A read-only attribute derived from game system data (such as D&D5e creature type, Challenge Rating, item category, rarity, or weapon range) used solely for Spotlight filtering and search matching, never stored on documents or displayed on directory rows or result chips.
_Avoid_: System tag, implicit tag, smart tag

**Spotlight**:
The GM-only instant search and filtering dialog spanning tagged world entities, folders, and compendium entries.
_Avoid_: Quick search, command palette

**Spotlight Filter State**:
Per-user filter criteria specifying included tags, excluded tags, include match mode, allowed document types, and sort order.
_Avoid_: Search preferences, query options

**Row Marker**:
A compact 6px shaped indicator rendered beside a directory entry name for up to three assigned tags, opening Spotlight filtered to that tag when clicked.
_Avoid_: Directory chip, pill, inline badge

**Overflow Segment**:
A single multi-colored bar shown beside row markers when an entry carries more than three assigned tags.
_Avoid_: Overflow badge, summary pill

**Locked Compendium**:
A read-only compendium pack whose documents and folders cannot have tag assignments modified or removed.
_Avoid_: Protected pack, frozen pack
