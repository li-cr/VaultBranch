"use strict";

// Keep CodeMirror's persistent document until a save or workspace snapshot
// actually needs UTF-8 text. The public draft remains JSON-serializable.
class EditorDocument {
  constructor(draft, saved) {
    this.text = draft.text;
    this.saved = saved;
    this.working = saved ? draft.working : undefined;
    Object.defineProperty(draft, "text", {
      enumerable: true, configurable: true,
      get: () => this.text ??= this.doc.toString(),
      set: text => { this.text = text; this.doc = null; },
    });
  }

  edit(doc) { this.doc = doc; this.text = null; }

  dirty(working, normalized) {
    if (!this.doc) return this.text !== normalized;
    if (this.working !== working) {
      // Deferred: plugin startup must not initialize CodeMirror.
      const { Text } = require("@codemirror/state");
      this.saved = Text.of(normalized.split("\n"));
      this.working = working;
    }
    return !this.doc.eq(this.saved);
  }
}

module.exports = { EditorDocument };
