VaultBranch 0.2.2 adds language selection and file discard actions.

- Switch between Chinese and English in settings, including views, tooltips and plugin validation messages.
- Discard a file's unstaged changes after confirmation, preserving its staged content.
- Move untracked files to Obsidian's local trash after confirmation.
- Simplify file rows: stage/unstage, discard arrow, then status. Remove the separate open-file button.
- Preserve commit and conflict-resolution drafts when changing language.
- Use platform-neutral Git executable instructions.

The 25 automated tests pass. Release assets continue to include GitHub provenance attestations.

Desktop only. Requires Git installed separately. Git authentication and commit identity use the local Git configuration.

Until approved in the Obsidian Community directory, install from these release assets or with BRAT using `li-cr/VaultBranch`. This release does not imply directory approval.
