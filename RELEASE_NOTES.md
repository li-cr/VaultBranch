VaultBranch 0.2.30 lets the latest file click supersede an unfinished diff open and makes timing retention configurable.

- Start B without waiting for A's full read/render/verification cycle. Share initial native view creation, discard obsolete results and release their sessions. Keep live safety checks, atomic page construction, drafts and post-render synchronization.
- Preserve per-file save ordering. Dirty autosave still completes before switching; clean sessions do not enqueue empty saves behind verification.
- Add Timing record limit under Other: default 100, or 0 for unlimited records during this run. Apply on Enter or leaving the field, trim oldest records when reducing the limit and reject invalid values. Logging remains off by default; records stay in memory and clear on disabling/reload.

In a local Windows GUI benchmark with five trusted mouse clicks per file/build/mode, rapid large-A to small-B click-to-DOM medians with logging off changed from 353.7 to 129.1 ms for Markdown and 313.6 to 124.1 ms for JSON. With logging on, queue medians changed from 225.0 to 1.4 ms and 202.7 to 0.6 ms. Actual click gaps and system scheduling varied; ordinary sequential collections showed no consistent speedup. These are warm local operations, not startup or physical paint measurements. See docs/performance/0.2.30.md for ranges, raw collections, reproduction and limitations.

Validated with 101 local automated tests, focused navigation rechecks and 88 Obsidian UI assertions covering mixed sizes/nested paths, latest-click behavior, draft/save/external-change protection, readonly comparisons, cleanup, settings, timing and startup restoration. Syntax, version, CSS and build checks pass. No cross-file undo-history improvement is claimed.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
