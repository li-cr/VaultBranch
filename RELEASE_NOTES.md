VaultBranch 1.0.6 — table compatibility and source-style bug fix.

- Add an optional **Other → Tables without a blank line** switch, off by default. Render tables immediately after paragraph text in note Reading view and Live Preview without changing the file.
- **Bug fix / 修复：编辑模式下无空行表格的源码样式与原生表格不一致。** Reuse Obsidian's native table row and delimiter classes for font, size, weight and separator colors, following the current theme instead of fixed formatting.
- Click a Live Preview table to edit source; leaving the table restores the preview. Preserve drafts, selection, undo, ordinary tables and fenced code. Save the switch across reloads.
- Limit extra source highlighting to visible lines and ordinary re-parsing to the changed paragraph. Optimize the measured first compatibility scan without new dependencies or Git read/cache changes.

Local Windows / Obsidian 1.15.0, ms (median):

| Measurement | Current | Samples |
| --- | ---: | --- |
| Plugin reload, warm cache | 17.7 | 5 |
| Trusted click → Staged / Changed page ready | 202.3 / 139.8 | 20 each |
| Changed 1.6 MB JSON, type / Enter / Backspace | 4.1 / 5.2 / 0.9 | 5 each |
| Changed 1.28 MB Markdown, type / Enter / Backspace | 7.3 / 4.8 / 4.0 | 5 each |

First sidebar: 496.7 ms; first diff: 419.0 ms, separate from plugin load. Required release benchmarks have table compatibility off. Switching includes CPU sampling; typing measures native event-to-document update. With compatibility on, first field initialization for a 1.12 MB note is 9.1 [6.9–15.6] ms versus 25.9 [24.9–31.2] ms in the initial implementation; this excludes native editor creation and paint. Enabled/disabled rendering/input costs and all ranges are in the report. No overall speedup, zero-overhead or physical-paint claim.

Validated in one final complete release-check run: 129 automated tests, 415 UI assertions (49 table checks) and both builds' three required performance probes. Index preserved; final sessions/pending reads/runtime and console errors: zero. Support targets unindented top-level tables; native nested syntax and the native grid editor remain unchanged.

Version/tag: [1.0.6](https://github.com/li-cr/VaultBranch/tree/1.0.6). Baseline: [1.0.5 / ca0196b5c8c572a1aa62b977f6893c8a1ee211ee](https://github.com/li-cr/VaultBranch/tree/1.0.5). Tested source: [600b8e81b794956d78fee323b8b64ebd61d3d7d8](https://github.com/li-cr/VaultBranch/commit/600b8e81b794956d78fee323b8b64ebd61d3d7d8). [Compare](https://github.com/li-cr/VaultBranch/compare/1.0.5...1.0.6).

[Performance report and reproduction](https://github.com/li-cr/VaultBranch/blob/1.0.6/docs/performance/1.0.6.md) · [Raw samples](https://github.com/li-cr/VaultBranch/blob/1.0.6/docs/performance/1.0.6-samples.json). The tag workflow appends the exact release commit; runtime and dependency hashes are in the samples.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
