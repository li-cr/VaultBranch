VaultBranch 0.2.35 adds Git ancestry lines to file history.

- Render commit nodes and fork/merge lines beside file-history entries. Current/all-branch scope and rename-following history remain available; commits unrelated to the file are compressed out.
- Keep the graph read-only and use actual first-parent versions for selected-commit comparisons.
- Avoid a second Git process for current-branch pages without visible merges. In other scopes, read topology in one batch rather than once per row.
- Reuse the existing SVG renderer and fixed-height rows. Changing selection updates only the old and new row and does not reload file history.

Validated with 106 local automated tests, 32 Obsidian file-history checks, 36 gated stability checks and 12 trusted GUI history clicks using alternating small/large JSON. Performance measurements compare graph rendering data on/off across 1,000-change histories; no overall GUI latency improvement is claimed. See `docs/performance/file-history-graph-samples.json` and `scripts/benchmark-file-history-graph.cjs`.

Desktop only; requires Git installed separately.

---

VaultBranch 0.2.34 removes visible intermediate states during asynchronous views.

- Keep the complete file-history page while history and selected-commit comparisons load; update selection, path, description and read-only editor together.
- Keep commit-graph details and batched history lists detached until their complete data is ready. Reject late detail results after close or a newer selection.
- Keep conflict sources and manual resolutions during refreshes, preserving scroll position and save behavior.
- Update sidebar action disabled states in place when only busy state changes; file additions, status transitions and folder changes still rebuild the tree.

A trusted GUI stability check alternated small/large nested JSON history versions 12 times: the published 0.2.33 build exposed a loading or mismatched intermediate detail on 12/12 clicks; 0.2.34 exposed 0/12. Gated file-history, graph, conflict and sidebar checks also passed. This is a visual stability change, not a Git latency or 50-ms claim. See docs/performance/view-stability.md and view-stability-samples.json.

Validated with 104 local automated tests, 25 file-history checks, 21 sidebar checks, 41 editable diff-loading checks, 36 stability checks and 12 trusted GUI history clicks. Runtime errors and retained test sessions were empty. Syntax, versions, CSS and build checks pass.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
