VaultBranch 0.2.28 removes the incomplete loading layout when opening a file diff.

- Read comparison data before rendering the new page. Show the path, full toolbar, save/navigation buttons, captions and editor together, without an intermediate “Loading diff…” page or temporary header-height jump.
- Prevent interaction with the previous file while a new comparison is pending. Keep background refreshes from replacing pending navigation and release cancelled/closed editor sessions under their original paths.
- Preserve manual drafts, manual saving, readonly staged comparisons, external-change protection and the existing oversized-file patch fallback. Add no dependencies, runtime timers or caches.
- Require alternating small/large JSON and Markdown, nested directories, duplicate basenames, size boundaries and complete first-open checks in AGENTS.md development tests.

In two local Windows Obsidian collections, each with 20 measured real sidebar file opens, intermediate loading layouts changed from 20/20 opens to 0/20. Sampled blank/loading animation frames changed from 313 to 0 and 357 to 0; editable header height stayed constant after the change. Fixtures alternate 29-byte Markdown, 1.6 MB JSON, 31-byte JSON and 1.2 MB Markdown in nested directories. This measures intermediate UI exposure, not physical display frames. File-opening timings varied between collections; no speedup is claimed. Raw samples, timing ranges, limitations and reproduction steps are in docs/performance/0.2.28.md.

Validated with 89 local automated tests and 76 focused Obsidian UI assertions, including near/over-2-MB files, first-open completeness, rapid clicks, loading failures, close-during-load cleanup, drafts, new-input undo, manual save, unchanged index and startup restoration. Syntax, version, CSS and build checks pass. Existing cross-file undo history behavior is unchanged.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
