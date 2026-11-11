VaultBranch 1.0.1 reduces redundant UI updates while editing text diffs.

- Update static captions, revert labels and pane accessible names when the language changes.
- Update navigation tooltips, save availability, saving/dirty captions and warning visibility only when their values change.
- Preserve native navigation, live translation, drafts, undo, manual save, autosave and Git safety checks.

In a local Obsidian benchmark with 100 Staged and 100 Changed files, observed toolbar/caption/warning/pane-label mutations dropped from 270 to 0 per 30 edits in an already-dirty editor. Four mixed Markdown/JSON targets each had five measured batches. Dispatch timings varied; no general typing, startup or file-switch speed improvement is claimed. Reproduction and raw samples: docs/performance/1.0.1.md.

Validated with the existing 108 automated tests, the new stable-update regression, and 89 Obsidian UI checks covering navigation, chunk reverts and mixed-size loading.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
