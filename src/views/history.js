"use strict";

const { Menu } = require("obsidian");
const { t } = require("../i18n.js");
const { HISTORY_VIEW, el, button, GitView } = require("./shared.js");
const { chooseBranch, createBranch } = require("../branches.js");

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

class HistoryView extends GitView {
  constructor(leaf, plugin) { super(leaf, plugin); this.limit = plugin.settings.historyLimit; this.selected = ""; this.query = ""; this.ref = ""; this.detailRequest = 0; }
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
  async onClose() { this.detailRequest++; this.renderedData = null; await super.onClose(); }
  async render(force = false) {
    const request = ++this.request;
    this.detailRequest++;
    this.contentEl.inert = true;
    this.contentEl.setAttribute("aria-busy", "true");
    try {
      await this.plugin.ensureReady();
      const data = await this.plugin.git.historyData(this.limit, this.ref, force);
      if (request !== this.request) return;
      const snapshot = JSON.stringify([this.plugin.settings.language, this.plugin.busy, this.selected, this.query, this.ref, this.limit]);
      if (data === this.renderedData && snapshot === this.renderedSnapshot && this.bodyEl?.isConnected) return;
      const scroll = { top: this.bodyEl?.scrollTop || 0, left: this.bodyEl?.scrollLeft || 0, detail: this.detailsEl?.scrollTop || 0 };
      const page = this.contentEl.ownerDocument.createElement("div");
      const toolbar = el(page, "div", "vaultbranch-history-toolbar");
      el(toolbar, "strong", "", "Git Graph");
      button(toolbar, "git-branch", t("切换本地分支…"), () => chooseBranch(this.plugin));
      button(toolbar, "git-branch-plus", t("创建并切换分支"), () => createBranch(this.plugin));
      const branch = el(toolbar, "select", "vaultbranch-history-filter");
      branch.setAttribute("aria-label", t("历史分支"));
      el(branch, "option", "", t("全部分支")).value = "";
      const search = el(toolbar, "input", "vaultbranch-history-search");
      search.type = "search"; search.placeholder = t("搜索提交…"); search.value = this.query;
      search.setAttribute("aria-label", t("搜索提交"));
      button(toolbar, "download", "Fetch", () => this.plugin.runGit("fetch"));
      button(toolbar, "arrow-up", t("Push 当前分支"), () => this.plugin.runGit("push"));
      button(toolbar, "archive", t("Stash 当前修改（含未跟踪文件）"), () => this.plugin.runGit("stash"));
      button(toolbar, "refresh-cw", t("刷新历史"), () => this.render(true));
      const body = el(page, "div", "vaultbranch-history-body");
      const details = el(page, "div", "vaultbranch-history-details");
      const { commits, branches, hasStash } = data;
      if (request !== this.request) return;
      for (const ref of branches) el(branch, "option", "", ref).value = ref;
      if (hasStash) el(branch, "option", "", t("stash（临时修改）")).value = "stash";
      branch.value = this.ref;
      branch.addEventListener("change", () => { this.ref = branch.value; void this.render(); });
      if (!commits.length) {
        el(body, "div", "vaultbranch-empty", t("还没有提交。"));
        this.contentEl.replaceChildren(...page.childNodes);
        this.bodyEl = body; this.detailsEl = details;
        return;
      }
      const columns = Math.max(...commits.map((commit) => commit.width));
      const width = Math.max(36, columns * 16 + 14);
      body.style.setProperty("--vaultbranch-graph-width", `${Math.max(width, 70)}px`);
      const headings = el(body, "div", "vaultbranch-history-columns");
      for (const label of [t("分支图"), t("提交说明"), t("日期"), t("作者"), t("提交")]) el(headings, "span", "", label);
      const rows = [];
      const batch = document.createDocumentFragment();
      for (const commit of commits) {
        const row = el(batch, "button", "vaultbranch-history-row");
        rows.push(row);
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
          const detailRequest = ++this.detailRequest;
          details.inert = true;
          details.setAttribute("aria-busy", "true");
          let files, failure;
          try { files = commit.stash ? await this.plugin.git.stashFiles(commit.hash) : await this.plugin.git.commitFiles(commit.hash); }
          catch (error) { failure = error; }
          if (detailRequest !== this.detailRequest || (this.bodyEl !== body && request !== this.request)) return;
          this.selected = commit.hash;
          for (const item of rows) item.classList.toggle("is-selected", item === row);
          details.replaceChildren();
          el(details, "div", "vaultbranch-history-detail-title", `${commit.short} · ${commit.subject}`);
          const actions = el(details, "div", "vaultbranch-history-actions");
          for (const action of this.actionsFor(commit)) {
            button(actions, action.icon, action.title, action.run, action.title).disabled = this.plugin.busy;
          }
          try {
            if (failure) throw failure;
            for (const file of files) button(details, "file-diff", `${file.index} ${file.path}`, () => this.plugin.openDiff(file, "history", this.captureNavigation()), `${file.index}  ${file.path}`);
            if (!files.length) el(details, "div", "vaultbranch-empty", t("此提交相对第一父提交没有文件改动。"));
          } catch (error) { el(details, "div", "is-error", error.message); }
          finally { details.inert = false; details.removeAttribute("aria-busy"); }
        };
        if (rows.length % 100 === 0) {
          body.appendChild(batch);
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (request !== this.request) return;
        }
      }
      body.appendChild(batch);
      const applySearch = () => {
        this.query = search.value;
        const query = this.query.trim().toLocaleLowerCase();
        for (const row of rows) {
          const match = !query || row.dataset.search.includes(query);
          row.classList.toggle("is-dimmed", !match);
          row.setAttribute("aria-label", `${match ? "" : t("非搜索匹配：")}${row.title}`);
        }
      };
      search.addEventListener("input", applySearch); applySearch();
      if (commits.length >= this.limit && this.limit < 1000) button(body, "chevrons-down", t("加载更多历史"), async () => { this.limit = Math.min(1000, this.limit + this.plugin.settings.historyLimit); await this.render(); }, t("加载更多"));
      const selectedRow = rows.find((row) => row.dataset.commit === this.selected);
      if (selectedRow) await selectedRow.onclick();
      if (request === this.request) {
        this.contentEl.replaceChildren(...page.childNodes);
        this.bodyEl = body; this.detailsEl = details;
        body.scrollTop = scroll.top; body.scrollLeft = scroll.left; details.scrollTop = scroll.detail;
        this.renderedData = data; this.renderedSnapshot = snapshot;
      }
    } catch (error) {
      if (request === this.request) {
        this.renderedData = null;
        this.contentEl.empty();
        el(this.contentEl, "div", "vaultbranch-empty is-error", error.message);
        button(this.contentEl, "git-branch", t("全部分支"), () => { this.ref = ""; return this.render(true); }, t("全部分支"));
      }
    } finally {
      if (request === this.request) { this.contentEl.inert = false; this.contentEl.removeAttribute("aria-busy"); }
    }
  }

  actionsFor(commit) {
    const p = this.plugin;
    if (commit.stash) return [
      { title: t("应用此 Stash（保留记录）"), icon: "archive-restore", run: () => p.mutate(t("应用 Stash"), () => p.git.stashApply(commit)) },
      { title: t("Pop 此 Stash（恢复并移除）"), icon: "archive-x", run: () => p.mutate("Pop Stash", () => p.git.stashPop(commit)) },
    ];
    return [
      { title: t("从此提交创建分支…"), icon: "git-branch-plus", run: () => createBranch(p, commit) },
      { title: t("Rebase 当前分支到此提交…"), icon: "git-branch", run: () => p.confirmRebase(commit) },
      { title: t("Push 当前分支"), icon: "arrow-up", run: () => p.runGit("push") },
    ];
  }
}

module.exports = { HistoryView };
