VaultBranch 0.2.25 simplifies the change-block revert button styling.

- Replace the outlined button with a flat, lightly tinted theme-accent background inspired by the CodeMirror 5 merge demo. Strengthen the tint on hover and keep the visible keyboard focus outline.
- Fit the button to the existing center gutter and align it with the changed line's content padding.
- Change only two scoped CSS rules. Keep the native CodeMirror revert operation, drafts, undo, save/autosave and Git protections unchanged. Add no JavaScript, dependencies, animations or connector-drawing work.

Validated with 24 native chunk-revert UI checks in the note_test vault, plus dark/light theme screenshots and button alignment/gutter bounds inspection. Syntax, version, CSS and build checks pass. The generated main.js is byte-identical to 0.2.24. No latency improvement or zero-cost CSS rendering claim is made.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
