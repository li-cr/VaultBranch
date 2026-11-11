"use strict";

const { Notice, moment, debounce } = require("obsidian");
const { hostname } = require("node:os");
const { t } = require("./i18n.js");
const { SOURCE_VIEW, DIFF_VIEW, HISTORY_VIEW, FILE_HISTORY_VIEW, DEFAULT_SETTINGS } = require("./views/shared.js");

async function ensureReady(plugin) {
  if (plugin.ready) return;
  if (!plugin.initTask) {
    plugin.initTask = plugin.git.init().then(() => { plugin.ready = true; }).finally(() => { plugin.initTask = null; });
  }
  await plugin.initTask;
}

function scheduleRefresh(plugin) {
  if (plugin.unloaded || !plugin.sourceVisible()) { plugin.refreshSoon?.cancel(); return; }
  plugin.refreshSoon ||= debounce(() => { if (!plugin.unloaded) void plugin.refreshSource(); }, 650, true);
  plugin.refreshSoon();
}

function sourceVisible(plugin) {
  if (document.hidden) return false;
  return plugin.app.workspace.getLeavesOfType(SOURCE_VIEW).some(leaf =>
    !leaf.getRoot().collapsed && leaf.view.containerEl.isShown());
}

function updateSourceVisibility(plugin) {
  const visible = !plugin.unloaded && plugin.sourceVisible();
  const revealed = visible && !plugin.sourceWasVisible;
  plugin.sourceWasVisible = visible;
  if (revealed) void plugin.refreshSource();
  return visible;
}

function refreshSource(plugin) {
  if (plugin.unloaded || !plugin.sourceVisible()) return;
  plugin.sourceWasVisible = true;
  plugin.lastAutoRefresh = Date.now();
  return plugin.refresh();
}

async function refresh(plugin, notify = false, force = false) {
  if (plugin.unloaded || (plugin.busy && !force)) return;
  if (plugin.refreshTask) return plugin.refreshTask;
  plugin.refreshTask = (async () => {
    try {
      await plugin.ensureReady();
      plugin.status = await plugin.git.status();
      if (!plugin.busy) plugin.error = "";
    } catch (error) {
      plugin.error = error.message;
      if (notify) new Notice(error.message, 8000);
    } finally {
      plugin.renderViews();
    }
  })();
  try { await plugin.refreshTask; } finally { plugin.refreshTask = null; }
}

async function mutate(plugin, label, action) {
  if (plugin.busy || plugin.mutationPending) { new Notice(t("已有 Git 操作执行中，请稍候。")); return false; }
  plugin.mutationPending = true;
  for (const view of plugin.views(DIFF_VIEW)) view.updateEditor();
  const saved = await Promise.all([...plugin.editors.sessions.values()].map((session) => session.autoFlush()));
  plugin.mutationPending = false;
  if (saved.some((success) => !success)) {
    for (const view of plugin.views(DIFF_VIEW)) view.updateEditor();
    new Notice(t("存在未保存的差异编辑。请按 Ctrl/Cmd+S 保存，或处理保存错误后再执行 Git 操作。"), 8000);
    return false;
  }
  plugin.busy = true;
  for (const view of plugin.views(DIFF_VIEW)) view.updateEditor();
  plugin.busyLabel = label;
  plugin.error = "";
  plugin.renderViews();
  let success = false;
  try {
    await plugin.ensureReady();
    const output = await action();
    plugin.lastOutput = `${label}\n${output?.trim() || t("操作完成。")}`;
    new Notice(t`${label} 完成`);
    success = true;
  } catch (error) {
    plugin.error = error.message;
    plugin.lastOutput = t`${label} 失败\n${error.message}`;
    new Notice(t`${label} 失败：${error.message}`, 10000);
  } finally {
    // Wait for an earlier read before taking a fresh post-operation snapshot.
    if (plugin.refreshTask) await plugin.refreshTask;
    await plugin.refresh(false, true);
    plugin.busy = false;
    plugin.renderViews([SOURCE_VIEW, DIFF_VIEW, HISTORY_VIEW, FILE_HISTORY_VIEW]);
  }
  return success;
}

function runGit(plugin, method) {
  return plugin.mutate(method === "stashPop" ? t("恢复 Stash") : method[0].toUpperCase() + method.slice(1), () => plugin.git[method]());
}

function toggleStash(plugin) {
  const status = plugin.status;
  return plugin.runGit(status?.files.length ? "stash" : "stashPop");
}

async function changeStage(plugin, files, area) {
  const paths = files.flatMap((file) => file.oldPath ? [file.path, file.oldPath] : [file.path]);
  return plugin.mutate(area === "staged" ? t("取消暂存") : t("暂存"), () => area === "staged" ? plugin.git.unstage(paths) : plugin.git.stage(paths));
}

async function commit(plugin) {
  const message = plugin.commitMessage();
  if (await plugin.mutate("Commit", () => plugin.git.commit(message))) {
    plugin.draft = "";
    for (const view of plugin.views(SOURCE_VIEW)) {
      if (!view.messageEl) continue;
      view.messageEl.value = "";
      view.updateButtons();
    }
  }
}

function commitMessage(plugin, message = plugin.draft) {
  const values = { date: moment().format(plugin.settings.commitDateFormat || DEFAULT_SETTINGS.commitDateFormat), hostname: plugin.settings.hostname || hostname() };
  const prefix = plugin.settings.commitMessage.replace(/\{\{(date|hostname)\}\}/g, (_, key) => values[key]);
  return (prefix + (message || "")).trim();
}

module.exports = { ensureReady, scheduleRefresh, sourceVisible, updateSourceVisibility, refreshSource, refresh, mutate, runGit, toggleStash, changeStage, commit, commitMessage };
