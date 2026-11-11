# VaultBranch

[English](README.md) | [简体中文](README_zh.md)

Git source control inside Obsidian. Desktop only; requires Git and a vault initialized as a Git repository.

## Features

- **Git sidebar**: browse changed files, stage, commit, pull and push.
- **Editable diffs**: compare versions side by side, edit changes and restore individual blocks; manual save or optional autosave.
- **Image comparisons**: preview and compare images in Changes, Staged and file history; scroll to zoom and drag to pan.
- **Commit graph and file history**: explore branches, merges and past changes, including file renames.
- **Branches and Stash**: create or switch branches, save changes and restore a selected stash.
- **Conflict resolution**: compare local and incoming changes, edit the result, and continue or abort a rebase.
- **Editor options**: diff folding and navigation, optional JSON/Markdown syntax highlighting, date insertion and Chinese/English UI.

## Current performance · 1.0.4

Local Windows / Obsidian 1.15.0, compared with 1.0.3. Medians in ms; structure cleanup, no speedup claim.

| Measurement | ms | Samples |
| --- | ---: | --- |
| Plugin reload (warm cache) | 10.8 | 5 |
| Click → Staged / Changed page ready | 140.8 / 97.4 | 20 each |
| Changed 1.6 MB JSON: type / Enter / Backspace | 7.3 / 4.4 / 1.1 | 5 each |
| Changed 1.28 MB Markdown: type / Enter / Backspace | 7.6 / 5.9 / 7.1 | 5 each |

Switching includes CPU sampling; typing measures native input to document update. [Environment, comparison and reproduction](https://github.com/li-cr/VaultBranch/blob/1.0.4/docs/performance/1.0.4.md) · [Tag 1.0.4](https://github.com/li-cr/VaultBranch/releases/tag/1.0.4).

## Feedback

Bug reports and feature requests are welcome! [Open an issue](https://github.com/li-cr/VaultBranch/issues/new/choose).
