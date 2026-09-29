# Automatic tags, presets and shapes

Approved in conversation: D&D5e is the first system adapter. Manual tags remain in the world dictionary and document flags. Automatic tags are computed, never written to documents, and appear only in search filters, not assignment dialogs, directory markers or result chips. All supported compendiums, including locked ones, are searched using selected index fields. Failed pack reads must be reported without losing world search.

Automatic facets: NPC CR, creature type, item type, rarity and melee/ranged weapon category. Russian and English aliases work independent of UI language. CR supports exact numbers and fractions, with optional comparisons. Structured facets use exact matching to avoid partial numeric/category matches. Existing manual substring and include/exclude ANY/ALL semantics remain available.

Manual shapes: circle (legacy default), square, diamond, star, triangle. Import accepts schema 1 and exports schema 2 including shape. Unknown shapes in imports are rejected. Three visible directory markers and overflow retain their size. Presets add preparation, story and relationship tags without overwriting existing IDs/names or creating duplicates.

Foundry VTT 14, GM-only UI, no runtime dependencies. Other game systems retain manual functionality. Verification: Node behavioral tests, syntax and localization/template validation, UI checks where a browser is available. No Git repository exists in this workspace; no commits are possible.
