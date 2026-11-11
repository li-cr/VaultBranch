"use strict";

const { ItemView, Menu, Notice, setIcon } = require("obsidian");
const { t } = require("../i18n.js");
const { SOURCE_VIEW, LABELS, STATUS_LABELS, el, button } = require("./shared.js");
const { chooseBranch, createBranch } = require("../branches.js");

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
    this.renderSnapshot = null;
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
      menu.addItem((item) => item.setTitle(t("切换本地分支…")).setIcon("git-branch").setDisabled(this.plugin.busy).onClick(() => chooseBranch(this.plugin)));
      menu.addItem((item) => item.setTitle(t("创建并切换分支")).setIcon("git-branch-plus").setDisabled(this.plugin.busy).onClick(() => createBranch(this.plugin)));
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
    await this.plugin.refreshSource();
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
    const snapshot = JSON.stringify([status, busy, error, [...this.collapsed], this.plugin.settings.language]);
    if (this.renderSnapshot === snapshot) return;
    this.renderSnapshot = snapshot;
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
    if (this.sortLanguage !== this.plugin.settings.language) {
      this.sortLanguage = this.plugin.settings.language;
      this.collator = new Intl.Collator(this.sortLanguage === "en" ? "en" : "zh-CN", { numeric: true });
    }
    const compare = this.collator.compare;
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
      row.addEventListener("contextmenu", event => {
        event.preventDefault(); event.stopPropagation();
        const menu = new Menu();
        this.plugin.addFileHistoryMenu(menu, file.path);
        menu.showAtMouseEvent(event);
      });
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
        this.treeEl.querySelector(".vaultbranch-file-row.is-selected")?.classList.remove("is-selected");
        row.classList.add("is-selected");
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

module.exports = { SourceControlView };
