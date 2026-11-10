VaultBranch 0.2.7 adds working-tree editing to the diff view.

- Choose **Edit working tree** in an unstaged diff to edit the full file on the right, with the index on the left for reference.
- Save using the toolbar or Ctrl/Cmd+S. Saving updates only the working tree, without staging or committing.
- Keep staged and historical diffs read-only.
- Preserve drafts across view refreshes and language changes, with save/discard controls when returning to the diff.
- Refuse to overwrite external edits; retain the draft for comparison.
- Preserve UTF-8 BOM and CRLF and reject binary, oversized or unsafe file paths.

Release assets continue to include GitHub provenance attestations.

Desktop only. Requires Git installed separately. Git authentication and commit identity use the local Git configuration.

Until approved in the Obsidian Community directory, install from these release assets or with BRAT using `li-cr/VaultBranch`. This release does not imply directory approval.
