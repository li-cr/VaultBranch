"use strict";

const { MergeView } = require("@codemirror/merge");
const { EditorState } = require("@codemirror/state");
const { EditorView, lineNumbers, drawSelection } = require("@codemirror/view");
const { normalize } = require("../autosave.js");
const { el } = require("./shared.js");

function collapseOptions(settings) {
  return { collapseUnchanged: settings.collapseUnchanged ? {} : undefined };
}

function updateCollapse(view) {
  const enabled = Boolean(view.plugin.settings.collapseUnchanged);
  if (view.merge && view.collapseEnabled !== enabled) {
    view.merge.reconfigure(collapseOptions(view.plugin.settings));
    view.collapseEnabled = enabled;
  }
}

function readOnlyMerge(body, versions, captions, settings) {
  body.classList.add("has-editor");
  const labels = el(body, "div", "vaultbranch-diff-captions");
  for (const caption of captions) el(labels, "span", "", caption);
  const panes = el(body, "div", "vaultbranch-edit-panes");
  const extensions = [lineNumbers(), drawSelection(), EditorState.tabSize.of(4), EditorState.readOnly.of(true), EditorView.editable.of(false)];
  const merge = new MergeView({
    parent: panes, root: body.ownerDocument,
    a: { doc: normalize(versions.left), extensions }, b: { doc: normalize(versions.right), extensions },
    highlightChanges: true, gutter: true, ...collapseOptions(settings),
  });
  merge.a.contentDOM.setAttribute("aria-label", captions[0]);
  merge.b.contentDOM.setAttribute("aria-label", captions[1]);
  return merge;
}

module.exports = { collapseOptions, updateCollapse, readOnlyMerge };
