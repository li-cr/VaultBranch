"use strict";

const { Plugin, Notice, setIcon, Platform, Modal, moment, debounce } = require("obsidian");
const { hostname } = require("node:os");
const { t, setLanguage } = require("./i18n.js");
const { Autosave, normalize, conflictMessage } = require("./autosave.js");
const { dateTriggerRange } = require("./date.js");
const { SOURCE_VIEW, DIFF_VIEW, HISTORY_VIEW, CONFLICT_VIEW, DEFAULT_SETTINGS, el, button } = require("./views/shared.js");
const { SourceControlView } = require("./views/source.js");
const { DiffView } = require("./views/diff.js");
const { HistoryView } = require("./views/history.js");
const { ConflictView } = require("./views/conflict.js");
const { MyGitSettings } = require("./settings.js");

const VIEW_CLASSES = { [SOURCE_VIEW]: SourceControlView, [DIFF_VIEW]: DiffView, [HISTORY_VIEW]: HistoryView, [CONFLICT_VIEW]: ConflictView };

module.exports = class MyGitPlugin extends Plugin {
  async onload() {
    if (Platform.isMobile) { new Notice(t("VaultBranch 当前只支持桌面端。")); return; }
    const savedSettings = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
    if (!["en", "zh"].includes(this.settings.language)) this.settings.language = DEFAULT_SETTINGS.language;
    setLanguage(this.settings.language);
    if (Object.keys(DEFAULT_SETTINGS).some((key) => !Object.hasOwn(savedSettings || {}, key))) await this.saveData(this.settings);
    this.core = require("./git.js");
    this.configureGit();
    this.status = null;
    this.ready = false;
    this.busy = false;
    this.unloaded = false;
    this.error = "";
    this.lastOutput = "";
    this.draft = "";
    this.graphReturns = new Map();
    this.diffDrafts = new Map();
    this.editSessions = new Map();
    this.editorTasks = new Map();
    for (const [type, View] of Object.entries(VIEW_CLASSES)) this.registerView(type, (leaf) => new View(leaf, this));
    this.addSettingTab(new MyGitSettings(this.app, this));
    this.ribbonEl = this.addRibbonIcon("git-branch", t("VaultBranch · 源代码管理"), () => this.openSidebar());
    this.localizedCommands = this.commandDefinitions().map(([id, name, callback]) => this.addCommand({ id, name: t(name), callback }));
    this.dateCommand = this.addCommand({ id: "insert-date", name: t("插入当前日期时间"), editorCallback: (editor) => editor.replaceSelection(this.formatDate()) });
    this.registerDomEvent(document, "beforeinput", (event) => {
      this.dateInput = event.inputType === "insertText" || event.inputType === "insertCompositionText";
    }, true);
    this.registerEvent(this.app.workspace.on("editor-change", (editor, info) => {
      if (!this.dateInput || this.expandingDate || this.composingDate || info?.getViewType?.() !== "markdown") return;
      this.dateInput = false;
      window.clearTimeout(this.dateTimer);
      this.dateTimer = window.setTimeout(() => {
        if (this.unloaded || this.composingDate || this.app.workspace.activeLeaf?.view.editor !== editor) return;
        const range = dateTriggerRange(editor, this.settings.dateTrigger);
        if (!range) return;
        this.expandingDate = true;
        try { editor.replaceRange(this.formatDate(), range.from, range.to); }
        finally { this.expandingDate = false; }
      }, 0);
    }));
    this.registerDomEvent(document, "compositionstart", () => { this.composingDate = true; });
    this.registerDomEvent(document, "compositionend", () => { this.composingDate = false; });
    this.returnCommand = this.addCommand({ id: "return-to-graph", name: t("返回 Git Graph"), checkCallback: (checking) => {
      const context = this.activeGraphReturn();
      if (!context) return false;
      if (!checking) void this.returnToGraph(context.graphReturn);
      return true;
    } });
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      for (const view of this.views(DIFF_VIEW)) if (view.leaf !== leaf) void view.saveEditor(true);
      this.updateEditorReturn(leaf);
    }));
    this.registerEvent(this.app.workspace.on("file-open", () => this.updateEditorReturn(this.app.workspace.activeLeaf)));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.pruneGraphReturns()));
    const navigateBack = (event) => {
      const context = this.activeGraphReturn();
      if (!context) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.type !== "mousedown") void this.returnToGraph(context.graphReturn).catch((error) => new Notice(error.message));
    };
    for (const event of ["mousedown", "mouseup", "auxclick"]) {
      this.registerDomEvent(window, event, (event) => { if (event.button === 3) navigateBack(event); }, true);
    }
    this.registerDomEvent(window, "keydown", (event) => {
      if (event.key !== "BrowserBack" && !(event.altKey && event.key === "ArrowLeft")) return;
      navigateBack(event);
    }, true);
    for (const event of ["modify", "create", "delete", "rename"]) this.registerEvent(this.app.vault.on(event, (file, oldPath) => {
      this.scheduleRefresh();
      for (const path of new Set([file.path, oldPath])) void this.editSessions.get(path)?.sync();
    }));
    this.registerEvent(this.app.vault.on("raw", (path) => {
      // Hidden configuration files have no TFile and do not emit normal modify events.
      const session = this.editSessions.get(path);
      if (session && !this.app.vault.getAbstractFileByPath(path)) {
        this.scheduleRefresh();
        void session.sync();
      }
    }));
    this.registerDomEvent(window, "focus", () => {
      this.scheduleRefresh();
      for (const view of this.views(DIFF_VIEW)) void view.session?.sync();
    });
    this.registerInterval(window.setInterval(() => {
      if (!document.hidden && this.app.workspace.getLeavesOfType(SOURCE_VIEW).length && Date.now() - (this.lastAutoRefresh || 0) >= this.settings.refreshSeconds * 1000) {
        this.lastAutoRefresh = Date.now(); void this.refresh();
      }
    }, 1000));
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      if (this.settings.openOnStartup) void this.openSidebar().catch((error) => new Notice(error.message));
    });
  }

  onunload() {
    this.unloaded = true;
    this.refreshSoon?.cancel();
    window.clearTimeout(this.dateTimer);
    document.querySelectorAll(".vaultbranch-editor-return").forEach((node) => node.remove());
    this.graphReturns?.clear();
    for (const view of this.views(DIFF_VIEW)) {
      view.stateRequest++; view.request++;
      view.destroyEditor();
    }
    for (const session of this.editSessions.values()) session.stop();
  }

  configureGit() {
    this.git = new this.core.GitService(this.app.vault.adapter.getBasePath(), { binary: this.settings.gitPath || "git", pullMethod: this.settings.pullMethod, settingsPath: `${this.manifest.dir}/data.json` });
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
    this.ribbonEl.setAttribute("aria-label", t("VaultBranch · 源代码管理"));
    for (const view of this.views(...Object.keys(VIEW_CLASSES))) {
      if (view instanceof SourceControlView) await view.onOpen();
      else if (view instanceof ConflictView) await view.render({ preserveDraft: true });
      else await view.render();
      view.leaf.updateHeader?.();
    }
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) this.updateEditorReturn(leaf);
  }

  async updateSetting(key, value) {
    if (this.busy) { new Notice(t("Git 操作执行中，请稍后修改设置。")); return false; }
    if (this.settings[key] === value) return true;
    this.settings[key] = value;
    await this.saveData(this.settings);
    if (key === "diffAutosave") for (const session of this.editSessions.values()) session.setEnabled(value);
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

  async ensureReady() {
    if (this.ready) return;
    if (!this.initTask) {
      this.initTask = this.git.init().then(() => { this.ready = true; }).finally(() => { this.initTask = null; });
    }
    await this.initTask;
  }

  async editorSession(filePath, retain = false) {
    if (!this.editSessions.has(filePath) && !this.editorTasks.has(filePath)) this.editorTasks.set(filePath, (async () => {
      const versions = await this.git.worktreeVersions(filePath);
      const draft = this.diffDrafts.get(filePath) || { ...versions, text: normalize(versions.working) };
      this.diffDrafts.set(filePath, draft);
      const session = new Autosave(draft, {
        enabled: this.settings.diffAutosave,
        read: () => this.git.worktreeVersions(filePath),
        write: async (expected, content) => {
          const file = this.app.vault.getAbstractFileByPath(filePath);
          const update = (current) => {
            if (current !== expected) throw new Error(conflictMessage());
            return content;
          };
          if (file && typeof file.extension === "string") await this.app.vault.process(file, update);
          else if (!file && typeof this.app.vault.adapter.process === "function") await this.app.vault.adapter.process(filePath, update);
          else throw new Error(t("文件状态已改变，请刷新后重试。"));
        },
        changed: () => {
          if (!this.unloaded) this.app.workspace.requestSaveLayout();
          if (session.released) this.pruneEditorSession(filePath, session);
        },
        saved: () => this.scheduleRefresh(),
      });
      this.editSessions.set(filePath, session);
      return session;
    })().finally(() => this.editorTasks.delete(filePath)));
    const session = this.editSessions.get(filePath) || await this.editorTasks.get(filePath);
    if (retain) { session.users = (session.users || 0) + 1; session.released = false; }
    return session;
  }

  releaseEditorSession(filePath, session) {
    session.users = Math.max(0, (session.users || 0) - 1);
    session.released = true;
    this.pruneEditorSession(filePath, session);
  }

  pruneEditorSession(filePath, session) {
    if (this.editSessions.get(filePath) !== session || session.users || session.dirty || session.saving) return;
    session.stop();
    this.editSessions.delete(filePath);
    this.diffDrafts.delete(filePath);
  }

  scheduleRefresh() {
    if (this.unloaded) return;
    this.refreshSoon ||= debounce(() => { if (!this.unloaded) void this.refresh(); }, 650, true);
    this.refreshSoon();
  }

  views(...types) {
    return types.flatMap((type) => this.app.workspace.getLeavesOfType(type)
      .map((leaf) => leaf.view).filter((view) => view instanceof VIEW_CLASSES[type]));
  }

  renderViews(types = [SOURCE_VIEW]) {
    if (this.unloaded) return;
    for (const view of this.views(...types)) void view.render();
  }

  async refresh(notify = false, force = false) {
    if (this.unloaded || (this.busy && !force)) return;
    if (this.refreshTask) return this.refreshTask;
    this.refreshTask = (async () => {
      try {
        await this.ensureReady();
        this.status = await this.git.status();
        if (!this.busy) this.error = "";
      } catch (error) {
        this.error = error.message;
        if (notify) new Notice(error.message, 8000);
      } finally {
        this.renderViews();
      }
    })();
    try { await this.refreshTask; } finally { this.refreshTask = null; }
  }

  async mutate(label, action) {
    if (this.busy || this.mutationPending) { new Notice(t("已有 Git 操作执行中，请稍候。")); return false; }
    this.mutationPending = true;
    for (const view of this.views(DIFF_VIEW)) view.updateEditor();
    const saved = await Promise.all([...this.editSessions.values()].map((session) => session.autoFlush()));
    this.mutationPending = false;
    if (saved.some((success) => !success)) {
      for (const view of this.views(DIFF_VIEW)) view.updateEditor();
      new Notice(t("存在未保存的差异编辑。请按 Ctrl/Cmd+S 保存，或处理保存错误后再执行 Git 操作。"), 8000);
      return false;
    }
    this.busy = true;
    for (const view of this.views(DIFF_VIEW)) view.updateEditor();
    this.busyLabel = label;
    this.error = "";
    this.renderViews();
    let success = false;
    try {
      await this.ensureReady();
      const output = await action();
      this.lastOutput = `${label}\n${output?.trim() || t("操作完成。")}`;
      new Notice(t`${label} 完成`);
      success = true;
    } catch (error) {
      this.error = error.message;
      this.lastOutput = t`${label} 失败\n${error.message}`;
      new Notice(t`${label} 失败：${error.message}`, 10000);
    } finally {
      // Wait for an earlier read before taking a fresh post-operation snapshot.
      if (this.refreshTask) await this.refreshTask;
      await this.refresh(false, true);
      this.busy = false;
      this.renderViews([SOURCE_VIEW, DIFF_VIEW, HISTORY_VIEW]);
    }
    return success;
  }

  runGit(method) {
    return this.mutate(method === "stashPop" ? t("恢复 Stash") : method[0].toUpperCase() + method.slice(1), () => this.git[method]());
  }

  toggleStash() {
    const status = this.status;
    return this.runGit(status?.files.length ? "stash" : "stashPop");
  }

  async changeStage(files, area) {
    const paths = files.flatMap((file) => file.oldPath ? [file.path, file.oldPath] : [file.path]);
    return this.mutate(area === "staged" ? t("取消暂存") : t("暂存"), () => area === "staged" ? this.git.unstage(paths) : this.git.stage(paths));
  }

  async commit() {
    const message = this.commitMessage();
    if (await this.mutate("Commit", () => this.git.commit(message))) {
      this.draft = "";
      for (const view of this.views(SOURCE_VIEW)) {
        if (!view.messageEl) continue;
        view.messageEl.value = "";
        view.updateButtons();
      }
    }
  }

  commitMessage(message = this.draft) {
    const values = { date: moment().format(this.settings.commitDateFormat || DEFAULT_SETTINGS.commitDateFormat), hostname: this.settings.hostname || hostname() };
    const prefix = this.settings.commitMessage.replace(/\{\{(date|hostname)\}\}/g, (_, key) => values[key]);
    return (prefix + (message || "")).trim();
  }

  async openView(type, state, leaf) {
    const workspace = this.app.workspace;
    leaf ||= workspace.getLeavesOfType(type)[0];
    const existing = Boolean(leaf);
    leaf ||= type === SOURCE_VIEW ? workspace.getRightLeaf(false) : workspace.getLeaf("tab");
    if (!leaf) throw new Error(t("无法创建 Git 视图。"));
    if (!existing || state !== undefined) await leaf.setViewState({ type, active: true, state });
    await leaf.loadIfDeferred?.();
    await workspace.revealLeaf(leaf);
    return leaf;
  }

  openSidebar() { return this.openView(SOURCE_VIEW); }
  openHistory() { return this.openView(HISTORY_VIEW); }
  openConflict(filePath) { return this.openView(CONFLICT_VIEW, { filePath }); }

  async openDiff(file, area, graphReturn = null) {
    if (area === "history" && !graphReturn) {
      const graph = this.app.workspace.getLeavesOfType(HISTORY_VIEW).find((item) => item.view instanceof HistoryView);
      graphReturn = graph?.view.captureNavigation() || null;
    }
    // WorkspaceLeaf.setViewState itself is asynchronous; preserve click order.
    const open = () => this.openView(DIFF_VIEW, { file, area, graphReturn });
    this.diffNavigationTask = (this.diffNavigationTask || Promise.resolve()).then(open, open);
    return this.diffNavigationTask;
  }

  async openFile(filePath, graphReturn = null) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file && typeof file.extension === "string") {
      const leaf = this.app.workspace.getLeavesOfType("markdown").find((item) => item.view.file?.path === filePath) || this.app.workspace.getLeaf("tab");
      await leaf.openFile(file);
      if (graphReturn) this.setGraphReturn(leaf, filePath, graphReturn);
      await this.app.workspace.revealLeaf(leaf);
    }
    else new Notice(t("文件已删除，或属于 Obsidian 不显示的隐藏配置文件；请使用差异视图查看。"));
  }

  setGraphReturn(leaf, filePath, graphReturn) {
    if (graphReturn) this.graphReturns.set(leaf.id, { filePath, graphReturn });
    else this.graphReturns.delete(leaf.id);
    this.updateEditorReturn(leaf);
  }

  pruneGraphReturns() {
    if (!this.graphReturns.size) return;
    const leaves = new Set();
    // A truthy callback return stops traversal of the current workspace branch.
    this.app.workspace.iterateAllLeaves((leaf) => { leaves.add(leaf.id); });
    for (const id of this.graphReturns.keys()) if (!leaves.has(id)) this.graphReturns.delete(id);
  }

  activeGraphReturn() {
    const leaf = this.app.workspace.activeLeaf;
    const context = leaf && this.graphReturns.get(leaf.id);
    if (!context) return null;
    if (leaf.view instanceof DiffView && leaf.view.area === "history" && leaf.view.file?.path === context.filePath) return context;
    if (leaf.view.getViewType() === "markdown" && leaf.view.file?.path === context.filePath) return context;
    return null;
  }

  updateEditorReturn(leaf) {
    if (!leaf?.view) return;
    const root = leaf.view.containerEl;
    root.querySelectorAll(".vaultbranch-editor-return").forEach((node) => node.remove());
    if (leaf.view.getViewType() !== "markdown") return;
    const context = this.graphReturns.get(leaf.id);
    if (!context) return;
    if (leaf.view.file?.path !== context.filePath) { this.graphReturns.delete(leaf.id); return; }
    const actions = root.querySelector(".view-actions") || root;
    const back = button(actions, "arrow-left", t("返回 Git Graph"), () => this.returnToGraph(context.graphReturn), "Git Graph");
    back.classList.add("vaultbranch-editor-return");
    if (actions === root) back.classList.add("is-floating");
  }

  async returnToGraph(context) {
    if (this.returningToGraph) return;
    if (!context) { await this.openHistory(); return; }
    this.returningToGraph = true;
    try {
      const preferred = this.app.workspace.getLeavesOfType(HISTORY_VIEW).find((item) => item.id === context.leafId);
      const leaf = await this.openView(HISTORY_VIEW, context.state, preferred);
      // Background Electron windows may suspend animation frames; returning must still finish.
      await new Promise((resolve) => {
        const timer = window.setTimeout(resolve, 60);
        requestAnimationFrame(() => { window.clearTimeout(timer); resolve(); });
      });
      if (leaf.view instanceof HistoryView) {
        if (leaf.view.bodyEl) { leaf.view.bodyEl.scrollTop = context.scrollTop || 0; leaf.view.bodyEl.scrollLeft = context.scrollLeft || 0; }
        if (leaf.view.detailsEl) leaf.view.detailsEl.scrollTop = context.detailTop || 0;
      }
    } finally { this.returningToGraph = false; }
  }

};
