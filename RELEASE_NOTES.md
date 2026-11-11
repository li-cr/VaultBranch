VaultBranch 1.0.3 separates editor session ownership and pure Git data calculations.

- Move session sharing, draft retention, release rules and normal/hidden file write adapters into EditorSessions. Keep Autosave responsible for scheduling and external-write protection, and EditorDocument responsible for native document/text handling.
- Put status parsing, file grouping/tree building, patch rows and commit graph calculations in git-data.js. Views import these functions directly; the plugin coordinates lifecycle, Git operations and navigation.
- Add a single release-check command that runs validation, all automated tests, build, both builds' three performance benchmarks, then UI regressions. No new dependencies or changes to Git command/safety behavior.

Local Windows / Obsidian 1.15.0 measurements (ms, median):

| Measurement | Current | Samples |
| --- | ---: | --- |
| Plugin reload, warm cache | 20.9 | 5 |
| Trusted click to Staged / Changed page ready | 165.2 / 114.7 | 20 each |
| Changed 1.6 MB JSON, type / Enter / Backspace | 6.0 / 6.4 / 3.0 | 5 each |
| Changed 1.28 MB Markdown, type / Enter / Backspace | 4.7 / 7.5 / 5.6 | 5 each |

First sidebar: 355.0 ms; first diff: 314.3 ms, measured separately from plugin load. Switching includes CPU sampling overhead; typing is event-to-document update, not physical paint. Initial and reversed-order runs vary with Git/filesystem waiting. No speedup or 50 ms switching claim.

Validated with 115 automated tests and 226 Obsidian UI assertions in the complete release-check run. Both performance probes preserve the index; final sessions/pending reads/runtime errors are zero.

Version/tag: [1.0.3](https://github.com/li-cr/VaultBranch/tree/1.0.3). Baseline: [1.0.2 / c04b9ed](https://github.com/li-cr/VaultBranch/tree/1.0.2). Tested source: [fda69dfd3d9b03484ab30f0b2b8e90edf78b2952](https://github.com/li-cr/VaultBranch/commit/fda69dfd3d9b03484ab30f0b2b8e90edf78b2952). [Compare versions](https://github.com/li-cr/VaultBranch/compare/1.0.2...1.0.3).

[Performance report, ranges and reproduction](https://github.com/li-cr/VaultBranch/blob/1.0.3/docs/performance/1.0.3.md) · [Raw samples](https://github.com/li-cr/VaultBranch/blob/1.0.3/docs/performance/1.0.3-samples.json). Final release commit is appended by the tag workflow; tested source/dependency hashes are recorded in the samples.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
