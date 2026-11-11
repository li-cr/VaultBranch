VaultBranch 0.2.23 enables native change-block revert controls in editable diffs.

- Use the arrow between panes to restore one working-copy change block to its staged version through CodeMirror MergeView's native a-to-b revert operation. Other change blocks and the staged index stay intact.
- Keep reverts in the existing editor session: Ctrl/Cmd+Z undoes them, manual mode waits for Save or Ctrl/Cmd+S, and optional autosave uses the normal save path. This does not stage content.
- Support mouse and keyboard/assistive button activation, translated labels and theme-aware styling. Remove controls while Git operations lock editing; block stale controls and non-primary mouse presses.
- Keep staged and historical comparisons read-only without revert controls. For untracked text, restoring the empty index creates an empty editable draft rather than deleting the file.

Validated with 70 local automated tests and 56 Obsidian UI checks: 24 native chunk-revert checks, 24 diff-navigation checks and 8 folding/editor checks. The reproducible script is tests/manual/chunk-revert-ui.js; run only in the note_test vault. Syntax, CSS and build checks pass. No performance improvement is claimed. Syntax highlighting configuration is not included in this release.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
