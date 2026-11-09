VaultBranch 0.2.1 addresses the community directory's release recommendations.

- Generate GitHub artifact attestations for `main.js`, `manifest.json` and `styles.css`.
- Attach only the three supported Obsidian plugin assets; omit the extra ZIP.
- Document the filesystem and Git subprocess capabilities detected by the community scanner.
- Explicitly set `shell: false` on Git subprocesses (matching the previous execFile default).
- Keep the existing source control, graph, Stash and conflict workflows.

Desktop only. Requires Git installed separately. Git authentication and commit identity use the local Git configuration.

Until approved in the Obsidian Community directory, install from these release assets or with BRAT using `li-cr/VaultBranch`. This release does not imply directory approval.
