# VaultBranch

A compact Git sidebar and commit graph for Obsidian. Stage selected changes, commit, pull, push, manage Stash entries, and resolve text conflicts without leaving your vault.

VaultBranch is a desktop plugin. Git must be installed separately. It uses your existing Git repository, identity and SSH/HTTPS authentication.

## Features

- Nested file trees for staged, unstaged and conflicted files.
- Commit only staged changes, including partial-file staging done outside the plugin.
- Side-by-side and unified diffs.
- A commit graph with branch filtering, search, commit files and mouse navigation back from diffs or notes.
- Multiple Stash entries displayed as individual graph nodes. Right-click an entry to Apply (keep the record) or Pop (remove the record after successful restoration).
- Right-click ordinary commits to rebase the current branch onto a selected commit. Push always targets the current branch's configured upstream.
- Conflict resolution with editable results, save and stage, continue and abort.
- Date and hostname placeholders in commit messages.
- Colors and controls that follow the active Obsidian theme.

## Installation

### Community directory

Community directory submission is pending. Uploading this repository or creating a GitHub release does not make the plugin searchable in Obsidian. It becomes searchable after the submission is published and passes the directory checks.

### Install from a GitHub release

1. Install Git and initialize or clone a repository whose root is your vault.
2. Create `<vault>/.obsidian/plugins/vaultbranch/`.
3. Download `main.js`, `manifest.json` and `styles.css` from the same [Release](https://github.com/li-cr/VaultBranch/releases) into that folder.
4. Open Obsidian Settings → Community plugins and enable **VaultBranch**.

No Node.js or npm is needed to run the plugin. Release attachments contain only these three files, matching the Obsidian installer.

BRAT users can add the repository `li-cr/VaultBranch` once its first release is available.

## Usage

Open VaultBranch from the ribbon or command palette. Use `+` to stage files and `−` to unstage. Commit uses the existing staged index; it does not automatically stage other edits. Press Ctrl+Enter (Cmd+Enter on macOS) in the commit box to commit.

Pull defaults to Rebase and requires a clean working tree, including untracked files. Use Stash to temporarily save work, Pull, then restore your chosen Stash. Ignored files are excluded. Stash can contain tracked, staged and untracked changes. Restoration also requires a clean working tree. If restoration conflicts, the Stash record is retained.

Open the graph with the history icon. Left-click a row for changed files and action buttons; right-click for the action menu. Select the `stash` filter to see saved work. Historical Stash numbers can change, so restore actions identify the chosen entry by commit hash.

Rebase rewrites the current branch's unique commits and may change their hashes. It requires a clean working tree and a confirmation dialog. Resolve conflicts in the sidebar, then continue or abort. VaultBranch does not force-push.

In a conflict, the editor shows local/incoming versions (upstream/local during Rebase), a common ancestor and an editable result. Save and stage the result. Binary files, delete conflicts and previews over 2 MB require an external tool. Per-hunk conflict actions and line staging are not supported yet.

## Settings

| Setting | Default |
| --- | --- |
| Git executable | Detect from PATH |
| Pull method | Rebase |
| Refresh interval | 5 seconds |
| History page size | 100 commits |
| Open sidebar on startup | Enabled |
| Commit message prefix | `{{date}} {{hostname}} : ` |
| Date format | `YYYY-MM-DD HH:mm:ss` |
| Hostname override | Empty: use the current computer's hostname |

Settings are stored in `<vault>/.obsidian/plugins/vaultbranch/data.json`. Clear the prefix to use only your manually typed message. Dates are generated when you commit. Time formatting uses Obsidian's Moment API.

The settings page reports whether Git tracks `data.json`. If it is ignored, **Allow tracking** adds targeted exceptions to the vault's `.gitignore`. Stage and commit those changes yourself. Nothing is staged automatically.

For another computer, copy or clone your vault and install VaultBranch. Keep the Git executable override empty to use the new computer's PATH, and keep the hostname override empty to use its own name. Configure Git identity and credentials on that computer separately.

### Moving from the local My Git prototype

VaultBranch has its own plugin ID. Disable **My Git** before enabling VaultBranch to avoid two Git sidebars. To keep existing preferences, copy `.obsidian/plugins/my-git/data.json` to `.obsidian/plugins/vaultbranch/data.json` before enabling VaultBranch. Existing commits and Stash entries belong to the repository and are available to both plugins; they are not deleted or migrated.

## Privacy and network use

VaultBranch has no analytics or telemetry and does not use a separate backend. Git data stays in your repository. Fetch, Pull and Push communicate with the remotes configured in that repository through the installed Git executable. The plugin reads the local hostname only for the commit message template, unless you override it. No credentials are included in the release.

### Why the directory reports filesystem and command execution warnings

VaultBranch is a native Git integration. The directory's capability scanner detects the following modules:

- `node:fs/promises`: reads repository files and Git operation metadata (including hidden files), writes conflict resolutions, and updates `.gitignore` when you explicitly choose to allow settings tracking. Git metadata can live outside the vault for a linked Git worktree.
- `node:child_process`: launches the installed Git executable using `execFile` with an argument array, the vault as its working directory, and `shell: false`. Commit messages and paths are not assembled into a shell command. The optional executable override is a path to Git, not a shell command.

These capabilities run with the same system permissions as Obsidian; they are not an operating-system sandbox. Git also honors your repository configuration, hooks, credential helpers and configured remotes. Use the plugin with repositories and Git configurations you trust. The module warnings are expected for this design and are disclosed here rather than hidden or bypassed.

### Verify release provenance

Tagged releases from `0.2.1` onward generate GitHub artifact attestations for `main.js`, `manifest.json` and `styles.css`. These bind each file's digest to the source repository and release build. After downloading the files, verify them with GitHub CLI:

```sh
gh attestation verify main.js --repo li-cr/VaultBranch
gh attestation verify manifest.json --repo li-cr/VaultBranch
gh attestation verify styles.css --repo li-cr/VaultBranch
```

Attestations establish build provenance; they do not remove filesystem or process-execution capabilities and do not certify that a plugin is safe.

## Development

```sh
npm ci
npm run check
npm test
npm run build
```

Source files are in `src/`. The build bundles the Git service into a single CommonJS `main.js`; only the Obsidian API and Node built-ins remain external. `dist/vaultbranch/` contains the installable plugin. Test cases create isolated temporary repositories and local bare remotes; `npm test` does not contact GitHub.

Pushing a tag that exactly matches `manifest.json` (for example `0.2.1`, without a `v` prefix) triggers the release workflow. It runs checks and tests, builds the plugin, generates provenance attestations and publishes only the three Obsidian assets. The workflow uses the repository's automatic GitHub Actions token and short-lived OIDC identity; no personal release token is needed.

See [SUBMISSION.md](SUBMISSION.md) for the current community directory submission process.

## License and acknowledgements

[MIT](LICENSE), © 2026 li-cr. The compact sidebar is inspired by Obsidian Git and the history layout by the VS Code Git Graph extension. VaultBranch is an independent plugin and is not affiliated with those projects or Obsidian.
