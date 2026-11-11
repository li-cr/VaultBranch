VaultBranch 0.2.37 adds image previews and side-by-side image comparisons.

- Preview PNG, JPEG, GIF, WebP, BMP, ICO and AVIF files in Changes, Staged, commit diffs and file history, subject to the browser's format support.
- Compare index to working tree in Changes, HEAD to index in Staged, and parent to selected commit in history. Added and deleted images display the available version alongside an empty-version label.
- Decode both images before committing the complete page. Release image sources on switching, cancellation and close; retain the latest-request behavior and text editing safeguards.
- Keep image previews read-only, limit each image to 10 MiB, and show a short error for oversized or undecodable files. Other binary files retain their existing fallback. SVG continues through the text diff flow.

Validated locally with 108 automated tests, 30 image UI checks and 41 mixed Markdown/JSON diff UI checks in the disposable note_test vault. Image checks include a 3,608,585-byte PNG, nested paths, JPEG/WebP/GIF decoding, staged versus working content, root/deleted versions, stale requests and unchanged index. This is a feature update; no performance improvement is claimed.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
