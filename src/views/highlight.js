"use strict";

const { Compartment, StateEffect } = require("@codemirror/state");

const MAX_HIGHLIGHT_LENGTH = 200000, MAX_HIGHLIGHT_LINE = 10000;
const documentLimits = new WeakMap();

function languageForPath(filePath) {
  if (/\.json$/i.test(filePath)) return "json";
  if (/\.(md|markdown)$/i.test(filePath)) return "markdown";
  return "";
}

function highlightable(doc) {
  if (documentLimits.has(doc)) return documentLimits.get(doc);
  if (doc.length > MAX_HIGHLIGHT_LENGTH) return false;
  for (const line of doc.iterLines()) if (line.length > MAX_HIGHLIGHT_LINE) { documentLimits.set(doc, false); return false; }
  documentLimits.set(doc, true);
  return true;
}

// No language/parser initialization occurs until a supported view opts in.
const extensions = new Map();
function loadHighlight(language) {
  if (!extensions.has(language)) extensions.set(language, Promise.resolve().then(() => {
    const { HighlightStyle, syntaxHighlighting, Language, defineLanguageFacet, languageDataProp } = require("@codemirror/language");
    const { tags } = require("@lezer/highlight");
    const style = HighlightStyle.define([
      { tag: tags.propertyName, class: "vb-syntax-property" },
      { tag: tags.string, class: "vb-syntax-string" },
      { tag: [tags.number, tags.bool, tags.null], class: "vb-syntax-number" },
      { tag: tags.heading, class: "vb-syntax-heading" },
      { tag: tags.emphasis, class: "vb-syntax-emphasis" },
      { tag: tags.strong, class: "vb-syntax-strong" },
      { tag: [tags.link, tags.url], class: "vb-syntax-link" },
      { tag: [tags.monospace, tags.processingInstruction], class: "vb-syntax-code" },
      { tag: tags.meta, class: "vb-syntax-meta" },
    ]);
    let syntax;
    if (language === "json") syntax = require("@codemirror/lang-json").jsonLanguage;
    else {
      const { parser, GFM } = require("@lezer/markdown");
      const data = defineLanguageFacet();
      syntax = new Language(data, parser.configure([GFM, { props: [languageDataProp.add({ Document: data })] }]), [], "markdown");
    }
    return [syntax, syntaxHighlighting(style)];
  }).catch(() => { extensions.delete(language); return []; }));
  return extensions.get(language);
}

function updateSyntaxHighlight(view) {
  const merge = view.merge;
  if (!merge) return Promise.resolve();
  if (!merge.vaultbranchHighlight && !view.plugin.settings.syntaxHighlighting) return Promise.resolve();
  if (!merge.vaultbranchHighlight) {
    const a = new Compartment(), b = new Compartment();
    merge.vaultbranchHighlight = { a, b, mode: "", request: 0 };
    merge.a.dispatch({ effects: StateEffect.appendConfig.of(a.of([])) });
    merge.b.dispatch({ effects: StateEffect.appendConfig.of(b.of([])) });
  }
  const state = merge.vaultbranchHighlight;
  const mode = view.plugin.settings.syntaxHighlighting && languageForPath(view.highlightPath || view.file?.path || view.filePath);
  const desired = mode && highlightable(merge.a.state.doc) && highlightable(merge.b.state.doc) ? mode : "";
  if (state.mode === desired) return state.task || Promise.resolve();
  state.mode = desired;
  const request = ++state.request;
  const apply = extension => {
    if (view.merge !== merge || state.request !== request) return;
    merge.a.dispatch({ effects: state.a.reconfigure(extension) });
    merge.b.dispatch({ effects: state.b.reconfigure(extension) });
  };
  // Session notifications can run inside a CodeMirror update listener. Wait
  // until that transaction completes before dispatching configuration effects.
  if (!desired) return state.task = Promise.resolve().then(() => apply([]));
  return state.task = loadHighlight(desired).then(apply);
}

module.exports = { updateSyntaxHighlight, languageForPath, highlightable, MAX_HIGHLIGHT_LENGTH, MAX_HIGHLIGHT_LINE };
