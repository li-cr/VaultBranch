"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { EditorState, Text } = require("@codemirror/state");
const { history, undo, undoDepth } = require("@codemirror/commands");
const { syntaxTree, language } = require("@codemirror/language");
const source = path.resolve(__dirname, "../src/views/highlight.js");

function harness() {
  const loaded = [], module = { exports: {} }, localRequire = createRequire(source);
  vm.runInNewContext(fs.readFileSync(source, "utf8"), {
    module, require(name) { loaded.push(name); return localRequire(name); },
  }, { filename: source });
  const editor = doc => ({
    state: EditorState.create({ doc, extensions: [history()] }), dispatches: 0,
    dispatch(spec) { this.state = this.state.update(spec).state; this.dispatches++; },
  });
  const view = { file: { path: "file.json" }, plugin: { settings: { syntaxHighlighting: false } }, merge: { a: editor('{"key":1}'), b: editor('{"key":2}') } };
  return { ...module.exports, loaded, view };
}

test("highlighting defaults off and does not load parsers or reconfigure editors", async () => {
  const h = harness();
  assert.equal(require("../default-settings.json").syntaxHighlighting, false);
  await h.updateSyntaxHighlight(h.view);
  assert.deepEqual(h.loaded, ["@codemirror/state"]);
  assert.equal(h.view.merge.a.dispatches + h.view.merge.b.dispatches, 0);
});

test("only JSON and Markdown extensions opt in, including hidden paths and uppercase", () => {
  const h = harness();
  for (const file of ["a.json", ".obsidian/settings.JSON"]) assert.equal(h.languageForPath(file), "json");
  for (const file of ["a.md", "a.MARKDOWN"]) assert.equal(h.languageForPath(file), "markdown");
  for (const file of ["a.js", "a.py", "a.html", "a.txt", "a.json.txt", "json"]) assert.equal(h.languageForPath(file), "");
});

test("unsupported extensions and oversized documents never initialize language modules", async () => {
  const h = harness(); h.view.plugin.settings.syntaxHighlighting = true;
  h.view.file.path = "file.js"; await h.updateSyntaxHighlight(h.view);
  h.view.file.path = "file.json";
  h.view.merge.b.state = EditorState.create({ doc: "x".repeat(10001) });
  await h.updateSyntaxHighlight(h.view);
  assert.deepEqual(h.loaded, ["@codemirror/state"]);
});

test("document limits accept boundaries and check every line without converting the whole text", () => {
  const h = harness(), text = lines => Text.of(lines);
  assert.equal(h.highlightable(text(["x".repeat(10000)])), true);
  assert.equal(h.highlightable(text(["ok", "x".repeat(10001)])), false);
  assert.equal(h.highlightable(text(Array(20).fill("x".repeat(9999)).concat(["x"]))), false);
  assert.equal(h.highlightable(text(Array(20).fill("x".repeat(9999)))) , true);
});

test("JSON uses the native language parser while toggling preserves drafts, selection and undo", async () => {
  const h = harness(), v = h.view, merge = v.merge;
  merge.b.dispatch({ changes: { from: 7, to: 8, insert: "42" }, selection: { anchor: 8 } });
  const doc = merge.b.state.doc, selection = merge.b.state.selection, depth = undoDepth(merge.b.state);
  v.plugin.settings.syntaxHighlighting = true; await h.updateSyntaxHighlight(v);
  assert.equal(merge.b.state.facet(language).name, "json");
  assert.match(syntaxTree(merge.b.state).toString(), /PropertyName/);
  v.plugin.settings.syntaxHighlighting = false; await h.updateSyntaxHighlight(v);
  assert.equal(merge.b.state.facet(language), null);
  assert.equal(merge.b.state.doc, doc);
  assert.equal(merge.b.state.selection, selection);
  assert.equal(undoDepth(merge.b.state), depth);
  undo({ state: merge.b.state, dispatch: spec => merge.b.dispatch(spec) });
  assert.equal(merge.b.state.doc.toString(), '{"key":2}');
});

test("Markdown parses GFM source without loading other language packages", async () => {
  const h = harness(), v = h.view;
  v.file.path = "note.md"; v.plugin.settings.syntaxHighlighting = true;
  v.merge.b.state = EditorState.create({ doc: "# Heading\n\n**bold** and `code`\n\n- [x] task\n" });
  await h.updateSyntaxHighlight(v);
  assert.equal(v.merge.b.state.facet(language).name, "markdown");
  assert.match(syntaxTree(v.merge.b.state).toString(), /ATXHeading1/);
  assert.match(syntaxTree(v.merge.b.state).toString(), /Task/);
  assert.equal(h.loaded.some(name => /lang-(json|javascript|html|python|markdown)/.test(name)), false);
});

test("disabling, switching path or closing while loading ignores stale language results", async () => {
  for (const action of ["disable", "switch", "close"]) {
    const h = harness(), v = h.view, merge = v.merge;
    v.plugin.settings.syntaxHighlighting = true;
    const pending = h.updateSyntaxHighlight(v);
    if (action === "disable") v.plugin.settings.syntaxHighlighting = false;
    if (action === "switch") v.file.path = "other.md";
    if (action === "close") v.merge = null;
    await h.updateSyntaxHighlight(v); await pending;
    assert.equal(merge.b.state.facet(language)?.name || "", action === "switch" ? "markdown" : "");
  }
});

test("crossing the line limit disables highlighting and undoing the edit restores it", async () => {
  const h = harness(), v = h.view; v.plugin.settings.syntaxHighlighting = true;
  await h.updateSyntaxHighlight(v);
  v.merge.b.dispatch({ changes: { from: 0, insert: "x".repeat(10001) } });
  await h.updateSyntaxHighlight(v);
  assert.equal(v.merge.b.state.facet(language), null);
  undo({ state: v.merge.b.state, dispatch: spec => v.merge.b.dispatch(spec) });
  await h.updateSyntaxHighlight(v);
  assert.equal(v.merge.b.state.facet(language).name, "json");
  assert.equal(h.loaded.filter(name => name === "@codemirror/lang-json").length, 1);
});

test("file history chooses the historical extension after a rename", async () => {
  const h = harness(), v = h.view;
  v.file.path = "renamed.txt"; v.highlightPath = "original.json";
  v.plugin.settings.syntaxHighlighting = true;
  await h.updateSyntaxHighlight(v);
  assert.equal(v.merge.b.state.facet(language).name, "json");
});
