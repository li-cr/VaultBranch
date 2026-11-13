# VaultBranch

[English](README.md) | [简体中文](README_zh.md)

Git source control inside Obsidian. Desktop only; requires Git and a vault initialized as a Git repository.

## Features

- **Git sidebar**: browse changed files, stage, commit, pull and push.
- **Editable diffs**: compare versions side by side, edit changes and restore individual blocks; manual save or optional autosave.
- **Image comparisons**: compare images in Changes, Staged and file history; zoom and pan. SVG defaults to preview with a source switch.
- **Commit graph and file history**: explore branches, merges and past changes, including file renames.
- **Branches and Stash**: create or switch branches, save changes and restore a selected stash.
- **Conflict resolution**: compare local and incoming changes, edit the result, and continue or abort a rebase.
- **Editor options**: diff folding and navigation, optional JSON/Markdown syntax highlighting, date insertion and Chinese/English UI.
- **Note tables**: optionally render tables without a preceding blank line in Reading view and Live Preview, with native table source styles.

## Current performance · 1.0.7

Local Windows / Obsidian 1.15.0, compared with 1.0.6. Medians in ms; unused-string cleanup carries no operation-speedup claim.

| Measurement | ms | Samples |
| --- | ---: | --- |
| Plugin reload (warm cache) | 12.1 | 5 |
| Click → Staged / Changed page ready | 141.7 / 98.8 | 20 each |
| Changed 1.6 MB JSON: type / Enter / Backspace | 5.1 / 4.4 / 1.0 | 5 each |
| Changed 1.28 MB Markdown: type / Enter / Backspace | 5.5 / 3.4 / 14.1 | 5 each |

Table compatibility defaults off. Switching includes CPU sampling; typing measures native input to document update. [Environment, ranges, comparison and reproduction](https://github.com/li-cr/VaultBranch/blob/1.0.7/docs/performance/1.0.7.md) · [Tag 1.0.7](https://github.com/li-cr/VaultBranch/releases/tag/1.0.7).

## Feedback

Bug reports and feature requests are welcome! [Open an issue](https://github.com/li-cr/VaultBranch/issues/new/choose).
