# VaultBranch

[English](README.md) | [简体中文](README_zh.md)

A Git sidebar and commit graph for Obsidian.

## Features

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

## Install and update

- If VaultBranch is available in your Obsidian Community plugins directory, install or update it there. Publishing a GitHub release does not establish directory approval.
- With [BRAT](https://github.com/TfTHacker/obsidian42-brat), add `li-cr/VaultBranch` and use BRAT to update it.
- For manual installation, download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/li-cr/VaultBranch/releases/latest). Place all three in `<vault>/.obsidian/plugins/vaultbranch/`, then enable VaultBranch in Community plugins. To update, disable the plugin, replace those three files and enable it again; preserve `data.json`.

The vault must be a Git repository. Git authentication, commit identity, hooks and credential helpers use your local Git configuration. VaultBranch reads repository files and Git metadata and runs the installed Git executable with the same OS permissions as Obsidian.

## Editing and saving

Manual save is the default. Edits and block restores in the right pane remain drafts until you save; optional autosave saves after 500 ms without input and before switching files or Git operations. Saving changes the working file, while staging is a separate action. Commits include only the staged index. Unsaved drafts block Git operations; conflicting external edits pause overwriting. Staged and historical comparisons stay read-only.

## Timing diagnostics

Under **Settings → VaultBranch → Other**, enable **Tuning: record operation timings**, set **Timing record limit**, click files in the sidebar, then open **View records**.

- Select, edit and copy the report in a plain text editor. Copy uses the displayed text; editing the report does not alter recorded measurements. Clear removes the stored records.
- Recording is off by default. The limit defaults to 100; 0 keeps all records for the current run. Lowering the limit immediately removes older records.
- Reports contain relative file paths and stage durations, without file contents or automatic upload. They stay in memory and are cleared when recording is disabled or the plugin reloads.
- Content ready, navigation complete and animation-frame callbacks are separate milestones. Stages may overlap; do not add their durations together. Frame callbacks do not guarantee physical paint. Recording itself adds overhead.

## Performance and the 50 ms target

In the local Windows GUI benchmark for 0.2.32, warm click-to-complete-page DOM medians with timing recording off were **103.2 ms for small Markdown** and **100.2 ms for small JSON**, down from 131.3 and 146.5 ms in 0.2.31. Large JSON and Markdown medians were 133.6 and 115.2 ms. Each result uses five trusted mouse clicks; these are local measurements, not a universal latency or paint guarantee. See [test conditions, ranges, raw samples and reproduction](docs/performance/0.2.32.md).

**50 ms is a target for common file switches, not an achieved result.** The proposed next step is to remove repeated Git process startup from the unchanged-index path: verify current index bytes, reuse Git-parsed entries only when those exact bytes match, read the working file freshly and reuse immutable blobs by hash. Changed indexes and cache misses still require Git. Compatibility with linked worktrees, alternate/split indexes and concurrent staging must be validated before shipping this design; an expiry timer or file timestamp alone is insufficient.

First opens, cache misses and large files need separate measurements. Draft/save ordering, global conflict checks and external-change protection must remain intact. The target must be checked with real sidebar clicks, alternating small/large JSON and Markdown in nested directories, with timing recording both off and on. This documentation update (0.2.33) adds no runtime optimization or new benchmark.
