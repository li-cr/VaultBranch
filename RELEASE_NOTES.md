VaultBranch 0.2.36 reduces repeated Git reads when switching Staged files.

- Query HEAD and the staged index concurrently.
- Share the bounded immutable-blob reader across Changed, Staged and historical comparisons. Keep the two-MiB content limit, eight-entry/four-MiB cache bounds, fresh HEAD/index reads and editable-session safety checks.
- Remove separate blob-size subprocesses. The initial four-file local Staged benchmark used five Git calls per click instead of seven.
- Simplify the English and Chinese README to main features and a GitHub Issues invitation.

Validated with 107 local automated tests and trusted GUI switching in an isolated repository with 100 staged and 100 changed files. Staged comparisons remain read-only, Changed comparisons remain editable, and the index was unchanged. Local timings vary by file and machine; no equal-speed or 50-ms guarantee is claimed. See docs/performance/0.2.36.md for medians, ranges, raw measurements and reproduction.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
