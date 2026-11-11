VaultBranch 0.2.27 avoids rebuilding the sidebar when selecting a file.

- Update only the previous and clicked row's selected background. Keep existing file rows, icons, buttons, focus and scroll position.
- Exclude selection from the tree render snapshot so the next unchanged status refresh also retains the tree. Keep full rendering for file/status changes, staging transitions, conflicts, Git-busy state, folder collapse and language changes.
- Preserve the existing diff/conflict opening callbacks, draft sessions and live editor line/diff updates. Add no dependencies, caches, timers or Git queries.

In a local Windows Obsidian recheck with five measured batches per build, synthetic sidebar click/layout medians changed from 3.54 to 0.27 ms for 10 modified files, 25.78 to 0.26 ms for 100 files, and 212.04 to 0.44 ms for 1,000 files. These timings isolate sidebar updates and exclude Git/file reads, opening the editor and final paint; they are not whole-app or startup measurements. Initial and repeat collections, ranges, raw data and reproduction steps are in docs/performance/0.2.27.md.

Validated with 84 local automated tests and 21 focused Obsidian UI checks. Syntax, version, CSS and build checks pass. Existing cross-file undo history behavior is unchanged: drafts survive A/B switching, but undo history from the prior editor is not retained. No cross-file undo improvement is claimed.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
