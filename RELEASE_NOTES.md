VaultBranch 1.0.7 — unused translation cleanup.

- Remove 13 obsolete translation entries from retired source/preview text controls, draft dialogs and loading placeholders. Keep all 292 currently used English entries unchanged.
- Reduce bundled main.js by 1206 bytes. No dependencies added and no operation-speedup claim.
- Git read/write, validation, caches, editor lifecycle, independent table compatibility and CSS are unchanged.

Local Windows / Obsidian 1.15.0; ms, median:

| Measurement | ms | Samples |
| --- | ---: | --- |
| Plugin reload (warm cache) | 12.1 | 5 |
| Click → Staged / Changed page ready | 141.7 / 98.8 | 20 each |
| Changed 1.6 MB JSON: type / Enter / Backspace | 5.1 / 4.4 / 1.0 | 5 each |
| Changed 1.28 MB Markdown: type / Enter / Backspace | 5.5 / 3.4 / 14.1 | 5 each |

First sidebar: 359.0 ms; first diff: 240.7 ms, measured separately from plugin load. A reverse-order follow-up of first-use/Backspace variability is retained separately in the report; primary results above are unchanged. Plugin reload uses warm caches. Switching includes CPU sampling; typing measures trusted native input to document update. Table compatibility, highlighting and autosave are off during required benchmarks. All baseline comparisons, ranges, flags and raw samples are in the report; physical paint is not measured.

Validated in one complete release-check run: 129 automated tests, 415 UI assertions and both builds' three performance probes. Index preserved; final sessions, pending reads, runtime and captured console errors: zero.

Version/tag: [1.0.7](https://github.com/li-cr/VaultBranch/tree/1.0.7). Baseline: [1.0.6 / d35c759afa99e704c37aa9c717a06d6e6a3d315d](https://github.com/li-cr/VaultBranch/tree/1.0.6). Tested source: [886964eb231528942483746f307b3f7e9ac46456](https://github.com/li-cr/VaultBranch/commit/886964eb231528942483746f307b3f7e9ac46456). [Compare 1.0.6...1.0.7](https://github.com/li-cr/VaultBranch/compare/1.0.6...1.0.7).

[Performance report and reproduction](https://github.com/li-cr/VaultBranch/blob/1.0.7/docs/performance/1.0.7.md) · [Raw samples](https://github.com/li-cr/VaultBranch/blob/1.0.7/docs/performance/1.0.7-samples.json). The tag workflow appends the exact release commit.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
