VaultBranch 0.2.18 organizes settings into tabs.

- Group existing preferences under General, Git, Commit and Other, with icon tabs and an active underline.
- Keep native Obsidian settings controls and existing saved values; retain the selected tab when redrawing settings.
- Support ArrowLeft/ArrowRight, Home/End, and accessible tab/tabpanel roles. Allow horizontal tab scrolling in narrow windows.
- Local branch creation and switching remain available, without a new feature toggle.

Validated with 15 Obsidian UI checks for all settings groups, saved input across tab changes, keyboard navigation, language updates, and branch toolbar availability. Build, syntax, CSS and relevant local regression checks pass. This is a settings UI update, with no performance improvement claimed.

Release assets continue to include GitHub provenance attestations.

Desktop only. Requires Git installed separately. Git authentication and commit identity use the local Git configuration.
