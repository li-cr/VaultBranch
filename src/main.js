"use strict";

const { t, setLanguage } = require("./i18n.js");

const { Plugin, ItemView, Notice, setIcon, Platform, PluginSettingTab, Setting, Modal, Menu, moment } = require("obsidian");
const { hostname } = require("node:os");

const SOURCE_VIEW = "vaultbranch-source-control";
const DIFF_VIEW = "vaultbranch-diff";
const HISTORY_VIEW = "vaultbranch-history";
const CONFLICT_VIEW = "vaultbranch-conflict";
const DEFAULT_SETTINGS = require("../default-settings.json");
const LABELS = { staged: "已暂存", unstaged: "未暂存", conflicts: "冲突", history: "历史" };
const STATUS_LABELS = { M: "已修改", A: "新增", D: "删除", R: "重命名", C: "复制", T: "类型改变", U: "冲突", "?": "未跟踪" };

function el(parent, tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  parent.appendChild(node);
  return node;
}

function button(parent, icon, title, action, text) {
  const node = el(parent, "button", text ? "vaultbranch-button" : "vaultbranch-icon-button");
  node.type = "button";
  node.title = title;
  node.setAttribute("aria-label", title);
  if (icon) setIcon(el(node, "span", "vaultbranch-button-icon"), icon);
  if (text) el(node, "span", "", text);
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    Promise.resolve().then(action).catch((error) => new Notice(error.message));
  });
  return node;
}

function drawGraph(parent, commit, width) {
  const colors = ["blue", "green", "orange", "purple", "red"];
  const color = (lane) => `var(--color-${colors[lane % colors.length]})`;
  const x = (lane) => 12 + lane * 16;
  const svgNode = (parent, tag, attributes) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    parent.appendChild(node);
    return node;
  };
  const svg = svgNode(parent, "svg", { width, height: 36, viewBox: `0 0 ${width} 36`, class: "vaultbranch-graph" });
  for (const { from, to, through } of commit.edges) {
    if (to < 0) continue;
    const d = through ? `M ${x(from)} 0 L ${x(from)} 18 C ${x(from)} 26 ${x(to)} 26 ${x(to)} 36`
      : `M ${x(from)} 18 C ${x(from)} 27 ${x(to)} 27 ${x(to)} 36`;
    svgNode(svg, "path", { d, stroke: color(from), "stroke-width": 2, fill: "none" });
  }
  svgNode(svg, "path", { d: `M ${x(commit.column)} 0 L ${x(commit.column)} 18`, stroke: color(commit.column), "stroke-width": 2 });
  svgNode(svg, "circle", { cx: x(commit.column), cy: 18, r: commit.parents.length > 1 ? 5 : 4,
    fill: color(commit.column), stroke: "var(--background-primary)", "stroke-width": 1.5 });
}

class SourceControlView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.collapsed = new Set();
    this.selected = "";
  }

  getViewType() { return SOURCE_VIEW; }
  getDisplayText() { return t("VaultBranch · 源代码管理"); }
  getIcon() { return "git-branch"; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("vaultbranch-source");
    const header = el(this.contentEl, "div", "vaultbranch-header");
    this.branchEl = el(header, "div", "vaultbranch-branch");
    this.commitButton = button(header, "check", t("Commit · 只提交暂存区 · Ctrl+Enter"), () => this.plugin.commit());
    this.commitButton.classList.add("vaultbranch-commit");
    this.pullButton = button(header, "arrow-down", "Pull", () => this.plugin.runGit("pull"));
    this.pushButton = button(header, "arrow-up", "Push", () => this.plugin.runGit("push"));
    this.stashButton = button(header, "archive", t("Stash 当前修改"), () => this.plugin.toggleStash());
    button(header, "history", t("提交历史 / 分支图"), () => this.plugin.openHistory());
    this.refreshButton = button(header, "refresh-cw", t("刷新文件状态"), () => this.plugin.refresh(true));
    button(header, "ellipsis", t("更多操作"), () => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle("Fetch").setIcon("download").onClick(() => this.plugin.runGit("fetch")));
      menu.addItem((item) => item.setTitle(t("操作输出")).setIcon("scroll-text").onClick(() => this.plugin.showOutput()));
      menu.addItem((item) => item.setTitle(t("设置")).setIcon("settings").onClick(() => this.plugin.openSettings()));
      menu.showAtPosition({ x: header.getBoundingClientRect().right - 180, y: header.getBoundingClientRect().bottom });
    });
    const composer = el(this.contentEl, "div", "vaultbranch-composer");
    this.messageEl = el(composer, "textarea", "vaultbranch-message");
    this.messageEl.setAttribute("aria-label", t("提交说明"));
    this.messageEl.rows = 2;
    this.messageEl.value = this.plugin.draft;
    this.messageEl.addEventListener("input", () => {
      this.plugin.draft = this.messageEl.value;
      this.updateButtons();
    });
    this.messageEl.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        if (!this.commitButton.disabled) this.commitButton.click();
      }
    });
    this.noticeEl = el(this.contentEl, "div", "vaultbranch-notice");
    this.recoveryEl = el(this.contentEl, "div", "vaultbranch-recovery");
    this.treeEl = el(this.contentEl, "div", "vaultbranch-tree");
    this.treeEl.setAttribute("aria-label", t("Git 文件改动"));
    this.render();
    await this.plugin.refresh();
  }

  updateButtons() {
    if (!this.commitButton) return;
    const { status, busy, ready } = this.plugin;
    const blocked = !ready || busy || !status || Boolean(status.operation) || Boolean(status?.files.some((file) => file.conflict));
    const staged = status ? this.plugin.core.groupsFor(status.files).staged.length : 0;
    const message = this.plugin.commitMessage();
    this.messageEl.placeholder = this.plugin.commitMessage("") || t("提交说明（Ctrl+Enter）");
    this.messageEl.title = t`最终提交说明：${message || t("（空）")}`;
    this.messageEl.disabled = busy;
    this.commitButton.disabled = blocked || !staged || !message;
    this.pullButton.disabled = blocked || !status?.upstream;
    this.pushButton.disabled = blocked || !status?.upstream;
    const canStash = !blocked && Boolean(status?.files.length);
    const canPop = !blocked && !status?.files.length && Boolean(status?.stash);
    this.stashButton.disabled = !canStash && !canPop;
    const stashTitle = canPop ? t("恢复最近一次 Stash") : canStash ? t("Stash 当前修改（包含未跟踪文件）") : t("没有可 Stash 或恢复的修改");
    this.stashButton.title = stashTitle;
    this.stashButton.setAttribute("aria-label", stashTitle);
    this.stashButton.classList.toggle("is-active", canPop);
    const reason = busy ? t("已有 Git 操作执行中，请稍候。") : !ready || !status ? t("仓库尚未就绪，请刷新状态。") : status.operation ? t`当前 ${status.operation} 尚未完成。请先解决冲突并继续，或中止本次操作。` : status.files.some((file) => file.conflict) ? t("请先解决冲突。") : !status.upstream ? t("当前分支未配置上游，暂不能 Pull / Push。") : "";
    this.pullButton.title = reason || `Pull (${this.plugin.settings.pullMethod})`;
    this.pushButton.title = reason || `Push → ${status.upstream}`;
    this.commitButton.title = blocked ? reason : !staged ? t("暂存区为空，先点击文件旁的 +。") : !message ? t("请填写提交说明。") : t`Commit · 只提交暂存区 · Ctrl+Enter\n${message}`;
    this.refreshButton.disabled = busy;
    this.commitButton.classList.toggle("is-busy", busy);
  }

  render() {
    if (!this.treeEl) return;
    const { status, busy, error } = this.plugin;
    this.updateButtons();
    this.branchEl.replaceChildren();
    setIcon(el(this.branchEl, "span", "vaultbranch-branch-icon"), "git-branch");
    el(this.branchEl, "span", "vaultbranch-branch-name", status?.branch || t("读取仓库中…"));
    if (status) el(this.branchEl, "span", "vaultbranch-sync-count", `↑ ${status.ahead}  ↓ ${status.behind}`);
    this.branchEl.title = status?.upstream ? t`上游 ${status.upstream} · ↑↓ 为上次 Fetch 的结果` : t("未设置上游分支");
    this.noticeEl.textContent = busy ? `${this.plugin.busyLabel}…` : error || (status?.operation ? t`${status.operation} 尚未完成，Pull / Push 暂不可用。解决冲突后继续，或中止。` : status && !status.upstream ? t("当前分支没有上游，Pull / Push 暂不可用。") : "");
    this.noticeEl.classList.toggle("is-error", Boolean(error || status?.operation));
    this.noticeEl.hidden = !this.noticeEl.textContent;
    this.recoveryEl.replaceChildren();
    this.recoveryEl.hidden = !["rebase", "merge"].includes(status?.operation);
    if (!this.recoveryEl.hidden) {
      const next = button(this.recoveryEl, "play", t("继续当前操作"), () => this.plugin.mutate(t("继续"), () => this.plugin.git.continueOperation()), t("继续"));
      next.disabled = busy || status.files.some((file) => file.conflict);
      const abort = button(this.recoveryEl, "undo-2", t("中止当前操作"), () => this.plugin.confirmAbort(), t("中止"));
      abort.disabled = busy;
    }

    const scroll = this.treeEl.scrollTop;
    this.treeEl.replaceChildren();
    if (!status) {
      el(this.treeEl, "div", "vaultbranch-empty", error ? t("无法读取 Git 仓库，请查看上方错误。") : t("正在读取文件改动…"));
      return;
    }
    const groups = this.plugin.core.groupsFor(status.files);
    if (groups.conflicts.length) this.renderGroup("conflicts", groups.conflicts);
    this.renderGroup("staged", groups.staged);
    this.renderGroup("unstaged", groups.unstaged);
    if (!status.files.length) el(this.treeEl, "div", "vaultbranch-clean", t("✓ 工作区干净"));
    this.treeEl.scrollTop = scroll;
  }

  renderGroup(area, files) {
    const group = el(this.treeEl, "section", "vaultbranch-group");
    const header = el(group, "div", "vaultbranch-group-header");
    const key = `group:${area}`;
    const toggle = button(header, this.collapsed.has(key) ? "chevron-right" : "chevron-down", t`展开或折叠${t(LABELS[area])}`, () => this.toggle(key));
    toggle.setAttribute("aria-expanded", String(!this.collapsed.has(key)));
    const name = el(header, "button", "vaultbranch-group-label", t(LABELS[area]));
    name.type = "button";
    name.addEventListener("click", () => this.toggle(key));
    el(header, "span", "vaultbranch-count", String(files.length));
    if (files.length && area !== "conflicts") {
      const action = button(header, area === "staged" ? "minus" : "plus", area === "staged" ? t("全部取消暂存") : t("全部暂存"), () => this.plugin.changeStage(files, area));
      action.disabled = this.plugin.busy;
    }
    if (!files.length) {
      return;
    }
    if (!this.collapsed.has(key)) {
      const tree = el(group, "div", "vaultbranch-group-tree");
      tree.setAttribute("role", "tree");
      tree.setAttribute("aria-label", t`${t(LABELS[area])}文件`);
      this.renderTree(tree, this.plugin.core.treeFor(files), area, 0);
    }
  }

  toggle(key) {
    if (this.collapsed.has(key)) this.collapsed.delete(key);
    else this.collapsed.add(key);
    this.render();
  }

  renderTree(parent, tree, area, depth) {
    const compare = (a, b) => a.localeCompare(b, this.plugin.settings.language === "en" ? "en" : "zh-CN", { numeric: true });
    for (const [name, folder] of [...tree.folders].sort(([a], [b]) => compare(a, b))) {
      const key = `${area}:${folder.path}`;
      const node = el(parent, "div", "vaultbranch-folder-node");
      node.dataset.path = folder.path;
      node.setAttribute("role", "treeitem");
      node.setAttribute("aria-level", String(depth + 1));
      node.setAttribute("aria-expanded", String(!this.collapsed.has(key)));
      const row = el(node, "button", "vaultbranch-folder");
      row.type = "button";
      row.title = folder.path;
      row.setAttribute("aria-expanded", String(!this.collapsed.has(key)));
      setIcon(el(row, "span", "vaultbranch-chevron"), this.collapsed.has(key) ? "chevron-right" : "chevron-down");
      setIcon(el(row, "span", "vaultbranch-file-icon"), this.collapsed.has(key) ? "folder-closed" : "folder-open");
      el(row, "span", "vaultbranch-file-name", name);
      row.addEventListener("click", () => this.toggle(key));
      if (!this.collapsed.has(key)) {
        const children = el(node, "div", "vaultbranch-children");
        children.setAttribute("role", "group");
        this.renderTree(children, folder, area, depth + 1);
      }
    }
    for (const file of [...tree.files].sort((a, b) => compare(a.path, b.path))) {
      const row = el(parent, "div", "vaultbranch-file-row");
      row.dataset.path = file.path;
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-level", String(depth + 1));
      el(row, "span", "vaultbranch-chevron vaultbranch-file-spacer").setAttribute("aria-hidden", "true");
      row.classList.toggle("is-selected", this.selected === `${area}:${file.path}`);
      const code = file.conflict ? "U" : file.untracked ? "?" : area === "staged" ? file.index : file.worktree;
      const open = el(row, "button", "vaultbranch-file-open");
      open.type = "button";
      open.title = t`${file.path}\n${t(STATUS_LABELS[code] || code)}${file.oldPath ? t`\n原路径：${file.oldPath}` : ""}\n点击查看${t(LABELS[area])}差异`;
      setIcon(el(open, "span", "vaultbranch-file-icon"), "file-text");
      el(open, "span", "vaultbranch-file-name", file.path.split("/").at(-1));
      open.addEventListener("click", () => {
        this.selected = `${area}:${file.path}`;
        this.render();
        (area === "conflicts" ? this.plugin.openConflict(file.path) : this.plugin.openDiff(file, area)).catch((error) => new Notice(error.message));
      });
      if (area !== "conflicts") {
        const stage = button(row, area === "staged" ? "minus" : "plus", area === "staged" ? t("取消暂存") : t("暂存文件"), () => this.plugin.changeStage([file], area));
        stage.classList.add("vaultbranch-row-action");
        stage.disabled = this.plugin.busy;
        if (area === "unstaged") {
          const discard = button(row, "undo-2", t("撤销更改"), () => this.plugin.confirmDiscard(file));
          discard.classList.add("vaultbranch-row-action", "vaultbranch-discard");
          discard.disabled = this.plugin.busy || Boolean(this.plugin.status?.operation);
        }
      }
      const badge = el(row, "span", `vaultbranch-file-status status-${code === "?" ? "untracked" : code}`, code);
      badge.setAttribute("aria-label", t(STATUS_LABELS[code] || code));
      badge.title = t(STATUS_LABELS[code] || code);
    }
  }
}

class GitView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.request = 0; }
  async onOpen() { this.contentEl.addClass(this.getViewType()); await this.render(); }
  async onClose() { this.request++; }
}

class DiffView extends GitView {
  constructor(leaf, plugin) {
    super(leaf, plugin);
    this.file = null;
    this.area = "unstaged";
    this.unified = false;
    this.graphReturn = null;
  }

  getViewType() { return DIFF_VIEW; }
  getDisplayText() { return this.file ? `${this.file.path.split("/").at(-1)} · ${t(LABELS[this.area])}` : t("VaultBranch · 差异"); }
  getIcon() { return "git-compare"; }
  getState() { return { file: this.file, area: this.area, unified: this.unified, graphReturn: this.graphReturn }; }
  async setState(state, result) {
    this.file = state.file || null;
    this.area = LABELS[state.area] ? state.area : "unstaged";
    this.unified = Boolean(state.unified);
    this.graphReturn = this.area === "history" ? state.graphReturn || null : null;
    this.plugin.setGraphReturn(this.leaf, this.file?.path, this.graphReturn);
    await this.render();
    await super.setState(state, result);
  }

  async render() {
    const request = ++this.request;
    this.contentEl.empty();
    if (!this.file) { el(this.contentEl, "div", "vaultbranch-empty", t("在 VaultBranch 侧栏选择文件查看差异。")); return; }
    const header = el(this.contentEl, "div", "vaultbranch-diff-header");
    if (this.area === "history") button(header, "arrow-left", t("返回 Git Graph"), () => this.plugin.returnToGraph(this.graphReturn), "Git Graph");
    el(header, "div", "vaultbranch-diff-path", this.file.path);
    el(header, "span", "vaultbranch-tag", t(LABELS[this.area]));
    button(header, "file-pen-line", t("打开文件"), () => this.plugin.openFile(this.file.path, this.graphReturn));
    button(header, this.unified ? "columns-2" : "list", this.unified ? t("切换左右对比") : t("切换统一差异"), async () => { this.unified = !this.unified; await this.render(); });
    button(header, "refresh-cw", t("刷新差异"), () => this.render());
    el(this.contentEl, "div", "vaultbranch-diff-description", this.area === "history" ? t`提交 ${this.file.commit.slice(0, 8)} · 相对第一父提交` : this.area === "staged" ? t("HEAD → 暂存区") : t("暂存区 → 工作区"));
    const body = el(this.contentEl, "div", "vaultbranch-diff-body");
    el(body, "div", "vaultbranch-empty", t("读取差异中…"));
    try {
      await this.plugin.ensureReady();
      const result = this.area === "history" ? await this.plugin.git.commitDiff(this.file) : await this.plugin.git.diff(this.file, this.area);
      if (request !== this.request) return;
      body.replaceChildren();
      if (result.message) el(body, "div", "vaultbranch-empty", result.message);
      if (!result.patch) return;
      if (this.unified || this.area === "conflicts") {
        const code = el(body, "div", "vaultbranch-unified");
        for (const line of result.patch.split("\n")) {
          const type = line.startsWith("@@") ? "hunk" : line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "delete" : "context";
          el(code, "div", `vaultbranch-patch-line is-${type}`, line || " ");
        }
      } else {
        const captions = el(body, "div", "vaultbranch-diff-captions");
        el(captions, "span", "", this.area === "history" ? t("父提交") : this.area === "staged" ? "HEAD" : t("暂存区"));
        el(captions, "span", "", this.area === "history" ? t("当前提交") : this.area === "staged" ? t("暂存区") : t("工作区"));
        const grid = el(body, "div", "vaultbranch-split");
        for (const row of this.plugin.core.splitPatch(result.patch)) {
          if (row.kind === "hunk" || row.kind === "meta") {
            el(grid, "div", `vaultbranch-diff-meta is-${row.kind}`, row.text || " ");
          } else {
            const line = el(grid, "div", "vaultbranch-diff-row");
            for (const side of ["left", "right"]) {
              const cell = el(line, "div", `vaultbranch-diff-cell${row.kind === "change" && row[side] ? side === "left" ? " is-delete" : " is-add" : ""}${!row[side] ? " is-blank" : ""}`);
              el(cell, "span", "vaultbranch-line-number", row[side] ? String(row[side].line) : "");
              el(cell, "span", "vaultbranch-line-text", row[side]?.text || " ");
            }
          }
        }
      }
    } catch (error) {
      if (request === this.request) { body.replaceChildren(); el(body, "div", "vaultbranch-empty is-error", error.message); }
    }
  }
}

class HistoryView extends GitView {
  constructor(leaf, plugin) { super(leaf, plugin); this.limit = plugin.settings.historyLimit; this.selected = ""; this.query = ""; this.ref = ""; }
  getViewType() { return HISTORY_VIEW; }
  getDisplayText() { return t("VaultBranch · 提交历史"); }
  getIcon() { return "git-fork"; }
  getState() { return { ref: this.ref, query: this.query, selected: this.selected, limit: this.limit }; }
  async setState(state, result) {
    for (const key of ["ref", "query", "selected"]) if (typeof state[key] === "string") this[key] = state[key];
    if (Number.isFinite(state.limit)) this.limit = Math.max(10, Math.min(1000, state.limit));
    await this.render(); await super.setState(state, result);
  }
  captureNavigation() {
    return { leafId: this.leaf.id, state: this.getState(), scrollTop: this.bodyEl?.scrollTop || 0, scrollLeft: this.bodyEl?.scrollLeft || 0, detailTop: this.detailsEl?.scrollTop || 0 };
  }
  async render() {
    const scroll = { top: this.bodyEl?.scrollTop || 0, left: this.bodyEl?.scrollLeft || 0, detail: this.detailsEl?.scrollTop || 0 };
    const request = ++this.request;
    this.contentEl.empty();
    const toolbar = el(this.contentEl, "div", "vaultbranch-history-toolbar");
    el(toolbar, "strong", "", "Git Graph");
    const branch = el(toolbar, "select", "vaultbranch-history-filter");
    branch.setAttribute("aria-label", t("历史分支"));
    el(branch, "option", "", t("全部分支")).value = "";
    const search = el(toolbar, "input", "vaultbranch-history-search");
    search.type = "search"; search.placeholder = t("搜索提交…"); search.value = this.query;
    search.setAttribute("aria-label", t("搜索提交"));
    button(toolbar, "download", "Fetch", () => this.plugin.runGit("fetch"));
    button(toolbar, "arrow-up", t("Push 当前分支"), () => this.plugin.runGit("push"));
    button(toolbar, "archive", t("Stash 当前修改（含未跟踪文件）"), () => this.plugin.runGit("stash"));
    button(toolbar, "refresh-cw", t("刷新历史"), () => this.render());
    const body = el(this.contentEl, "div", "vaultbranch-history-body");
    const details = el(this.contentEl, "div", "vaultbranch-history-details");
    this.bodyEl = body; this.detailsEl = details;
    el(body, "div", "vaultbranch-empty", t("读取历史…"));
    try {
      await this.plugin.ensureReady();
      const [commits, refs, hasStash] = await Promise.all([
        this.plugin.git.history(this.limit, this.ref),
        this.plugin.git.run(["for-each-ref", "--format=%(refname:short)", "refs/heads/", "refs/remotes/"]),
        this.plugin.git.stashExists(),
      ]);
      if (request !== this.request) return;
      for (const ref of refs.trim().split("\n").filter(Boolean)) el(branch, "option", "", ref).value = ref;
      if (hasStash) el(branch, "option", "", t("stash（临时修改）")).value = "stash";
      branch.value = this.ref;
      branch.addEventListener("change", () => { this.ref = branch.value; void this.render(); });
      body.replaceChildren();
      if (!commits.length) { el(body, "div", "vaultbranch-empty", t("还没有提交。")); return; }
      const columns = Math.max(...commits.map((commit) => commit.width));
      const width = Math.max(36, columns * 16 + 14);
      body.style.setProperty("--vaultbranch-graph-width", `${Math.max(width, 70)}px`);
      const headings = el(body, "div", "vaultbranch-history-columns");
      for (const label of [t("分支图"), t("提交说明"), t("日期"), t("作者"), t("提交")]) el(headings, "span", "", label);
      for (const commit of commits) {
        const row = el(body, "button", "vaultbranch-history-row");
        row.type = "button";
        row.dataset.commit = commit.hash;
        row.classList.toggle("is-stash", Boolean(commit.stash));
        row.dataset.search = `${commit.subject} ${commit.author} ${commit.hash} ${commit.refs}`.toLocaleLowerCase();
        row.classList.toggle("is-selected", this.selected === commit.hash);
        row.title = `${commit.hash}\n${commit.author} · ${commit.date}\n${commit.subject}${commit.stashRef ? `\n${commit.stashRef}` : ""}`;
        row.addEventListener("contextmenu", (event) => {
          event.preventDefault(); event.stopPropagation();
          const menu = new Menu();
          for (const action of this.actionsFor(commit)) {
            menu.addItem((item) => item.setTitle(action.title).setIcon(action.icon)
              .setDisabled(this.plugin.busy).onClick(action.run));
          }
          menu.showAtMouseEvent(event);
        });
        drawGraph(row, commit, width);
        const text = el(row, "div", "vaultbranch-history-message");
        el(text, "span", "vaultbranch-history-subject", commit.subject || t("（无说明）"));
        if (commit.refs) el(text, "span", "vaultbranch-history-refs", commit.refs);
        el(row, "time", "vaultbranch-history-date", new Date(commit.date).toLocaleDateString());
        el(row, "span", "vaultbranch-history-author", commit.author);
        el(row, "code", "vaultbranch-history-hash", commit.short);
        row.onclick = async () => {
          this.selected = commit.hash;
          for (const item of body.querySelectorAll(".vaultbranch-history-row")) item.classList.toggle("is-selected", item === row);
          details.replaceChildren();
          el(details, "div", "vaultbranch-history-detail-title", `${commit.short} · ${commit.subject}`);
          const actions = el(details, "div", "vaultbranch-history-actions");
          for (const action of this.actionsFor(commit)) {
            button(actions, action.icon, action.title, action.run, action.title).disabled = this.plugin.busy;
          }
          try {
            const files = commit.stash ? await this.plugin.git.stashFiles(commit.hash) : await this.plugin.git.commitFiles(commit.hash);
            if (this.selected !== commit.hash || request !== this.request) return;
            for (const file of files) button(details, "file-diff", `${file.index} ${file.path}`, () => this.plugin.openDiff(file, "history", this.captureNavigation()), `${file.index}  ${file.path}`);
            if (!files.length) el(details, "div", "vaultbranch-empty", t("此提交相对第一父提交没有文件改动。"));
          } catch (error) { el(details, "div", "is-error", error.message); }
        };
      }
      const applySearch = () => {
        this.query = search.value;
        const query = this.query.trim().toLocaleLowerCase();
        for (const row of body.querySelectorAll(".vaultbranch-history-row")) {
          const match = !query || row.dataset.search.includes(query);
          row.classList.toggle("is-dimmed", !match);
          row.setAttribute("aria-label", `${match ? "" : t("非搜索匹配：")}${row.title}`);
        }
      };
      search.addEventListener("input", applySearch); applySearch();
      if (commits.length >= this.limit && this.limit < 1000) button(body, "chevrons-down", t("加载更多历史"), async () => { this.limit = Math.min(1000, this.limit + this.plugin.settings.historyLimit); await this.render(); }, t("加载更多"));
      const selectedRow = [...body.querySelectorAll(".vaultbranch-history-row")].find((row) => row.dataset.commit === this.selected);
      if (selectedRow) await selectedRow.onclick();
      if (request === this.request) { body.scrollTop = scroll.top; body.scrollLeft = scroll.left; details.scrollTop = scroll.detail; }
    } catch (error) {
      if (request === this.request) { body.replaceChildren(); el(body, "div", "vaultbranch-empty is-error", error.message); }
    }
  }

  actionsFor(commit) {
    const p = this.plugin;
    if (commit.stash) return [
      { title: t("应用此 Stash（保留记录）"), icon: "archive-restore", run: () => p.mutate(t("应用 Stash"), () => p.git.stashApply(commit)) },
      { title: t("Pop 此 Stash（恢复并移除）"), icon: "archive-x", run: () => p.mutate("Pop Stash", () => p.git.stashPop(commit)) },
    ];
    return [
      { title: t("Rebase 当前分支到此提交…"), icon: "git-branch", run: () => p.confirmRebase(commit) },
      { title: t("Push 当前分支"), icon: "arrow-up", run: () => p.runGit("push") },
    ];
  }
}

class ConflictView extends GitView {
  constructor(leaf, plugin) { super(leaf, plugin); this.filePath = ""; }
  getViewType() { return CONFLICT_VIEW; }
  getDisplayText() { return this.filePath ? t`冲突 · ${this.filePath.split("/").at(-1)}` : t("VaultBranch · 解决冲突"); }
  getIcon() { return "git-merge"; }
  getState() { return { filePath: this.filePath }; }
  async setState(state, result) { this.filePath = state.filePath || ""; await this.render(); await super.setState(state, result); }
  async render({ preserveDraft = false } = {}) {
    const draft = preserveDraft ? this.contentEl.querySelector(".vaultbranch-conflict-result")?.value : undefined;
    const request = ++this.request;
    this.contentEl.empty();
    if (!this.filePath) return;
    const header = el(this.contentEl, "div", "vaultbranch-diff-header");
    el(header, "div", "vaultbranch-diff-path", this.filePath);
    const body = el(this.contentEl, "div", "vaultbranch-conflict-body");
    try {
      await this.plugin.ensureReady();
      const versions = await this.plugin.git.conflictVersions(this.filePath);
      if (request !== this.request) return;
      const expected = draft !== undefined && this.loadedPath === this.filePath ? this.expectedResult : versions.result;
      this.loadedPath = this.filePath;
      this.expectedResult = expected;
      const sources = el(body, "div", "vaultbranch-conflict-sources");
      const resultLabel = el(body, "div", "vaultbranch-conflict-label", t("解决结果 · 可直接编辑"));
      const result = el(body, "textarea", "vaultbranch-conflict-result");
      result.setAttribute("aria-label", t("冲突解决结果")); result.spellcheck = false; result.value = draft ?? versions.result;
      for (const [key, label] of [["ours", versions.oursLabel], ["theirs", versions.theirsLabel]]) {
        const pane = el(sources, "section", "vaultbranch-conflict-pane");
        const title = el(pane, "div", "vaultbranch-conflict-label"); el(title, "span", "", label);
        const take = button(title, "check", t`使用${label}`, () => { result.value = versions[key] || ""; }, t("使用此版本"));
        take.disabled = versions[key] === null;
        const text = el(pane, "textarea", "vaultbranch-conflict-source"); text.readOnly = true; text.spellcheck = false; text.value = versions[key] === null ? t("（此版本已删除文件）") : versions[key]; text.setAttribute("aria-label", label);
      }
      const base = el(body, "details", "vaultbranch-conflict-base"); el(base, "summary", "", t("共同祖先")); el(base, "pre", "", versions.base || t("（无共同祖先内容）"));
      body.insertBefore(base, resultLabel);
      const save = button(header, "check", t("保存并暂存解决结果"), async () => {
        const saved = await this.plugin.mutate(t("解决冲突"), () => this.plugin.git.resolveConflict(this.filePath, result.value, expected));
        if (saved) { save.disabled = true; result.readOnly = true; resultLabel.textContent = t("已保存并暂存 · 在侧栏点击继续"); }
      }, t("保存并暂存"));
      if (versions.ours === null || versions.theirs === null) {
        save.disabled = true;
        el(body, "div", "vaultbranch-empty", t("此冲突涉及删除，请在外部 Git 工具中处理。"));
      }
    } catch (error) { if (request === this.request) el(body, "div", "vaultbranch-empty is-error", error.message); }
  }
}

class MyGitSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this; const p = this.plugin;
    containerEl.empty();
    new Setting(containerEl).setName(t("界面语言")).addDropdown((input) => input.addOptions({ zh: "简体中文", en: "English" }).setValue(p.settings.language).onChange(async (value) => {
      if (await p.updateSetting("language", value)) this.display();
    }));
    new Setting(containerEl).setName(t("Git 路径")).setDesc(t("留空自动检测。仅当本机 Git 不在 PATH 中时填写 Git 可执行文件的完整路径。")).addText((input) => input.setPlaceholder(t("自动检测")).setValue(p.settings.gitPath).onChange((value) => p.updateSetting("gitPath", value.trim())));
    new Setting(containerEl).setName(t("拉取方式")).setDesc(t("默认 rebase，遇到冲突会停下，解决后继续。")).addDropdown((input) => input.addOptions({ rebase: "Rebase", merge: "Merge" }).setValue(p.settings.pullMethod).onChange((value) => p.updateSetting("pullMethod", value)));
    const preview = new Setting(containerEl).setName(t("提交说明前缀")).setDesc(t("支持 {{date}} 和 {{hostname}}；提交时自动加在手写说明前。留空关闭前缀。"));
    const updatePreview = () => preview.setDesc(t`支持 {{date}} 和 {{hostname}}；提交时自动加在手写说明前，留空关闭。预览：${p.commitMessage(t("修改笔记"))}`);
    for (const [key, name, placeholder, desc] of [
      ["commitMessage", t("提交说明前缀"), DEFAULT_SETTINGS.commitMessage, ""],
      ["commitDateFormat", t("提交时间格式"), DEFAULT_SETTINGS.commitDateFormat, t("使用 Moment 格式，例如 YYYY-MM-DD HH:mm:ss。")],
      ["hostname", t("主机名"), hostname(), t("留空自动读取当前电脑名称；迁移后自动使用新电脑名称。")],
    ]) {
      const setting = key === "commitMessage" ? preview : new Setting(containerEl).setName(name).setDesc(desc);
      setting.addText((input) => input.setPlaceholder(placeholder).setValue(p.settings[key]).onChange(async (value) => {
        await p.updateSetting(key, key === "hostname" ? value.trim() : value);
        updatePreview();
      }));
    }
    updatePreview();
    for (const [key, name, min, max] of [["refreshSeconds", t("刷新间隔（秒）"), 1, 300], ["historyLimit", t("历史加载条数"), 10, 1000]]) {
      new Setting(containerEl).setName(name).addText((input) => {
        input.inputEl.type = "number"; input.inputEl.min = String(min); input.inputEl.max = String(max);
        input.setValue(String(p.settings[key])).onChange((value) => p.updateSetting(key, Math.max(min, Math.min(max, Number(value) || DEFAULT_SETTINGS[key]))));
      });
    }
    new Setting(containerEl).setName(t("启动时打开侧栏")).addToggle((input) => input.setValue(p.settings.openOnStartup).onChange((value) => p.updateSetting("openOnStartup", value)));
    const tracking = new Setting(containerEl).setName(t("配置文件版本管理")).setDesc(t("检查 data.json 是否被 Git 忽略…"));
    void p.ensureReady().then(() => p.git.settingsTracking()).then((state) => {
      tracking.setDesc(state.tracked ? t("data.json 已在 Git 中，修改后会显示为未暂存。") : state.ignored ? t("data.json 被 .gitignore 忽略，修改不会显示在文件列表。") : t("data.json 可加入 Git。请在文件列表中暂存并提交。"));
      if (state.ignored && !state.tracked) tracking.addButton((input) => input.setButtonText(t("允许追踪")).onClick(async () => {
        if (await p.mutate(t("允许配置追踪"), () => p.git.enableSettingsTracking())) this.display();
      }));
    }).catch((error) => tracking.setDesc(error.message));
    new Setting(containerEl).setName(t("检查 Git")).setDesc(t("插件和 data.json 可随笔记库迁移。新电脑需要安装 Git，并配置提交身份和 SSH / HTTPS 凭据。")).addButton((input) => input.setButtonText(t("检查")).onClick(async () => {
      try { new Notice((await p.git.run(["--version"])).trim()); } catch (error) { new Notice(error.message, 8000); }
    }));
  }
}

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
    for (const [type, View] of Object.entries(VIEW_CLASSES)) this.registerView(type, (leaf) => new View(leaf, this));
    this.addSettingTab(new MyGitSettings(this.app, this));
    this.ribbonEl = this.addRibbonIcon("git-branch", t("VaultBranch · 源代码管理"), () => this.openSidebar());
    this.localizedCommands = this.commandDefinitions().map(([id, name, callback]) => this.addCommand({ id, name: t(name), callback }));
    this.returnCommand = this.addCommand({ id: "return-to-graph", name: t("返回 Git Graph"), checkCallback: (checking) => {
      const context = this.activeGraphReturn();
      if (!context) return false;
      if (!checking) void this.returnToGraph(context.graphReturn);
      return true;
    } });
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => this.updateEditorReturn(leaf)));
    this.registerEvent(this.app.workspace.on("file-open", () => this.updateEditorReturn(this.app.workspace.activeLeaf)));
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
    for (const event of ["modify", "create", "delete", "rename"]) this.registerEvent(this.app.vault.on(event, () => this.scheduleRefresh()));
    this.registerDomEvent(window, "focus", () => this.scheduleRefresh());
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
    window.clearTimeout(this.refreshTimer);
    document.querySelectorAll(".vaultbranch-editor-return").forEach((node) => node.remove());
    this.graphReturns?.clear();
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
    this.settings[key] = value;
    await this.saveData(this.settings);
    if (key === "language") await this.applyLanguage();
    if (key === "gitPath" || key === "pullMethod") {
      if (this.refreshTask) await this.refreshTask;
      this.configureGit();
    }
    await this.refresh();
    return true;
  }

  openSettings() {
    this.app.setting.open(); this.app.setting.openTabById(this.manifest.id);
  }

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

  scheduleRefresh() {
    if (this.unloaded) return;
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => { if (!this.unloaded) void this.refresh(); }, 650);
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
    if (this.busy) { new Notice(t("已有 Git 操作执行中，请稍候。")); return false; }
    this.busy = true;
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
    return this.openView(DIFF_VIEW, { file, area, graphReturn });
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
