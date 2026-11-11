"use strict";

const { Notice } = require("obsidian");
const { t } = require("./i18n.js");
const { SOURCE_VIEW, DIFF_VIEW, HISTORY_VIEW, FILE_HISTORY_VIEW, button } = require("./views/shared.js");

async function openView(plugin, type, state, leaf) {
  const workspace = plugin.app.workspace;
  leaf ||= workspace.getLeavesOfType(type)[0];
  const existing = Boolean(leaf);
  leaf ||= type === SOURCE_VIEW ? workspace.getRightLeaf(false) : workspace.getLeaf("tab");
  if (!leaf) throw new Error(t("无法创建 Git 视图。"));
  if (!existing || state !== undefined) await leaf.setViewState({ type, active: true, state });
  await leaf.loadIfDeferred?.();
  await workspace.revealLeaf(leaf);
  return leaf;
}

function openFileHistory(plugin, filePath) {
  const open = () => plugin.openView(FILE_HISTORY_VIEW, { filePath });
  plugin.fileHistoryNavigation = (plugin.fileHistoryNavigation || Promise.resolve()).then(open, open);
  return plugin.fileHistoryNavigation;
}

async function diffLeaf(plugin) {
  if (plugin.diffLeafTask) return plugin.diffLeafTask;
  const leaf = plugin.app.workspace.getLeavesOfType(DIFF_VIEW)[0];
  if (leaf && plugin.isView(leaf.view, DIFF_VIEW)) return leaf;
  // Only native view creation is shared; file reads must not queue behind it.
  const task = plugin.diffLeafTask = plugin.openView(DIFF_VIEW);
  try { return await task; }
  finally { if (plugin.diffLeafTask === task) plugin.diffLeafTask = null; }
}

async function openDiff(plugin, file, area, graphReturn = null, timing = plugin.startDiffTiming(file, area)) {
  if (area === "history" && !graphReturn) {
    const graph = plugin.app.workspace.getLeavesOfType(HISTORY_VIEW).find(item => plugin.isView(item.view, HISTORY_VIEW));
    graphReturn = graph?.view.captureNavigation() || null;
  }
  const request = plugin.diffNavigationRequest = (plugin.diffNavigationRequest || 0) + 1;
  const open = async () => {
    try {
      const leaf = await plugin.diffLeaf();
      timing?.mark("queueMs");
      if (plugin.unloaded || request !== plugin.diffNavigationRequest || !plugin.isView(leaf.view, DIFF_VIEW)) {
        timing?.mark("cancelledMs"); timing?.finish("cancelled"); return leaf;
      }
      const view = leaf.view;
      // Existing views guard overlapping setState calls with request IDs.
      // Calling native setViewState concurrently would silently drop clicks.
      await view.setState({ file, area, graphReturn, timing }, {});
      if (request === plugin.diffNavigationRequest && leaf.view === view) {
        leaf.updateHeader(); plugin.app.workspace.requestSaveLayout();
        await plugin.app.workspace.revealLeaf(leaf);
      } else timing?.mark("cancelledMs");
      timing?.finish(timing.record.cancelledMs !== undefined ? "cancelled" : timing.record.errorMs !== undefined ? "failed" : "complete");
      return leaf;
    }
    catch (error) { timing?.finish("failed"); throw error; }
  };
  plugin.diffNavigationTask = open();
  return plugin.diffNavigationTask;
}

async function openFile(plugin, filePath, graphReturn = null) {
  const file = plugin.app.vault.getAbstractFileByPath(filePath);
  if (file && typeof file.extension === "string") {
    const leaf = plugin.app.workspace.getLeavesOfType("markdown").find((item) => item.view.file?.path === filePath) || plugin.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    if (graphReturn) plugin.setGraphReturn(leaf, filePath, graphReturn);
    await plugin.app.workspace.revealLeaf(leaf);
  }
  else new Notice(t("文件已删除，或属于 Obsidian 不显示的隐藏配置文件；请使用差异视图查看。"));
}

function setGraphReturn(plugin, leaf, filePath, graphReturn) {
  if (graphReturn) plugin.graphReturns.set(leaf.id, { filePath, graphReturn });
  else plugin.graphReturns.delete(leaf.id);
  plugin.updateEditorReturn(leaf);
}

function pruneGraphReturns(plugin) {
  if (!plugin.graphReturns.size) return;
  const leaves = new Set();
  // A truthy callback return stops traversal of the current workspace branch.
  plugin.app.workspace.iterateAllLeaves((leaf) => { leaves.add(leaf.id); });
  for (const id of plugin.graphReturns.keys()) if (!leaves.has(id)) plugin.graphReturns.delete(id);
}

function activeGraphReturn(plugin) {
  const leaf = plugin.app.workspace.activeLeaf;
  const context = leaf && plugin.graphReturns.get(leaf.id);
  if (!context) return null;
  if (plugin.isView(leaf.view, DIFF_VIEW) && leaf.view.area === "history" && leaf.view.file?.path === context.filePath) return context;
  if (leaf.view.getViewType() === "markdown" && leaf.view.file?.path === context.filePath) return context;
  return null;
}

function updateEditorReturn(plugin, leaf) {
  if (!leaf?.view) return;
  const root = leaf.view.containerEl;
  root.querySelectorAll(".vaultbranch-editor-return").forEach((node) => node.remove());
  if (leaf.view.getViewType() !== "markdown") return;
  const context = plugin.graphReturns.get(leaf.id);
  if (!context) return;
  if (leaf.view.file?.path !== context.filePath) { plugin.graphReturns.delete(leaf.id); return; }
  const actions = root.querySelector(".view-actions") || root;
  const back = button(actions, "arrow-left", t("返回 Git Graph"), () => plugin.returnToGraph(context.graphReturn), "Git Graph");
  back.classList.add("vaultbranch-editor-return");
  if (actions === root) back.classList.add("is-floating");
}

async function returnToGraph(plugin, context) {
  if (plugin.returningToGraph) return;
  if (!context) { await plugin.openHistory(); return; }
  plugin.returningToGraph = true;
  try {
    const preferred = plugin.app.workspace.getLeavesOfType(HISTORY_VIEW).find((item) => item.id === context.leafId);
    const leaf = await plugin.openView(HISTORY_VIEW, context.state, preferred);
    // Background Electron windows may suspend animation frames; returning must still finish.
    await new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 60);
      requestAnimationFrame(() => { window.clearTimeout(timer); resolve(); });
    });
    if (plugin.isView(leaf.view, HISTORY_VIEW)) {
      if (leaf.view.bodyEl) { leaf.view.bodyEl.scrollTop = context.scrollTop || 0; leaf.view.bodyEl.scrollLeft = context.scrollLeft || 0; }
      if (leaf.view.detailsEl) leaf.view.detailsEl.scrollTop = context.detailTop || 0;
    }
  } finally { plugin.returningToGraph = false; }
}

module.exports = { openView, openFileHistory, diffLeaf, openDiff, openFile, setGraphReturn, pruneGraphReturns, activeGraphReturn, updateEditorReturn, returnToGraph };
