VaultBranch 0.2.15 separates views and releases unused editor resources.

- Move source control, diff, history, conflict, and settings views into focused modules while retaining the existing Obsidian and CodeMirror APIs.
- Read all Stash metadata in one Git process and reuse native Intl.Collator for file-tree sorting.
- Render long history lists in batches of 100, allowing the UI to process other events and stopping when a view closes or changes.
- Release clean editor sessions, drafts, CodeMirror instances, and document references after their last view closes. Retain unsaved drafts and pending saves; keep shared sessions alive while another view uses them.
- Remove return-navigation records for closed workspace leaves. Keep existing error messages and recovery controls.

Validated with 52 local automated tests and Obsidian UI checks, including a synthetic 1,000-commit graph, cancellation during rendering, manual draft recovery, shared editor sessions, hidden JSON editing, keyboard and mouse actions, graph return navigation, and external-change protection. No new runtime dependencies.

Release assets continue to include GitHub provenance attestations.

Desktop only. Requires Git installed separately. Git authentication and commit identity use the local Git configuration.
