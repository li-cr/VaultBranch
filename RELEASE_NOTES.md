VaultBranch 0.2.11 fixes hidden JSON editing and file switching.

- Open unstaged text files in the diff editor without filtering by extension or Obsidian's file index.
- Edit and autosave hidden configuration JSON through Obsidian's adapter processing, preserving external-change checks and the Git index.
- Synchronize hidden-file changes through raw file events.
- Process file-open requests in click order so rapid MD/JSON switching ends on the latest selection.
- Remove green underline effects while retaining green change backgrounds.

Release assets continue to include GitHub provenance attestations.

Desktop only. Requires Git installed separately. Git authentication and commit identity use the local Git configuration.
