"use strict";

// The host owns registration cleanup. Disabled startup does not touch editors
// or register a postprocessor that would refresh existing Reading views.
function initializeTables(plugin) {
  plugin.tableExtensions = [];
  plugin.tableProcessor = (el, context) => {
    if (plugin.unloaded || !plugin.settings.renderLooseTables || !el.classList.contains("el-p") || el.childElementCount !== 1) return;
    const paragraph = el.firstElementChild;
    if (paragraph?.tagName !== "P" || !/\n[| :\t-]*-[| :\t-]*(?:\n|$)/.test(paragraph.textContent)) return;
    return require("./loose-tables.js").renderReadingTable(plugin, el, context);
  };
  if (plugin.settings.renderLooseTables) updateTables(plugin);
}

function updateTables(plugin) {
  plugin.tableExtensions.length = 0;
  if (plugin.settings.renderLooseTables) plugin.tableExtensions.push(require("./table-editor.js").tableEditorExtension(plugin));
  if (!plugin.tablesRegistered) {
    if (!plugin.settings.renderLooseTables) return;
    plugin.registerEditorExtension(plugin.tableExtensions);
    plugin.registerMarkdownPostProcessor(plugin.tableProcessor);
    plugin.tablesRegistered = true;
    return; // Registration already notifies open editors and Reading views.
  }
  plugin.app.workspace.updateOptions();
  for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) if (leaf.view.getMode?.() === "preview") leaf.view.previewMode.rerender(true);
}

module.exports = { initializeTables, updateTables };
