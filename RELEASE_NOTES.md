VaultBranch 0.2.10 fixes diff selection contrast.

- Use theme-derived translucent selection backgrounds for focused and inactive diff editors, keeping selected text readable in dark and light themes.
- Apply red/green backgrounds to changed lines and changed text using the correct CodeMirror merge selectors.
- Use scoped selector specificity without `!important`.

Release assets continue to include GitHub provenance attestations.

Desktop only. Requires Git installed separately. Git authentication and commit identity use the local Git configuration.
