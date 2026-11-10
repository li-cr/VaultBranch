VaultBranch 0.2.6 addresses the community CSS lint warnings.

- Remove all 27 `!important` declarations from the stylesheet.
- Use scoped selectors for view padding, buttons, file rows, graph rows and graph-return controls.
- Use the standard theme accent variable for selection and focus colors.
- Reject `!important` in the existing validation command to prevent regressions.
- Retain the filesystem and native Git capabilities disclosed in SUBMISSION.md.

Release assets continue to include GitHub provenance attestations.

Desktop only. Requires Git installed separately. Git authentication and commit identity use the local Git configuration.

Until approved in the Obsidian Community directory, install from these release assets or with BRAT using `li-cr/VaultBranch`. This release does not imply directory approval.
