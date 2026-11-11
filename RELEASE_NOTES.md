VaultBranch 1.0.2 reduces whole-document conversion during diff editing.

- Keep CodeMirror's persistent document while typing; convert to a string when saving or serializing a workspace draft needs it.
- Separate document/text handling from save scheduling and conflict protection. Preserve exact dirty checks, undo-to-saved state, shared views, manual save, autosave, CRLF/BOM and restored drafts.
- Keep live Git and path safety checks unchanged; no new dependencies or Git caches.

V8 debug sampling identified whole-document conversion in the input listener as a hotspot. In the matched profiled benchmark, 30 synchronous edits to a 1.6 MB JSON file took a median 125.1 ms before and 13.9 ms after; a 1.28 MB Markdown file changed from 42.7 to 10.5 ms. Large-document conversions dropped from 30 to 0 per batch. Each target has five measured batches. Native trusted input also ran, with smaller and variable improvements once event scheduling/rendering were included. These are local synthetic tests, not a universal latency promise. File-switch speed was not improved by this change. Raw CPU profiles, samples and reproduction: docs/performance/1.0.2.md.

Validated with 112 automated tests and 141 Obsidian UI checks covering shared views, draft serialization/reload, navigation, chunk reverts, highlighting, saving/undo and mixed-size loading. Trusted native GUI switching checks preserve readonly modes and the index.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
