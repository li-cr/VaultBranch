VaultBranch 0.2.22 avoids unnecessary background Git status refreshes.

- Suspend automatic sidebar status refreshes when the sidebar is closed, collapsed, behind another tab or in a hidden document. Check both native DOM visibility and the sidebar root's collapsed state.
- Refresh current status when the sidebar becomes visible. Keep explicit refresh, Git actions and independent editor synchronization/conflict safety checks available.
- Recheck visibility when a queued event refresh runs; use the existing interval as a fallback for visibility transitions.

In a local Obsidian 1.15.0 test vault, a burst of 20 refresh requests triggered 0 Git subprocesses instead of 2 with the sidebar closed, collapsed or on an inactive tab; visible refresh remained at 2. The benchmark preserved the Git index. These are deterministic background-operation counts, not a cold-start timing improvement. See docs/performance/0.2.22.md and scripts/benchmark-background-refresh.js for scope, environment, raw results and reproduction.

Validated with 70 local automated tests and 58 Obsidian UI assertions covering visibility/polling, restored workspaces, manual drafts, autosave, hidden JSON, external-change protection and cleanup. Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
