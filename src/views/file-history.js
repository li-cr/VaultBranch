"use strict";

const { t } = require("../i18n.js");
const { FILE_HISTORY_VIEW, GitView, el, button } = require("./shared.js");
const { readOnlyMerge, updateCollapse, updateDiffNavigation } = require("./merge.js");
const { updateSyntaxHighlight } = require("./highlight.js");
const { drawGraph } = require("./graph.js");

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
  updateSyntaxHighlight() { return updateSyntaxHighlight(this); }
  async onClose() {
    this.detailRequest++;
    this.destroyMerge();
    await super.onClose();
  }

  async render() {
    const request = ++this.request;
    this.detailRequest++;
    this.loading = true;
    this.contentEl.inert = true;
    this.contentEl.setAttribute("aria-busy", "true");
    let data, prepared;
    try {
      if (this.filePath) {
        await this.plugin.ensureReady();
        data = await this.plugin.git.fileHistory(this.filePath, { all: this.all, limit: this.limit, graph: true });
        if (request !== this.request) return;
        const commit = data.commits.find(commit => commit.hash === this.selected) || data.commits[0];
        if (commit) {
          try { prepared = { versions: await this.plugin.git.comparisonVersions(commit, "history") }; }
          catch (error) { prepared = { error }; }
        }
      }
    } catch (error) { prepared = { error }; }
    if (request !== this.request) return;
    const scroll = this.contentEl.querySelector(".vaultbranch-file-history-sidebar")?.scrollTop || 0;
    this.destroyMerge();
    this.contentEl.empty();
    this.loading = false;
    this.contentEl.inert = false;
    this.contentEl.removeAttribute("aria-busy");
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
    try {
      if (!data) throw prepared.error;
      this.commits = data.commits;
      if (!data.commits.length) { el(list, "div", "vaultbranch-empty", t("没有文件历史。")); return; }
      const width = Math.max(28, Math.max(...data.commits.map(commit => commit.width)) * 16 + 12);
      list.style.setProperty("--vaultbranch-file-graph-width", `${width}px`);
      this.selectedRow = null;
      this.rows = data.commits.map((commit, index) => {
        const row = el(list, "button", "vaultbranch-file-history-entry");
        row.type = "button";
        row.setAttribute("aria-pressed", "false");
        row.title = `${commit.subject}\n${commit.hash}\n${commit.author} · ${commit.date}\n${commit.oldPath ? commit.oldPath + " → " : ""}${commit.path}`;
        drawGraph(row, commit, width, 68);
        const text = el(row, "div", "vaultbranch-file-history-text");
        el(text, "div", "vaultbranch-file-history-subject", commit.subject);
        el(text, "div", "vaultbranch-file-history-meta", `${commit.short} · ${commit.author}`);
        el(text, "div", "vaultbranch-file-history-meta", new Date(commit.date).toLocaleString(this.plugin.settings.language === "zh" ? "zh-CN" : "en"));
        row.addEventListener("click", () => { void this.selectCommit(commit); });
        row.addEventListener("keydown", event => {
          const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : -1;
          if (next < 0 || next >= this.rows.length) return;
          event.preventDefault(); this.rows[next].focus(); this.rows[next].click();
        });
        return row;
      });
      if (data.hasMore) button(sidebar, "chevrons-down", t("加载更多"), () => { this.limit += 50; return this.render(); }, t("加载更多"));
      await this.selectCommit(data.commits.find(commit => commit.hash === this.selected) || data.commits[0], prepared);
      sidebar.scrollTop = scroll;
    } catch (error) {
      if (request === this.request) { list.replaceChildren(); el(list, "div", "vaultbranch-empty is-error", error.message); }
    }
  }

  async selectCommit(commit, prepared) {
    if (this.loading) return;
    const request = ++this.detailRequest;
    const details = this.detailsEl;
    details.inert = true;
    details.setAttribute("aria-busy", "true");
    let versions, failure;
    try {
      if (prepared?.error) throw prepared.error;
      versions = prepared ? prepared.versions : await this.plugin.git.comparisonVersions(commit, "history");
    } catch (error) { failure = error; }
    if (request !== this.detailRequest || details !== this.detailsEl) return;
    this.destroyMerge();
    this.selected = commit.hash;
    const row = this.rows[this.commits.indexOf(commit)];
    if (this.selectedRow !== row) {
      this.selectedRow?.classList.remove("is-selected");
      this.selectedRow?.setAttribute("aria-pressed", "false");
      row.classList.add("is-selected");
      row.setAttribute("aria-pressed", "true");
      this.selectedRow = row;
    }
    this.app.workspace.requestSaveLayout();
    details.replaceChildren();
    const description = el(details, "div", "vaultbranch-diff-description", `${commit.short} · ${commit.subject}`);
    description.title = t("相对第一父提交，只读");
    el(details, "div", "vaultbranch-file-history-path", commit.oldPath ? `${commit.oldPath} → ${commit.path}` : commit.path);
    const body = el(details, "div", "vaultbranch-diff-body");
    try {
      if (failure) throw failure;
      this.merge = readOnlyMerge(body, versions, [t("父提交（只读）"), t("当前提交（只读）")], this.plugin.settings);
      this.highlightPath = commit.path;
      this.collapseEnabled = Boolean(this.plugin.settings.collapseUnchanged);
      this.updateDiffNavigation();
      void this.updateSyntaxHighlight();
    } catch (error) {
      body.replaceChildren(); el(body, "div", "vaultbranch-empty is-error", error.message);
    } finally {
      details.inert = false;
      details.removeAttribute("aria-busy");
    }
  }
}

module.exports = { FileHistoryView };
