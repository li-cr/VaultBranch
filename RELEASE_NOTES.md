VaultBranch 0.2.8 adds direct diff editing with autosave.

- Click an unstaged file and edit immediately in the right pane, with live red/green differences against the read-only index.
- Automatically save after 500 ms of idle typing and before switching files or running Git operations. Ctrl/Cmd+S also saves immediately.
- Saving changes only the working tree. Staged and historical diffs remain read-only.
- Preserve editor focus, undo history, UTF-8 BOM and CRLF through autosaves.
- Synchronize clean external changes. When external edits overlap an unsaved draft, pause saving and retain local input, with compare, retry and confirmed discard/reload actions.

Release assets continue to include GitHub provenance attestations.

Desktop only. Requires Git installed separately. Git authentication and commit identity use the local Git configuration.
