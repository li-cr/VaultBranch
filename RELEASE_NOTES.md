VaultBranch 0.2.31 makes timing records easy to select and copy.

- Open View records in a focused, editable plain textarea with monospace text, preserved JSON indentation, horizontal scrolling and vertical resizing.
- Select all with Ctrl/Cmd+A, select individual passages, edit the displayed text and copy it. The Copy records button copies exactly what is displayed, including edits.
- Keep recorded measurements separate from text edits. Clear records resets both the in-memory records and the displayed report.
- Use the native textarea without loading CodeMirror or adding dependencies. Timing collection, retention and diff-loading behavior are unchanged; no performance improvement is claimed.

Validated in the note_test Obsidian vault with the timing UI checks and native keyboard-selection/editor checks. Syntax, version, CSS and build checks pass.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
