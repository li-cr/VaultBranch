"use strict";

const { MergeView, goToPreviousChunk, goToNextChunk } = require("@codemirror/merge");
const { EditorState } = require("@codemirror/state");
const { EditorView, lineNumbers, drawSelection } = require("@codemirror/view");
const { normalize } = require("../autosave.js");
const { el, button } = require("./shared.js");
const { t } = require("../i18n.js");

function updateDiffNavigation(view) {
  const header = view.contentEl.querySelector(".vaultbranch-diff-header");
  if (!header) return;
  let controls = header.querySelector(".vaultbranch-diff-navigation");
  if (!view.merge || !view.plugin.settings.showDiffNavigation) { controls?.remove(); return; }
  if (!controls) {
    controls = el(header, "div", "vaultbranch-diff-navigation");
    for (const [icon, name, command] of [["arrow-up", "上一处差异", goToPreviousChunk], ["arrow-down", "下一处差异", goToNextChunk]]) {
      const control = button(controls, icon, t(name), () => {
        const merge = view.merge;
        if (!merge) return;
        const editor = merge.a.hasFocus ? merge.a : merge.b;
        command(editor);
        editor.focus();
      });
      control.dataset.label = name;
      // Keep the active pane's selection when clicking a toolbar button.
      control.addEventListener("mousedown", event => { if (event.button === 0) event.preventDefault(); });
    }
  }
  for (const control of controls.children) {
    control.title = t(control.dataset.label);
    control.setAttribute("aria-label", control.title);
    control.disabled = !view.merge.chunks.length;
  }
}

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

module.exports = { collapseOptions, updateCollapse, readOnlyMerge, updateDiffNavigation };
