# Obsidian Community directory submission

Official instructions: https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin

Repository: `li-cr/VaultBranch`

Plugin ID: `vaultbranch`

Plugin name: **VaultBranch**

Author: **li-cr**

Description:

> Manage Git changes, browse a commit graph, restore stashes, and resolve conflicts in your vault.

Initial release tag: `0.2.0` (must match `manifest.json` exactly).

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
