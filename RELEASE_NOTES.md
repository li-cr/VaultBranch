VaultBranch 1.0.4 separates plugin coordination and Git workflows.

- Extract host event registration, view navigation and save-before-Git/refresh coordination from the plugin entry point.
- Separate Git history, Stash and conflict/Rebase workflows, sharing existing read limits. Keep public calls, current service/settings, draft ownership and safety checks.
- Expand the single release-check suite with history, native editor menu, graph batching and conflict-page stability regressions. No new dependencies or Git command changes.

Local Windows / Obsidian 1.15.0, ms (median):

| Measurement | Current | Samples |
| --- | ---: | --- |
| Plugin reload, warm cache | 10.8 | 5 |
| Trusted click → Staged / Changed page ready | 140.8 / 97.4 | 20 each |
| Changed 1.6 MB JSON, type / Enter / Backspace | 7.3 / 4.4 / 1.1 | 5 each |
| Changed 1.28 MB Markdown, type / Enter / Backspace | 7.6 / 5.9 / 7.1 | 5 each |

First sidebar: 324.4 ms; first diff: 221.8 ms, separate from plugin load. Switching includes CPU sampling overhead; typing is native event-to-document update. No speedup, physical-paint or 50 ms switching claim.

Validated in one complete release-check run: 119 automated tests, 310 Obsidian UI assertions, both builds' three required performance probes. Index preserved; final sessions/pending reads/runtime errors: zero.

Version/tag: [1.0.4](https://github.com/li-cr/VaultBranch/tree/1.0.4). Baseline: [1.0.3 / e2524af](https://github.com/li-cr/VaultBranch/tree/1.0.3). Tested source: [7a9603151582740f7c7fa80dafdaeea0407500e8](https://github.com/li-cr/VaultBranch/commit/7a9603151582740f7c7fa80dafdaeea0407500e8). [Compare](https://github.com/li-cr/VaultBranch/compare/1.0.3...1.0.4).

[Performance report and reproduction](https://github.com/li-cr/VaultBranch/blob/1.0.4/docs/performance/1.0.4.md) · [Raw samples](https://github.com/li-cr/VaultBranch/blob/1.0.4/docs/performance/1.0.4-samples.json). The tag workflow appends the exact final commit; tested runtime and dependency hashes are in the samples.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
