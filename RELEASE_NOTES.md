VaultBranch 0.2.14 reduces redundant Git queries and view updates.

- Coalesce repeated file notifications and use Obsidian's debounce for repository refreshes.
- Reuse one size-limited, immutable index blob by Git hash while continuing to check the current index and working file.
- Skip unchanged directory-tree renders and avoid repeatedly converting unchanged CodeMirror documents.
- Avoid repository queries when changing non-Git preferences and skip saving identical setting values.
- Preserve manual saving, optional autosave, undo history, hidden JSON editing, and external-change conflict protection.

Validated with 48 local automated tests and 27 Obsidian UI checks. In an isolated test vault, ten simultaneous unchanged-file notifications required 2 Git subprocesses instead of 50; three unchanged repository refreshes produced no directory-tree DOM mutations. These measurements describe the tested operations, not an overall application speedup.

Release assets continue to include GitHub provenance attestations.

Desktop only. Requires Git installed separately. Git authentication and commit identity use the local Git configuration.
