VaultBranch 0.2.12 adds Other settings for date insertion and diff autosave.

- Type `@date` in a note to insert the current date and time. Customize the trigger and Moment format under Other, or configure the Insert current date and time command hotkey.
- Diff autosave is now off by default, including upgrades without an existing preference. Use Save or Ctrl/Cmd+S to save explicitly.
- In manual mode, switching files retains drafts and Git operations wait for you to save. Enabling autosave restores saving after 500 ms idle and before file switches or Git operations.
- Preserve external-change protection in both saving modes.

Release assets continue to include GitHub provenance attestations.

Desktop only. Requires Git installed separately. Git authentication and commit identity use the local Git configuration.
