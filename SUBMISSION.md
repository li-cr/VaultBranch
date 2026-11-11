# Obsidian Community directory submission

Official instructions: https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin

Repository: `li-cr/VaultBranch`

Plugin ID: `vaultbranch`

Plugin name: **VaultBranch**

Author: **li-cr**

Description:

> Manage Git changes, browse a commit graph, restore stashes, and resolve conflicts in your vault.

Current release tag: `0.2.36` (must match `manifest.json` exactly).

## Before submitting

The default branch must contain `README.md`, `LICENSE`, `manifest.json` and the plugin source. The matching published GitHub release must include `main.js`, `manifest.json` and `styles.css`. A tag or repository alone is not sufficient.

## Submit with the repository owner's account

1. Visit https://community.obsidian.md and sign in with your Obsidian account.
2. Link your GitHub account (`li-cr`) to the profile so the directory can verify repository ownership.
3. Choose the option to add a plugin and submit `li-cr/VaultBranch`.
4. Review the imported metadata and the automated review results. Publish when the directory permits it.
5. Address review feedback by committing fixes and publishing a new matching version and release.

The plugin becomes installable from within Obsidian after the directory's review requirements are satisfied. This repository cannot bypass or guarantee that review. Do not submit a duplicate plugin entry through the old `community-plugins.json` PR route unless the official documentation changes back to it.

No Obsidian account password, GitHub token, SSH private key, or local plugin `data.json` should be committed to the repository.

## Review recommendations and capability disclosures

Versions from `0.2.1` onward publish only `main.js`, `manifest.json` and `styles.css` as release attachments. GitHub artifact attestations are generated for those exact files by the release workflow. Select or refresh the current version in the directory to rerun the release checks; version `0.2.0` still has its original attachments.

The filesystem and shell/process capability warnings are expected: the plugin reads Git metadata and repository files with `node:fs/promises` and invokes the installed Git executable with `node:child_process.execFile`. It uses argument arrays and `shell: false`, not concatenated shell command strings. These capabilities share Obsidian's OS permissions; Git hooks and credential helpers follow the user's Git configuration. Filesystem writes save conflict resolutions and explicitly requested settings-tracking exceptions; Git metadata can live outside the vault for linked worktrees. Untracked-file discard uses Obsidian's local trash. Attestations do not suppress those warnings or guarantee directory approval.
