# Obsidian UI checks

Build and install VaultBranch into a disposable Obsidian vault named `note_test`. Enable the plugin, open the developer console, and paste one script at a time. Each script returns its passed assertions and captured runtime errors. Do not run scripts concurrently.

- `file-history-ui.js`: creates an isolated temporary Git repository and temporarily points the plugin at it. Checks 50-entry pagination, renamed files, branch scope, read-only comparisons, native collapse/expand, keyboard selection, rapid requests, sidebar context menu, index preservation and editor cleanup. Restores the plugin's repository afterward.
- `history-editor-ui.js`: creates one temporary note in `note_test` and stages only that file. Checks editable draft/selection/undo preservation and native editor/file-explorer menus. Removes that index entry, trashes its note and restores preferences afterward.
- `diff-navigation-ui.js`: checks previous/next native chunk navigation, deletion chunks, wraparound, live button availability, translated labels, settings persistence and draft/undo/index preservation. Uses one disposable test note and an isolated temporary history repository; restores preferences and removes test data afterward.
- `startup-ui.js`: reloads the plugin with a closed workspace, then restores all five view types through native leaf state. Checks deferred loading, serialized manual drafts, editor access modes and cleanup. Creates and trashes one temporary note without staging it; restores preferences afterward.
- `background-refresh-ui.js`: checks closed/collapsed/inactive sidebars, polling, refreshing when revealed, explicit refresh and editor external-change protection. Creates and trashes one temporary untracked note and restores preferences afterward. Required editor conflict safety reads remain enabled even when sidebar refreshes are suspended.

All scripts refuse to run in a vault with a different name. They require a working Git executable and the normal file explorer enabled. Use a clean test session with no existing unsaved diff drafts. The normal `npm test` suite does not require Obsidian.

For repeatable plugin reload and first-use measurements, run `scripts/benchmark-startup.js` separately. See `docs/performance/0.2.21.md` for the baseline, environment, sample results and limitations.

For background Git subprocess counts, run `scripts/benchmark-background-refresh.js` separately. See `docs/performance/0.2.22.md`; it temporarily closes sidebar leaves and restores the startup, refresh and collapse preferences.
