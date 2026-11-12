VaultBranch 1.0.5 adds SVG image previews with an editable source switch.

- Default to decoded preview in Changed, Staged, commit details and file history. Reuse image zoom/pan.
- Place a small source/preview icon on the right of the version-description row, preserving its original height.
- Create the source editor only when requested; preserve unsaved drafts, selection and undo across switches. Preview uses the current draft; toggling does not save or stage. Staged/history/deleted source stays readonly.
- Offer source repair for invalid SVG; keep existing path/conflict/UTF-8 protections and the 2 MB editing limit. Image-document isolation prevents SVG scripts and external resources from running/loading.
- Settle parallel raster-image reads before returning a failure, preventing a leftover status query from racing a later index write.

Local Windows / Obsidian 1.15.0, ms (median):

| Measurement | Current | Samples |
| --- | ---: | --- |
| Plugin reload, warm cache | 18.7 | 5 |
| Trusted click → Staged / Changed page ready | 187.9 / 133.0 | 20 each |
| Changed 1.6 MB JSON, type / Enter / Backspace | 3.9 / 5.8 / 1.1 | 5 each |
| Changed 1.28 MB Markdown, type / Enter / Backspace | 4.6 / 5.2 / 5.5 | 5 each |

First sidebar: 408.3 ms; first diff: 222.3 ms, separate from plugin load. Switching includes CPU sampling; typing is native event-to-document update. No speedup, physical-paint or 50 ms switching claim.

Validated in one final complete release-check run: 119 automated tests, 366 UI assertions including 56 SVG checks, and both builds' three required performance probes. Index preserved; final sessions/pending reads/runtime and console errors: zero.

Version/tag: [1.0.5](https://github.com/li-cr/VaultBranch/tree/1.0.5). Baseline: [1.0.4 / fa7f16b](https://github.com/li-cr/VaultBranch/tree/1.0.4). Tested source: [d930dc70d9430b1e438cb7aca8a0ad041810f5c6](https://github.com/li-cr/VaultBranch/commit/d930dc70d9430b1e438cb7aca8a0ad041810f5c6). [Compare](https://github.com/li-cr/VaultBranch/compare/1.0.4...1.0.5).

[Performance report and reproduction](https://github.com/li-cr/VaultBranch/blob/1.0.5/docs/performance/1.0.5.md) · [Raw samples](https://github.com/li-cr/VaultBranch/blob/1.0.5/docs/performance/1.0.5-samples.json). The tag workflow appends the exact release commit; runtime and dependency hashes are in the samples.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
