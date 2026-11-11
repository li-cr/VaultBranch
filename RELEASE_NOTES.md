VaultBranch 0.2.24 adds optional JSON and Markdown syntax highlighting, off by default.

- Enable Diff syntax highlighting under Settings → Other for editable, staged and file-history comparisons. Only `.json`, `.md` and `.markdown` are supported; other types remain plain text.
- Color JSON keys, strings and values, and Markdown source headings, emphasis, links and code using theme variables. Markdown stays source text; fenced code has a single code style without nested language parsing.
- Apply setting changes without replacing editors or changing drafts, selection, undo, diff backgrounds or the staged index. Preserve native chunk reverts, navigation and existing manual-save/autosave behavior.
- Use plain text if either pane exceeds 200,000 characters or a line exceeds 10,000 characters. Editing across a limit disables highlighting safely; undo restores it. Historical revisions use their historical extensions after renames.
- Defer parser initialization until an enabled supported comparison opens. Reuse host CodeMirror/Lezer runtimes rather than bundling duplicate runtime code.

Validated with 80 local automated tests and 81 Obsidian UI checks. In local warm five-sample tests, enabling highlighting increased median synthetic 2,000-line open/layout time by about 11 ms for JSON and 16 ms for Markdown; editing also costs more. Default-off plugin reload recheck medians were 14.3 ms for 0.2.23 and 14.4 ms for the candidate. Initial and repeat first-diff measurements varied in opposite directions; no startup improvement or zero-cost claim is made. See docs/performance/0.2.24.md and the reproducible benchmark/UI scripts. Full application cold start was not measured.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
