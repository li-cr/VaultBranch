VaultBranch 0.2.32 reduces the work required to prepare editable file diffs.

- Replace each whole-worktree status scan plus path-filtered index query with one live index read. Preserve global conflict detection, operation/path checks and current index/worktree content.
- Read uncached index blobs with one bounded command instead of separate size and content processes. Preserve UTF-8 and 2 MiB limits and immutable-cache bounds.
- Check operation markers concurrently and report them separately in tuning logs. Keep post-render verification, serialized saves and draft/external-change protection.

In a local Windows GUI benchmark with five trusted clicks per file/build/mode, warm click-to-DOM medians with logging off changed from 131.3 to 103.2 ms for small Markdown and 146.5 to 100.2 ms for small JSON. With the blob cache cleared before each click, medians changed from 291.6 to 178.8 ms for small Markdown and 405.6 to 209.9 ms for 1.6 MB JSON. Warm editable opens use two Git subprocesses instead of four, including final verification; blob misses use three instead of six. These are specific local operations, not a cross-plugin benchmark, startup or physical-paint guarantee. See docs/performance/0.2.32.md for ranges, raw samples, reproduction and limitations.

Validated with 104 local automated tests and focused Obsidian UI checks for mixed sizes/nested paths, drafts, saves, external changes, cancellation, timing and startup. New regression checks include unrelated-file conflicts, 10,001 index entries and exact/over-2-MiB multibyte blobs. Syntax, version, CSS and build checks pass.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
