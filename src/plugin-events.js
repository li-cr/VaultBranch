"use strict";

const { Notice } = require("obsidian");
const { t } = require("./i18n.js");
const { dateTriggerRange } = require("./date.js");
const { DIFF_VIEW } = require("./views/shared.js");

// All registrations belong to the host plugin, which disposes them on unload.
function registerEvents(plugin) {
  plugin.dateCommand = plugin.addCommand({ id: "insert-date", name: t("插入当前日期时间"), editorCallback: (editor) => editor.replaceSelection(plugin.formatDate()) });
  plugin.fileHistoryCommand = plugin.addCommand({ id: "file-history", name: t("查看当前文件历史"), checkCallback: checking => {
    const view = plugin.app.workspace.activeLeaf?.view;
    const path = view?.file?.path || view?.filePath;
    if (!path) return false;
    if (!checking) void plugin.openFileHistory(path).catch(error => new Notice(error.message));
    return true;
  } });
  plugin.registerEvent(plugin.app.workspace.on("file-menu", (menu, file) => {
    if (typeof file?.extension === "string") plugin.addFileHistoryMenu(menu, file.path);
  }));
  plugin.registerEvent(plugin.app.workspace.on("editor-menu", (menu, editor, view) => {
    if (view.file) plugin.addFileHistoryMenu(menu, view.file.path);
  }));
  plugin.registerDomEvent(document, "beforeinput", (event) => {
    plugin.dateInput = event.inputType === "insertText" || event.inputType === "insertCompositionText";
  }, true);
  plugin.registerEvent(plugin.app.workspace.on("editor-change", (editor, info) => {
    if (!plugin.dateInput || plugin.expandingDate || plugin.composingDate || info?.getViewType?.() !== "markdown") return;
    plugin.dateInput = false;
    window.clearTimeout(plugin.dateTimer);
    plugin.dateTimer = window.setTimeout(() => {
      if (plugin.unloaded || plugin.composingDate || plugin.app.workspace.activeLeaf?.view.editor !== editor) return;
      const range = dateTriggerRange(editor, plugin.settings.dateTrigger);
      if (!range) return;
      plugin.expandingDate = true;
      try { editor.replaceRange(plugin.formatDate(), range.from, range.to); }
      finally { plugin.expandingDate = false; }
    }, 0);
  }));
  plugin.registerDomEvent(document, "compositionstart", () => { plugin.composingDate = true; });
  plugin.registerDomEvent(document, "compositionend", () => { plugin.composingDate = false; });
  plugin.returnCommand = plugin.addCommand({ id: "return-to-graph", name: t("返回 Git Graph"), checkCallback: (checking) => {
    const context = plugin.activeGraphReturn();
    if (!context) return false;
    if (!checking) void plugin.returnToGraph(context.graphReturn);
    return true;
  } });
  plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", (leaf) => {
    for (const view of plugin.views(DIFF_VIEW)) if (view.leaf !== leaf) void view.saveEditor(true);
    plugin.updateEditorReturn(leaf);
    plugin.updateSourceVisibility();
  }));
  plugin.registerEvent(plugin.app.workspace.on("file-open", () => plugin.updateEditorReturn(plugin.app.workspace.activeLeaf)));
  plugin.registerEvent(plugin.app.workspace.on("layout-change", () => { plugin.pruneGraphReturns(); plugin.updateSourceVisibility(); }));
  plugin.registerEvent(plugin.app.workspace.on("resize", () => plugin.updateSourceVisibility()));
  plugin.registerDomEvent(document, "visibilitychange", () => plugin.updateSourceVisibility());
  const navigateBack = (event) => {
    const context = plugin.activeGraphReturn();
    if (!context) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.type !== "mousedown") void plugin.returnToGraph(context.graphReturn).catch((error) => new Notice(error.message));
  };
  for (const event of ["mousedown", "mouseup", "auxclick"]) {
    plugin.registerDomEvent(window, event, (event) => { if (event.button === 3) navigateBack(event); }, true);
  }
  plugin.registerDomEvent(window, "keydown", (event) => {
    if (event.key !== "BrowserBack" && !(event.altKey && event.key === "ArrowLeft")) return;
    navigateBack(event);
  }, true);
  for (const event of ["modify", "create", "delete", "rename"]) plugin.registerEvent(plugin.app.vault.on(event, (file, oldPath) => {
    plugin.scheduleRefresh();
    for (const path of new Set([file.path, oldPath])) void plugin.editors.sessions.get(path)?.sync();
  }));
  plugin.registerEvent(plugin.app.vault.on("raw", (path) => {
    // Hidden configuration files have no TFile and do not emit normal modify events.
    const session = plugin.editors.sessions.get(path);
    if (session && !plugin.app.vault.getAbstractFileByPath(path)) {
      plugin.scheduleRefresh();
      void session.sync();
    }
  }));
  plugin.registerDomEvent(window, "focus", () => {
    plugin.scheduleRefresh();
    for (const view of plugin.views(DIFF_VIEW)) void view.session?.sync();
  });
  plugin.registerInterval(window.setInterval(() => {
    if (plugin.updateSourceVisibility() && Date.now() - (plugin.lastAutoRefresh || 0) >= plugin.settings.refreshSeconds * 1000) void plugin.refreshSource();
  }, 1000));
  plugin.app.workspace.onLayoutReady(() => {
    if (plugin.unloaded) return;
    if (plugin.settings.openOnStartup) void plugin.openSidebar().catch((error) => new Notice(error.message));
  });
}

module.exports = { registerEvents };
