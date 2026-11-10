VaultBranch 0.2.17 adds local branch management and avoids redundant history work.

- Create and switch local branches from Git Graph or the source-control More menu, using native Obsidian dialogs.
- Create a branch from a selected commit through its context menu. Git protects local changes from being overwritten; unsaved manual diff drafts block branch operations.
- Recheck refs, HEAD and the stash list on every history load, reuse one unchanged history page, and retain unchanged graph DOM. Manual refresh bypasses the cache.
- Keep commit-file selection working after unchanged refreshes and prevent stale detail requests from appending results.

Validated with 56 local automated tests and Obsidian UI checks for branch dialogs, selected-commit creation, draft protection, cache updates, hidden JSON editing and external-change protection.

In a local warmed benchmark with 1,000 commits and 3 stashes, unchanged history reads used 2 Git subprocesses instead of 5. Five-sample median read time was 122.43 ms versus 246.96 ms. An isolated UI benchmark produced no child-list mutations on unchanged reloads. These results describe specific operations, not overall application performance. See docs/performance/0.2.17.md and the reproducible benchmark scripts.

Release assets continue to include GitHub provenance attestations.

Desktop only. Requires Git installed separately. Git authentication and commit identity use the local Git configuration.
