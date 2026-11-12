"use strict";

const { Plugin, Notice, setIcon, Platform, Modal, moment } = require("obsidian");
const { t, setLanguage } = require("./i18n.js");
const { EditorSessions } = require("./editor-sessions.js");
const { registerEvents } = require("./plugin-events.js");
const navigation = require("./navigation.js");
const operations = require("./git-operations.js");
const { TimingLog, timingLimit } = require("./timing.js");
const { SOURCE_VIEW, DIFF_VIEW, HISTORY_VIEW, CONFLICT_VIEW, FILE_HISTORY_VIEW, DEFAULT_SETTINGS, el, button } = require("./views/shared.js");
const { MyGitSettings } = require("./settings.js");

// Obsidian view factories are synchronous. Load each implementation only when
// its first leaf is created, including restored workspace leaves.
const VIEW_LOADERS = {
  [SOURCE_VIEW]: () => require("./views/source.js").SourceControlView,
  [DIFF_VIEW]: () => require("./views/diff.js").DiffView,
  [HISTORY_VIEW]: () => require("./views/history.js").HistoryView,
  [CONFLICT_VIEW]: () => require("./views/conflict.js").ConflictView,
  [FILE_HISTORY_VIEW]: () => require("./views/file-history.js").FileHistoryView,
};

module.exports = class MyGitPlugin extends Plugin {
  async onload() {
    if (Platform.isMobile) { new Notice(t("VaultBranch 当前只支持桌面端。")); return; }
    const savedSettings = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
    if (!["en", "zh"].includes(this.settings.language)) this.settings.language = DEFAULT_SETTINGS.language;
    setLanguage(this.settings.language);
    // Apply new defaults in memory; persist them with the next preference change.
    this.configureGit();
    this.status = null;
    this.ready = false;
    this.busy = false;
    this.unloaded = false;
    this.error = "";
    this.lastOutput = "";
    this.draft = "";
    this.graphReturns = new Map();
    this.editors = this.createEditorSessions();
    this.viewClasses = {};
    for (const [type, load] of Object.entries(VIEW_LOADERS)) this.registerView(type, leaf => {
      const View = this.viewClasses[type] ||= load();
      return new View(leaf, this);
    });
    this.addSettingTab(new MyGitSettings(this.app, this));
    this.ribbonEl = this.addRibbonIcon("git-branch", t("VaultBranch · 源代码管理"), () => this.openSidebar());
    this.localizedCommands = this.commandDefinitions().map(([id, name, callback]) => this.addCommand({ id, name: t(name), callback }));
    registerEvents(this);
  }

  onunload() {
    this.unloaded = true;
    if (this.settings?.renderLooseTables) for (const leaf of this.app.workspace.getLeavesOfType("markdown")) if (leaf.view.getMode?.() === "preview") leaf.view.previewMode?.rerender(true);
    this.timingLog?.clear();
    this.refreshSoon?.cancel();
    window.clearTimeout(this.dateTimer);
    document.querySelectorAll(".vaultbranch-editor-return").forEach((node) => node.remove());
    this.graphReturns?.clear();
    for (const view of this.views(DIFF_VIEW)) {
      view.stateRequest++; view.request++;
      view.destroyEditor();
    }
    for (const view of this.views(FILE_HISTORY_VIEW)) { view.request++; view.detailRequest++; view.destroyMerge(); }
    this.editors.stop();
  }

  configureGit() {
    const { GitService } = require("./git.js");
    this.git = new GitService(this.app.vault.adapter.getBasePath(), { binary: this.settings.gitPath || "git", pullMethod: this.settings.pullMethod, settingsPath: `${this.manifest.dir}/data.json` });
    this.ready = false;
  }

  commandDefinitions() {
    return [
      ["open-source-control", "打开源代码管理侧栏", () => this.openSidebar()],
      ["refresh", "刷新 Git 状态", () => this.refresh(true)],
      ["commit-staged", "提交暂存区", () => this.openSidebar()],
      ["pull-rebase", "Pull (rebase)", () => this.runGit("pull")],
      ["push", "Push", () => this.runGit("push")],
      ["history", "查看提交历史 / 分支图", () => this.openHistory()],
      ["fetch", "Fetch", () => this.runGit("fetch")],
      ["stash", "Stash：收起当前修改（含未跟踪文件）", () => this.runGit("stash")],
      ["stash-pop", "恢复最近一次 Stash", () => this.runGit("stashPop")],
    ];
  }

  async applyLanguage() {
    setLanguage(this.settings.language);
    const names = this.commandDefinitions();
    this.localizedCommands.forEach((command, index) => { command.name = `${this.manifest.name}: ${t(names[index][1])}`; });
    this.returnCommand.name = `${this.manifest.name}: ${t("返回 Git Graph")}`;
    this.dateCommand.name = `${this.manifest.name}: ${t("插入当前日期时间")}`;
    this.fileHistoryCommand.name = `${this.manifest.name}: ${t("查看当前文件历史")}`;
    this.ribbonEl.setAttribute("aria-label", t("VaultBranch · 源代码管理"));
    for (const view of this.views(...Object.keys(VIEW_LOADERS))) {
      if (view.getViewType() === SOURCE_VIEW) await view.onOpen();
      else if (view.getViewType() === CONFLICT_VIEW) await view.render({ preserveDraft: true });
      else await view.render();
      view.leaf.updateHeader?.();
    }
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) this.updateEditorReturn(leaf);
  }

  async updateSetting(key, value) {
    if (this.busy) { new Notice(t("Git 操作执行中，请稍后修改设置。")); return false; }
    if (key === "performanceLogLimit") value = timingLimit(value);
    if (this.settings[key] === value) return true;
    this.settings[key] = value;
    if (key === "performanceLogging" && !value) this.timingLog?.clear();
    if (key === "performanceLogLimit") this.timingLog?.setLimit(value);
    if (key === "renderLooseTables") {
      this.tableExtensions.length = 0;
      if (value) this.tableExtensions.push(require("./table-editor.js").tableEditorExtension(this));
      this.app.workspace.updateOptions();
      for (const leaf of this.app.workspace.getLeavesOfType("markdown")) if (leaf.view.getMode?.() === "preview") leaf.view.previewMode.rerender(true);
      return true;
    }
    await this.saveData(this.settings);
    if (key === "performanceLogging" || key === "performanceLogLimit") return true;
    if (key === "diffAutosave") for (const session of this.editors.sessions.values()) session.setEnabled(value);
    if (key === "collapseUnchanged") for (const view of this.views(DIFF_VIEW, FILE_HISTORY_VIEW)) view.updateCollapse();
    if (key === "showDiffNavigation") for (const view of this.views(DIFF_VIEW, FILE_HISTORY_VIEW)) view.updateDiffNavigation();
    if (key === "syntaxHighlighting") await Promise.all(this.views(DIFF_VIEW, FILE_HISTORY_VIEW).map(view => view.updateSyntaxHighlight()));
    if (key === "language") await this.applyLanguage();
    if (key === "gitPath" || key === "pullMethod") {
      if (this.refreshTask) await this.refreshTask;
      this.configureGit();
      await this.refresh();
    } else {
      this.renderViews();
    }
    return true;
  }

  openSettings() {
    this.app.setting.open(); this.app.setting.openTabById(this.manifest.id);
  }

  formatDate() { return moment().format(this.settings.dateFormat || DEFAULT_SETTINGS.dateFormat); }

  showOutput() {
    const modal = new Modal(this.app);
    modal.titleEl.textContent = t("VaultBranch · 操作输出");
    el(modal.contentEl, "pre", "vaultbranch-log", this.lastOutput || t("尚无操作。")); modal.open();
  }

  startDiffTiming(file, area, event) {
    if (!this.settings?.performanceLogging) return;
    this.timingLog ||= new TimingLog(this.settings.performanceLogLimit);
    const delay = event ? performance.now() - event.timeStamp : 0;
    return this.timingLog.start({ operation: "open-diff", path: file.path, area, source: event ? "sidebar" : "command", trusted: event?.isTrusted ?? false, inputDelayMs: delay >= 0 && delay < 60000 ? Math.round(delay * 100) / 100 : null });
  }

  timingReport() {
    return JSON.stringify({ schema: 1, version: this.manifest.version, userAgent: navigator.userAgent, units: "ms", limit: timingLimit(this.settings.performanceLogLimit), note: "Limit 0 means unlimited for this run. Stages may overlap. Frame callbacks do not guarantee physical paint.", records: this.timingLog?.records || [] }, null, 2);
  }

  showTimings() {
    const modal = new Modal(this.app);
    modal.modalEl.addClass("vaultbranch-timings");
    modal.titleEl.textContent = t("调优记录");
    const output = el(modal.contentEl, "textarea", "vaultbranch-timing-editor");
    output.value = this.timingReport(); output.spellcheck = false; output.wrap = "off";
    output.setAttribute("aria-label", t("调优记录"));
    button(modal.contentEl, "copy", t("复制记录"), async () => { await navigator.clipboard.writeText(output.value); new Notice(t("已复制调优记录。")); }, t("复制记录"));
    button(modal.contentEl, "trash-2", t("清空记录"), () => { this.timingLog?.clear(); output.value = this.timingReport(); }, t("清空记录"));
    modal.open();
    output.focus();
  }

  confirmAbort() {
    const modal = new Modal(this.app);
    modal.titleEl.textContent = t("中止当前 Git 操作？");
    el(modal.contentEl, "p", "", t("回到本次 Pull / rebase / merge 开始前的状态；当前冲突解决结果会被放弃。"));
    button(modal.contentEl, "x", t("取消"), () => modal.close(), t("取消"));
    button(modal.contentEl, "undo-2", t("确认中止"), () => { modal.close(); return this.mutate(t("中止"), () => this.git.abortOperation()); }, t("中止操作"));
    modal.open();
  }

  confirmDiscard(file) {
    const modal = new Modal(this.app);
    modal.modalEl.addClass("vaultbranch-confirm");
    modal.titleEl.textContent = file.untracked ? t("移入回收站") : t("撤销更改");
    const card = el(modal.contentEl, "div", "vaultbranch-confirm-file");
    setIcon(el(card, "span", "vaultbranch-confirm-file-icon"), "file-text");
    const details = el(card, "div", "vaultbranch-confirm-file-details");
    const name = el(details, "div", "vaultbranch-confirm-file-name", file.path.split("/").at(-1));
    name.title = file.path;
    const directory = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    if (directory) el(details, "div", "vaultbranch-confirm-file-directory", directory);
    el(modal.contentEl, "p", "vaultbranch-confirm-description", file.untracked
      ? t("此文件尚未被 Git 跟踪，将移入回收站。")
      : t("丢弃此文件未暂存的改动，保留已暂存内容。"));
    el(modal.contentEl, "p", "vaultbranch-confirm-hint", file.untracked
      ? t("可从笔记库的 .trash 文件夹恢复。")
      : t("未暂存的改动无法通过 Git 恢复。"));
    const actions = el(modal.contentEl, "div", "vaultbranch-confirm-actions");
    const cancel = button(actions, null, t("取消"), () => modal.close(), t("取消"));
    const label = file.untracked ? t("移入回收站") : t("撤销更改");
    const confirm = button(actions, null, label, () => {
      modal.close();
      return this.mutate(t("撤销更改"), async () => {
        if (!file.untracked) return this.git.discard(file.path);
        this.git.checkPaths([file.path]);
        const status = await this.git.status();
        this.git.assertNormal(status);
        if (!status.files.some((entry) => entry.path === file.path && entry.untracked)) {
          throw new Error(t("文件状态已改变，请刷新后重试。"));
        }
        const entry = this.app.vault.getAbstractFileByPath(file.path);
        if (entry && typeof entry.extension === "string") await this.app.vault.trash(entry, false);
        else await this.app.vault.adapter.trashLocal(file.path);
      });
    }, label);
    confirm.classList.add(file.untracked ? "mod-cta" : "mod-warning");
    modal.open();
    cancel.focus();
  }

  confirmRebase(commit) {
    const modal = new Modal(this.app);
    modal.titleEl.textContent = t("Rebase 当前分支到此提交？");
    el(modal.contentEl, "p", "", t`目标：${commit.short} · ${commit.subject}`);
    el(modal.contentEl, "p", "", t("当前分支的独有提交会重放到目标提交之后，提交编号可能改变。遇到冲突会暂停，可在侧栏解决、继续或中止。已推送的提交请谨慎变基；插件不会强制推送。"));
    button(modal.contentEl, "x", t("取消"), () => modal.close(), t("取消"));
    button(modal.contentEl, "git-branch", t("确认 Rebase"), () => {
      modal.close(); return this.mutate("Rebase", () => this.git.rebaseOnto(commit.hash));
    }, t("确认 Rebase"));
    modal.open();
  }

  ensureReady() { return operations.ensureReady(this); }

  createEditorSessions() {
    return new EditorSessions({
      vault: this.app.vault,
      read: (filePath, timing) => this.git.worktreeVersions(filePath, timing),
      enabled: () => this.settings.diffAutosave,
      changed: () => { if (!this.unloaded) this.app.workspace.requestSaveLayout(); },
      saved: () => this.scheduleRefresh(),
    });
  }

  scheduleRefresh() { return operations.scheduleRefresh(this); }

  sourceVisible() { return operations.sourceVisible(this); }

  updateSourceVisibility() { return operations.updateSourceVisibility(this); }

  refreshSource() { return operations.refreshSource(this); }

  views(...types) {
    return types.flatMap((type) => this.app.workspace.getLeavesOfType(type)
      .map((leaf) => leaf.view).filter(view => this.isView(view, type)));
  }

  isView(view, type) { return Boolean(this.viewClasses?.[type] && view instanceof this.viewClasses[type]); }

  renderViews(types = [SOURCE_VIEW]) {
    if (this.unloaded) return;
    for (const view of this.views(...types)) void view.render();
  }

  refresh(notify, force) { return operations.refresh(this, notify, force); }

  mutate(label, action) { return operations.mutate(this, label, action); }

  runGit(method) { return operations.runGit(this, method); }

  toggleStash() { return operations.toggleStash(this); }

  changeStage(files, area) { return operations.changeStage(this, files, area); }

  commit() { return operations.commit(this); }

  commitMessage(message) { return operations.commitMessage(this, message); }

  openView(type, state, leaf) { return navigation.openView(this, type, state, leaf); }

  openSidebar() { return this.openView(SOURCE_VIEW); }
  openHistory() { return this.openView(HISTORY_VIEW); }
  openFileHistory(filePath) { return navigation.openFileHistory(this, filePath); }
  addFileHistoryMenu(menu, filePath) {
    menu.addItem(item => item.setTitle(t("文件历史")).setIcon("history").onClick(() => this.openFileHistory(filePath).catch(error => new Notice(error.message))));
  }
  openConflict(filePath) { return this.openView(CONFLICT_VIEW, { filePath }); }

  diffLeaf() { return navigation.diffLeaf(this); }

  openDiff(file, area, graphReturn, timing) { return navigation.openDiff(this, file, area, graphReturn, timing); }

  openFile(filePath, graphReturn) { return navigation.openFile(this, filePath, graphReturn); }

  setGraphReturn(leaf, filePath, graphReturn) { return navigation.setGraphReturn(this, leaf, filePath, graphReturn); }

  pruneGraphReturns() { return navigation.pruneGraphReturns(this); }

  activeGraphReturn() { return navigation.activeGraphReturn(this); }

  updateEditorReturn(leaf) { return navigation.updateEditorReturn(this, leaf); }

  returnToGraph(context) { return navigation.returnToGraph(this, context); }

};
