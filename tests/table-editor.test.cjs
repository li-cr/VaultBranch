"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
const { createRequire } = require("node:module");
const { EditorState, StateField } = require("@codemirror/state");
const parser = require("../src/loose-tables.js");
const table = "| A | B |\n|---|---|\n| a | b |";

function harness(text, live = true) {
  const file = path.resolve(__dirname, "../src/table-editor.js"), local = createRequire(file), scans = [], module = { exports: {} };
  const editorLivePreviewField = StateField.define({ create: () => live, update: value => value });
  const editorInfoField = StateField.define({ create: () => ({ file: { path: "test.md" } }), update: value => value });
  vm.runInNewContext(fs.readFileSync(file, "utf8"), { module, WeakMap, require(name) {
    if (name === "obsidian") return { editorLivePreviewField, editorInfoField };
    if (name === "./loose-tables.js") return { findLooseTables(text, offset) { scans.push(text.length); return parser.findLooseTables(text, offset); } };
    return local(name);
  } }, { filename: file });
  const extension = module.exports.tableEditorExtension({ settings: { renderLooseTables: true } });
  let state = EditorState.create({ doc: text, extensions: [editorLivePreviewField, editorInfoField, extension] });
  return { scans, get state() { return state; }, get value() { return state.field(extension); }, update(spec) { state = state.update(spec).state; return this.value; } };
}

test("Live Preview widgets expose source at the cursor and never activate in Source mode", () => {
  const text = "intro\n" + table + "\n\nend";
  const h = harness(text);
  assert.equal(h.value.tables.length, 1); assert.equal(h.value.decorations.size, 1);
  h.update({ selection: { anchor: text.indexOf("| A") } }); assert.equal(h.value.decorations.size, 0);
  h.update({ selection: { anchor: text.length } }); assert.equal(h.value.decorations.size, 1);
  assert.equal(harness(text, false).value.decorations.size, 0);
});

test("typing updates only the affected paragraph while table ranges follow preceding edits", () => {
  const large = ("plain text in another paragraph\n\n").repeat(40000), text = "intro\n" + table + "\n\n" + large + "last paragraph with `inline code`";
  const h = harness(text), before = h.value.tables[0].from;
  h.scans.length = 0;
  h.update({ changes: { from: 2, insert: "more" } });
  assert.equal(h.value.tables[0].from, before + 4);
  h.update({ changes: { from: h.state.doc.length, insert: "x" } });
  assert.ok(h.scans.length >= 2 && h.scans.every(size => size < 200), JSON.stringify(h.scans));
});

test("separator edits, blank lines, pastes and structural fences invalidate the appropriate tables", () => {
  const original = "intro\n" + table + "\n\nend", h = harness(original), at = original.indexOf("---");
  h.update({ changes: { from: at, to: at + 3, insert: "bad" } }); assert.equal(h.value.tables.length, 0);
  h.update({ changes: { from: at, to: at + 3, insert: "---" } }); assert.equal(h.value.tables.length, 1);
  h.update({ changes: { from: 0, insert: "```md\n" } }); assert.equal(h.value.tables.length, 0);
  h.update({ changes: { from: 0, to: 6 } }); assert.equal(h.value.tables.length, 1);
  h.update({ changes: { from: 6, insert: "\n" } }); assert.equal(h.value.tables.length, 0);
  h.update({ changes: { from: 6, to: 7 } }); assert.equal(h.value.tables.length, 1);
  h.update({ changes: { from: h.state.doc.length, insert: "\n\nnext\n" + table } }); assert.equal(h.value.tables.length, 2);
});

test("editing inside fenced code never creates widgets even in a separate inner paragraph", () => {
  const text = "```md\n\nintro\n" + table + "\n\n```\n\nend", h = harness(text);
  h.update({ changes: { from: text.indexOf("intro") + 5, insert: " edit" } });
  assert.equal(h.value.tables.length, 0);
});
