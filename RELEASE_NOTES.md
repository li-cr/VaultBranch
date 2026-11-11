VaultBranch 0.2.21 reduces plugin startup work.

- Reuse Obsidian's CodeMirror core modules and initialize view implementations when their first leaf is created, including restored workspace views. Keep MergeView bundled and register commands/settings immediately.
- Apply new preference defaults in memory; save them on the next actual settings change instead of writing during startup. Preserve existing preferences.

In a local Windows / Obsidian 1.15.0 test vault with warm caches, five reloads per version gave a saved-preference median of 11.7 ms versus 26.4 ms; main.js shrank from 1,076,692 to 349,640 bytes. First-sidebar median rose from 239.5 to 255.1 ms; first-diff median rose from 214.6 to 224.2 ms. These are isolated plugin reloads, not full application cold starts. A reported 800 ms startup was not reproduced. Full samples, legacy-settings measurements, limitations and reproduction steps are in docs/performance/0.2.21.md and scripts/benchmark-startup.js.

Validated with 66 local automated tests and 101 Obsidian UI checks for startup/view restoration, navigation, file history, folding, autosave, hidden JSON, drafts/undo and external-change protection. Reproducible startup and editor UI scripts are in tests/manual; run only in the note_test vault. Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
