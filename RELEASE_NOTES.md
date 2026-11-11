VaultBranch 0.2.38 adds mouse-wheel zoom to image comparisons.

- Hover an image and scroll up to enlarge it or down to shrink it. The minimum is its initial fit; the maximum is eight times that size.
- Drag an enlarged image to inspect details, or double-click to reset. Each side zooms independently, with a fresh initial fit when switching files or versions.
- Keep the comparison layout fixed and clip enlarged images inside their own panes. Zoom updates the loaded image transform without re-reading Git content or adding dependencies.

Validated in the disposable note_test vault with 42 image UI checks, including trusted native mouse-wheel and drag events, zoom bounds, independent panes, unchanged layout, reset, image comparisons and cleanup. The reproducible script is tests/manual/image-preview-ui.js. This is a feature update; no performance improvement is claimed.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
