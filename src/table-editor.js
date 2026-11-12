"use strict";

const { StateField } = require("@codemirror/state");
const { Decoration, EditorView, WidgetType } = require("@codemirror/view");
const { MarkdownRenderer, MarkdownRenderChild, editorLivePreviewField, editorInfoField } = require("obsidian");
const { findLooseTables } = require("./loose-tables.js");
const { t } = require("./i18n.js");

const children = new WeakMap();
class TableWidget extends WidgetType {
  constructor(plugin, markdown, sourcePath) { super(); this.plugin = plugin; this.markdown = markdown; this.sourcePath = sourcePath; }
  eq(other) { return this.markdown === other.markdown && this.sourcePath === other.sourcePath; }
  toDOM(view) {
    const root = view.dom.ownerDocument.createElement("div");
    root.className = "vaultbranch-loose-table markdown-rendered";
    root.title = t("点击表格编辑源码");
    const component = new MarkdownRenderChild(root);
    component.load(); children.set(root, component);
    void MarkdownRenderer.render(this.plugin.app, this.markdown, root, this.sourcePath, component).catch(() => { if (children.has(root)) root.textContent = this.markdown; });
    root.addEventListener("mousedown", event => {
      if (event.button !== 0 || event.target.closest("a, button, input")) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(root) }, scrollIntoView: true }); view.focus();
    });
    return root;
  }
  destroy(root) { children.get(root)?.unload(); children.delete(root); }
}

function paragraph(doc, from, to) {
  let first = doc.lineAt(from).number, last = doc.lineAt(to).number;
  while (first > 1 && doc.line(first - 1).text.trim()) first--;
  while (last < doc.lines && doc.line(last + 1).text.trim()) last++;
  return { from: doc.line(first).from, to: doc.line(last).to };
}

function updatedTables(value, transaction) {
  const ranges = [];
  let structural = false;
  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const before = transaction.startState.doc, after = transaction.state.doc;
    const old = before.sliceString(before.lineAt(fromA).from, before.lineAt(toA).to);
    const text = after.sliceString(after.lineAt(fromB).from, after.lineAt(toB).to);
    const markers = source => (source.match(/`+|~{3,}|%%|<!--|-->|\$\$/g) || []).join("|") + ":" + (source.match(/^ {0,3}(?:`{3,}|~{3,}|---\s*$|<[^\n]*)/gm) || []).join("|");
    structural ||= markers(old) !== markers(text) || (old.includes("\n") || text.includes("\n")) && value.blocked.some(region => region.kind === "html" && region.from <= toA && region.to >= fromA);
    ranges.push(paragraph(after, fromB, toB));
  });
  if (structural) return findLooseTables(transaction.state.doc.toString());
  const map = range => ({ ...range, from: transaction.changes.mapPos(range.from, 1), to: transaction.changes.mapPos(range.to, -1) });
  const blocked = value.blocked.map(map), overlap = (a, b) => a.from <= b.to && a.to >= b.from;
  const merged = [];
  for (const range of ranges.sort((a, b) => a.from - b.from)) {
    if (merged.length && overlap(merged.at(-1), range)) merged.at(-1).to = Math.max(merged.at(-1).to, range.to);
    else merged.push(range);
  }
  const tables = value.tables.map(map).filter(table => !merged.some(range => overlap(table, range)));
  for (const range of merged) {
    const found = findLooseTables(transaction.state.doc.sliceString(range.from, range.to), range.from);
    tables.push(...found.tables.filter(table => !blocked.some(region => overlap(table, region))));
  }
  return { tables: tables.sort((a, b) => a.from - b.from), blocked };
}

function tableEditorExtension(plugin) {
  const build = (state, parsed) => {
    const sourcePath = state.field(editorInfoField, false)?.file?.path || "";
    const ranges = parsed.tables.filter(table => !state.selection.ranges.some(selection => selection.from <= table.to && selection.to >= table.from))
      .map(table => Decoration.replace({ block: true, widget: new TableWidget(plugin, table.markdown, sourcePath) }).range(table.from, table.to));
    return { ...parsed, active: true, decorations: Decoration.set(ranges, true) };
  };
  const empty = () => ({ tables: [], blocked: [], active: false, decorations: Decoration.none });
  return StateField.define({
    create(state) { return plugin.settings.renderLooseTables && state.field(editorLivePreviewField, false) ? build(state, findLooseTables(state.doc.toString())) : empty(); },
    update(value, transaction) {
      const state = transaction.state;
      if (!plugin.settings.renderLooseTables || !state.field(editorLivePreviewField, false)) return value.active ? empty() : value;
      if (!value.active) return build(state, findLooseTables(state.doc.toString()));
      if (transaction.docChanged) return build(state, updatedTables(value, transaction));
      return transaction.selection ? build(state, value) : value;
    },
    provide: field => EditorView.decorations.from(field, value => value.decorations),
  });
}

module.exports = { tableEditorExtension };
