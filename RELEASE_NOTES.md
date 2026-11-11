VaultBranch 0.2.29 reduces file-diff loading work and adds optional GUI timing records.

- Run independent live status, path validation and index lookups concurrently. Preserve conflict/operation checks, current worktree/index reads and required post-render synchronization.
- Retain immutable index blobs in an LRU cache capped at eight hashes and 4 MiB of UTF-8 payload, avoiding repeated blob reads while alternating files. Do not cache mutable working-copy or index snapshots.
- Add “Tuning: record operation timings” under Other, off by default. Record real sidebar clicks, event/queue delay, Git, disk, editor construction, DOM readiness, post-render verification and frame callbacks. Keep the latest 100 records locally in memory, without file bodies or automatic upload.
- View, copy or clear records from Other. Disabling or reloading clears them, including pending completions. Keep records out of saved workspace drafts and settings.

In a local Windows Obsidian GUI recheck with five trusted mouse clicks per file/build, click-to-DOM-ready medians changed from 182.3 to 66.8 ms for small Markdown, 208.0 to 85.3 ms for 1.6 MB JSON, 183.5 to 66.2 ms for small JSON and 193.8 to 73.7 ms for 1.2 MB Markdown, with logging off. Warm alternating opens used four Git subprocesses instead of six. Native frame and navigation-complete timings are reported separately. These are specific warm local operations, not startup or physical paint measurements. Logging-on measurements showed additional overhead; keep it off for normal use. See docs/performance/0.2.29.md for ranges, raw samples, size/directory fixtures, reproduction and limitations.

Validated with 97 local automated tests and 72 focused Obsidian UI assertions, plus native setting-panel inspection and trusted GUI click benchmarks with logging off/on. Coverage includes cache bounds, live staging/disk updates, record clearing, copy/export, readonly comparisons, errors, draft/save/external-change protection, size limits, close-during-load cleanup and startup restoration. Syntax, version, CSS and build checks pass. Existing cross-file undo history behavior is unchanged.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
