"use strict";

const { t } = require("../i18n.js");
const { FILE_HISTORY_VIEW, GitView, el, button } = require("./shared.js");
const { readOnlyMerge, updateCollapse, updateDiffNavigation } = require("./merge.js");

class FileHistoryView extends GitView {
  constructor(leaf, plugin) {
    super(leaf, plugin);
    this.filePath = "";
    this.all = false;
    this.limit = 50;
    this.selected = "";
    this.detailRequest = 0;
  }

  getViewType() { return FILE_HISTORY_VIEW; }
  getDisplayText() { return this.filePath ? `${this.filePath.split("/").at(-1)} · ${t("文件历史")}` : t("文件历史"); }
  getIcon() { return "history"; }
  getState() { return { filePath: this.filePath, all: this.all, limit: this.limit, selected: this.selected }; }
  async setState(state, result) {
    this.filePath = state.filePath || "";
    this.all = Boolean(state.all);
    this.limit = Math.max(50, Math.min(1000, Number(state.limit) || 50));
    this.selected = state.selected || "";
    await this.render();
    await super.setState(state, result);
  }

  destroyMerge() { this.merge?.destroy(); this.merge = null; this.updateDiffNavigation(); }
  updateCollapse() { updateCollapse(this); }
  updateDiffNavigation() { updateDiffNavigation(this); }
  async onClose() {
    this.detailRequest++;
    this.destroyMerge();
    await super.onClose();
  }

  async render() {
    const request = ++this.request;
    this.detailRequest++;
    this.destroyMerge();
    this.contentEl.empty();
    if (!this.filePath) { el(this.contentEl, "div", "vaultbranch-empty", t("请选择文件查看历史。")); return; }
    const header = el(this.contentEl, "div", "vaultbranch-diff-header");
    const path = el(header, "div", "vaultbranch-diff-path", this.filePath);
    path.title = this.filePath;
    const scope = el(header, "select", "vaultbranch-history-scope");
    scope.setAttribute("aria-label", t("历史范围"));
    for (const [value, label] of [["current", "当前分支"], ["all", "全部分支"]]) {
      const option = el(scope, "option", "", t(label)); option.value = value;
    }
    scope.value = this.all ? "all" : "current";
    scope.addEventListener("change", () => {
      this.all = scope.value === "all"; this.limit = 50; this.selected = "";
      void this.render();
    });
    button(header, "refresh-cw", t("刷新文件历史"), () => this.render());
    const layout = el(this.contentEl, "div", "vaultbranch-file-history-layout");
    const sidebar = el(layout, "div", "vaultbranch-file-history-sidebar");
    const list = el(sidebar, "div", "vaultbranch-file-history-list");
    list.setAttribute("aria-label", t("文件历史"));
    this.detailsEl = el(layout, "div", "vaultbranch-file-history-details");
    el(list, "div", "vaultbranch-empty", t("读取历史中…"));
    try {
      await this.plugin.ensureReady();
      const data = await this.plugin.git.fileHistory(this.filePath, { all: this.all, limit: this.limit });
      if (request !== this.request) return;
      list.replaceChildren();
      this.commits = data.commits;
      if (!data.commits.length) { el(list, "div", "vaultbranch-empty", t("没有文件历史。")); return; }
      this.rows = data.commits.map((commit, index) => {
        const row = el(list, "button", "vaultbranch-file-history-entry");
        row.type = "button";
        row.title = `${commit.subject}\n${commit.author} · ${commit.date}\n${commit.path}`;
        el(row, "div", "vaultbranch-file-history-subject", commit.subject);
        el(row, "div", "vaultbranch-file-history-meta", `${commit.short} · ${commit.author}`);
        el(row, "div", "vaultbranch-file-history-meta", new Date(commit.date).toLocaleString(this.plugin.settings.language === "zh" ? "zh-CN" : "en"));
        if (commit.oldPath || commit.path !== this.filePath) el(row, "div", "vaultbranch-file-history-rename", commit.oldPath ? `${commit.oldPath} → ${commit.path}` : commit.path);
        row.addEventListener("click", () => { void this.selectCommit(commit); });
        row.addEventListener("keydown", event => {
          const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : -1;
          if (next < 0 || next >= this.rows.length) return;
          event.preventDefault(); this.rows[next].focus(); this.rows[next].click();
        });
        return row;
      });
      if (data.hasMore) button(sidebar, "chevrons-down", t("加载更多"), () => { this.limit += 50; return this.render(); }, t("加载更多"));
      await this.selectCommit(data.commits.find(commit => commit.hash === this.selected) || data.commits[0]);
    } catch (error) {
      if (request === this.request) { list.replaceChildren(); el(list, "div", "vaultbranch-empty is-error", error.message); }
    }
  }

  async selectCommit(commit) {
    const request = ++this.detailRequest;
    const details = this.detailsEl;
    this.destroyMerge();
    this.selected = commit.hash;
    this.rows.forEach((row, index) => {
      const active = this.commits[index].hash === commit.hash;
      row.classList.toggle("is-selected", active);
      row.setAttribute("aria-pressed", String(active));
    });
    this.app.workspace.requestSaveLayout();
    details.replaceChildren();
    const description = el(details, "div", "vaultbranch-diff-description", `${commit.short} · ${commit.subject}`);
    description.title = t("相对第一父提交，只读");
    el(details, "div", "vaultbranch-file-history-path", commit.oldPath ? `${commit.oldPath} → ${commit.path}` : commit.path);
    const body = el(details, "div", "vaultbranch-diff-body");
    el(body, "div", "vaultbranch-empty", t("读取差异中…"));
    try {
      const versions = await this.plugin.git.comparisonVersions(commit, "history");
      if (request !== this.detailRequest || details !== this.detailsEl) return;
      body.replaceChildren();
      this.merge = readOnlyMerge(body, versions, [t("父提交（只读）"), t("当前提交（只读）")], this.plugin.settings);
      this.collapseEnabled = Boolean(this.plugin.settings.collapseUnchanged);
      this.updateDiffNavigation();
    } catch (error) {
      if (request !== this.detailRequest) return;
      body.replaceChildren(); el(body, "div", "vaultbranch-empty is-error", error.message);
    }
  }
}

module.exports = { FileHistoryView };
