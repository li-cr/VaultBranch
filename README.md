# VaultBranch

[English](README.md) | [简体中文](README_zh.md)

A Git sidebar and commit graph for Obsidian.

- View changed files, diffs and commit history.
- Right-click a file to browse its history, including Git-detected renames; compare each commit with its parent.
- Create and switch local branches; create a branch from a selected graph commit.
- Edit directly in the right diff pane with live diff highlighting; save with Ctrl/Cmd+S or enable optional autosave.
- Enable **Diff syntax highlighting** under **Other** for JSON and Markdown source. Off by default; other file types remain plain text. Applies to editable, staged and file-history comparisons without changing drafts, selection or undo. Documents above 200,000 characters or lines above 10,000 characters use plain text. Markdown code fences use one code style without embedded language parsing.
- Restore one unstaged change block from the staged version using the arrow between panes; undo with Ctrl/Cmd+Z. Manual mode keeps the result as a draft until saved; autosave follows the existing setting. This does not stage content. Staged and historical comparisons remain read-only.
- Unchanged lines fold by default; configure native CodeMirror folding under Other.
- Jump between changes with ↑ / ↓; show or hide the buttons under Other.
- Insert dates with `@date` or a configured hotkey; customize the format under Other.
- Switch between Chinese and English in settings.
- Discard unstaged changes with the undo arrow; move untracked files to trash.
- **Pull**: pull remote changes.
- **Push**: push local commits.
- **Commit staged**: commit only staged changes.
- **Stash push**: save uncommitted changes for later.
- **Stash pop**: restore a selected stash and remove its record after successful restoration; keep it if conflicts occur.

Desktop only. Requires Git installed locally.
