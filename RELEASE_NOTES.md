VaultBranch 0.2.20 adds configurable previous/next change buttons.

- Enable or hide the ↑ / ↓ controls under Settings → Other → Show diff navigation buttons. Enabled by default, with immediate updates to open views.
- Jump between changes in editable side-by-side diffs, staged comparisons and file history using CodeMirror's native goToPreviousChunk/goToNextChunk commands, including native wraparound and deletion chunks.
- Disable both buttons when there are no changes. Patch-only previews do not display unavailable controls.
- Preserve the active pane on mouse clicks, editable drafts, selection and undo when toggling the setting. Navigation does not save or stage content.

Validated with 24 Obsidian UI checks and 8 local editor/session regression tests. The reproducible UI script is tests/manual/diff-navigation-ui.js; run only in the note_test vault. Syntax, CSS and build checks pass. No performance improvement is claimed.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
