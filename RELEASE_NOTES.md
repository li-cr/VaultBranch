VaultBranch 0.2.19 adds file history and native diff folding.

- Open File history from a file explorer, editor or Git sidebar context menu, or the View current file history command.
- Browse commits on the left and a read-only parent-to-commit comparison on the right. Follow Git-detected renames and display historical paths, including deleted files opened from the Git sidebar.
- Start with the current branch and 50 commits; switch to all branches or load more, up to 1,000 entries. Include forks made before a detected rename. Stashes remain in Git Graph.
- Use CodeMirror MergeView's native collapseUnchanged for editable, staged and history comparisons. Enabled by default with three context lines; disable under Other. Clicking a collapsed region expands both panes. Changing the setting preserves editable drafts, selection and undo.
- Keep manual save as the default. Partial staging and chunk revert controls are not included.

Validated with 62 local automated tests and Obsidian UI checks covering rename paths, root and merge commits, pagination, branch scope, native folding, rapid selection, close-during-load cleanup, context menus, readonly index comparisons, draft/undo preservation, hidden JSON switching and autosave. No performance improvement is claimed. Reproducible UI scripts are in tests/manual; run only in the note_test vault.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
