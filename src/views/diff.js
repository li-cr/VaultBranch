"use strict";

const { Notice, Scope, Modal } = require("obsidian");
const { MergeView } = require("@codemirror/merge");
const { EditorState, Compartment, Transaction } = require("@codemirror/state");
const { EditorView, keymap, lineNumbers, drawSelection } = require("@codemirror/view");
const { history, historyKeymap, defaultKeymap, indentWithTab } = require("@codemirror/commands");
const { normalize } = require("../autosave.js");
const { t } = require("../i18n.js");
const { DIFF_VIEW, LABELS, el, button, GitView } = require("./shared.js");
const { collapseOptions, updateCollapse, readOnlyMerge } = require("./merge.js");

class DiffView extends GitView {
  constructor(leaf, plugin) {
    super(leaf, plugin);
    this.file = null;
    this.area = "unstaged";
    this.unified = false;
    this.graphReturn = null;
    this.stateRequest = 0;
    this.editable = new Compartment();
    this.editScope = new Scope(this.app.scope);
    this.editScope.register(["Mod"], "s", () => {
      void this.saveEditor().catch((error) => new Notice(error.message));
      return false;
    });
  }

  getViewType() { return DIFF_VIEW; }
  getDisplayText() { return this.file ? `${this.file.path.split("/").at(-1)} · ${t(LABELS[this.area])}` : t("VaultBranch · 差异"); }
  getIcon() { return "git-compare"; }
  getState() { return { file: this.file, area: this.area, unified: this.unified, graphReturn: this.graphReturn, editDraft: this.area === "unstaged" ? this.plugin.diffDrafts.get(this.file?.path) : undefined }; }
  async setState(state, result) {
    const request = ++this.stateRequest;
    this.request++;
    await this.session?.autoFlush();
    if (request !== this.stateRequest) return;
    this.destroyEditor();
    this.file = state.file || null;
    this.area = LABELS[state.area] ? state.area : "unstaged";
    this.unified = Boolean(state.unified);
    this.graphReturn = this.area === "history" ? state.graphReturn || null : null;
    const draft = state.editDraft;
    if (this.area === "unstaged" && this.file && draft && ["index", "working", "text"].every((key) => typeof draft[key] === "string") && !this.plugin.diffDrafts.has(this.file.path)) {
      this.plugin.diffDrafts.set(this.file.path, draft);
    }
    this.plugin.setGraphReturn(this.leaf, this.file?.path, this.graphReturn);
    await this.render();
    await super.setState(state, result);
  }

  async onClose() {
    this.stateRequest++;
    this.request++;
    await this.session?.autoFlush();
    this.destroyEditor();
    this.app.keymap.popScope(this.editScope);
    const draft = this.plugin.diffDrafts.get(this.file?.path);
    if (draft && draft.text !== draft.working.replace(/\r\n?/g, "\n")) {
      new Notice(t("未保存的草稿会在本次会话中保留，重新打开此文件可继续编辑。"));
    }
    await super.onClose();
  }

  async render() {
    if (this.merge && this.session) {
      this.updateEditor();
      await this.session.sync();
      return;
    }
    this.destroyEditor();
    const request = ++this.request;
    this.app.keymap.popScope(this.editScope);
    this.contentEl.empty();
    if (!this.file) { el(this.contentEl, "div", "vaultbranch-empty", t("在 VaultBranch 侧栏选择文件查看差异。")); return; }
    const header = el(this.contentEl, "div", "vaultbranch-diff-header");
    if (this.area === "history") button(header, "arrow-left", t("返回 Git Graph"), () => this.plugin.returnToGraph(this.graphReturn), "Git Graph");
    el(header, "div", "vaultbranch-diff-path", this.file.path);
    el(header, "span", "vaultbranch-tag", t(LABELS[this.area]));
    button(header, "file-pen-line", t("打开文件"), () => this.plugin.openFile(this.file.path, this.graphReturn));
    const editable = this.area === "unstaged" && this.file.worktree !== "D";
    if (!editable) {
      button(header, this.unified ? "columns-2" : "list", this.unified ? t("切换左右对比") : t("切换统一差异"), async () => { this.unified = !this.unified; await this.render(); });
      button(header, "refresh-cw", t("刷新差异"), () => this.render());
    }
    el(this.contentEl, "div", "vaultbranch-diff-description", this.area === "history" ? t`提交 ${this.file.commit.slice(0, 8)} · 相对第一父提交` : this.area === "staged" ? t("HEAD → 暂存区") : t("暂存区 → 工作区"));
    const body = el(this.contentEl, "div", "vaultbranch-diff-body");
    el(body, "div", "vaultbranch-empty", t("读取差异中…"));
    try {
      await this.plugin.ensureReady();
      if (editable) {
        try {
          const filePath = this.file.path;
          const session = await this.plugin.editorSession(filePath, true);
          if (request !== this.request) { this.plugin.releaseEditorSession(filePath, session); return; }
          this.session = session;
          body.replaceChildren();
          this.renderEditor(body);
          await session.sync();
          return;
        } catch (error) {
          if (request !== this.request) return;
          el(this.contentEl, "div", "vaultbranch-editor-warning", error.message);
        }
      }
      if (!this.unified && ["history", "staged"].includes(this.area)) {
        try {
          const versions = await this.plugin.git.comparisonVersions(this.file, this.area);
          if (request !== this.request) return;
          body.replaceChildren();
          this.merge = readOnlyMerge(body, versions, this.area === "history" ? [t("父提交"), t("当前提交")] : ["HEAD", t("暂存区（只读）")], this.plugin.settings);
          this.collapseEnabled = Boolean(this.plugin.settings.collapseUnchanged);
          return;
        } catch (error) {
          if (request !== this.request) return;
          el(this.contentEl, "div", "vaultbranch-editor-warning", error.message);
        }
      }
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

  destroyEditor() {
    const session = this.session;
    session?.listeners.delete(this.editorListener);
    this.merge?.destroy();
    this.merge = null;
    this.session = null;
    this.editorText = this.editorIndex = this.editorListener = null;
    this.warningEl = this.saveButton = this.leftCaption = this.rightCaption = null;
    if (session) this.plugin.releaseEditorSession(this.file.path, session);
    this.app.keymap.popScope(this.editScope);
  }

  renderEditor(body) {
    body.classList.add("has-editor");
    this.warningEl = el(body, "div", "vaultbranch-editor-warning");
    this.saveButton = button(this.contentEl.querySelector(".vaultbranch-diff-header"), "save", t("保存文件 · Ctrl/Cmd+S"), () => this.saveEditor(), t("保存"));
    const captions = el(body, "div", "vaultbranch-diff-captions");
    this.leftCaption = el(captions, "span");
    this.rightCaption = el(captions, "span");
    const panes = el(body, "div", "vaultbranch-edit-panes");
    const common = [lineNumbers(), drawSelection(), EditorState.tabSize.of(4)];
    this.merge = new MergeView({
      parent: panes, root: body.ownerDocument,
      a: { doc: normalize(this.session.draft.index), extensions: [common, EditorState.readOnly.of(true), EditorView.editable.of(false)] },
      b: { doc: this.session.draft.text, extensions: [common, history(),
        keymap.of([{ key: "Mod-s", run: () => { void this.saveEditor(); return true; } }, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        this.editable.of(this.editorAccess()),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !this.syncingEditor) {
            this.editorText = update.state.doc.toString();
            this.session.edit(this.editorText);
          }
        }),
        EditorView.domEventHandlers({
          focus: () => { this.app.keymap.pushScope(this.editScope); },
          blur: () => { this.app.keymap.popScope(this.editScope); },
        }),
      ] },
      highlightChanges: true, gutter: true, ...collapseOptions(this.plugin.settings),
    });
    this.collapseEnabled = Boolean(this.plugin.settings.collapseUnchanged);
    this.editorText = this.session.draft.text;
    this.editorIndex = this.session.draft.index;
    this.editorListener = () => this.updateEditor();
    this.session.listeners.add(this.editorListener);
    this.updateEditor();
  }

  editorAccess() {
    const locked = Boolean(this.plugin.busy || this.plugin.mutationPending);
    return [EditorState.readOnly.of(locked), EditorView.editable.of(!locked)];
  }

  updateEditor() {
    updateCollapse(this);
    if (!this.merge || !this.session) return;
    const { draft, error, saving, dirty } = this.session;
    this.syncingEditor = true;
    try {
      if (this.editorIndex !== draft.index) {
        this.merge.a.dispatch({ changes: { from: 0, to: this.merge.a.state.doc.length, insert: normalize(draft.index) }, annotations: Transaction.addToHistory.of(false) });
        this.editorIndex = draft.index;
      }
      if (this.editorText !== draft.text) {
        this.merge.b.dispatch({ changes: { from: 0, to: this.merge.b.state.doc.length, insert: draft.text }, annotations: Transaction.addToHistory.of(false) });
        this.editorText = draft.text;
      }
      const locked = Boolean(this.plugin.busy || this.plugin.mutationPending);
      if (this.merge.b.state.readOnly !== locked) this.merge.b.dispatch({ effects: this.editable.reconfigure(this.editorAccess()) });
    } finally { this.syncingEditor = false; }
    this.leftCaption.textContent = t("暂存区（只读）");
    this.rightCaption.textContent = saving ? t("工作区 · 正在保存…") : dirty ? t("工作区 · 未保存") : this.session.enabled ? t("工作区 · 已自动保存") : t("工作区 · 已保存");
    this.saveButton.disabled = !dirty || saving || this.plugin.busy || this.plugin.mutationPending;
    this.merge.a.contentDOM.setAttribute("aria-label", t("暂存区（只读）"));
    this.merge.b.contentDOM.setAttribute("aria-label", t("工作区（可编辑）"));
    this.warningEl.hidden = !error;
    if (this.warningEl.dataset.error !== error || this.warningEl.dataset.language !== this.plugin.settings.language) {
      this.warningEl.dataset.error = error;
      this.warningEl.dataset.language = this.plugin.settings.language;
      this.warningEl.replaceChildren();
      if (error) {
        el(this.warningEl, "span", "", error);
        button(this.warningEl, "file-text", t("核对磁盘文件"), () => this.plugin.openFile(this.file.path), t("核对磁盘文件"));
        button(this.warningEl, "refresh-cw", t("重试自动保存"), () => this.session.retry(), t("重试自动保存"));
        button(this.warningEl, "undo-2", t("放弃草稿并重新载入"), () => this.reloadEditor(), t("放弃草稿并重新载入"));
      }
    }
  }

  updateCollapse() { updateCollapse(this); }

  saveEditor(automatic = false) { return (automatic ? this.session?.autoFlush() : this.session?.flush()) || Promise.resolve(true); }

  reloadEditor() {
    const session = this.session;
    const modal = new Modal(this.app);
    modal.titleEl.textContent = t("放弃草稿并重新载入？");
    el(modal.contentEl, "p", "", t("保留磁盘上的文件，放弃此差异编辑器中尚未保存的输入。"));
    const actions = el(modal.contentEl, "div", "vaultbranch-confirm-actions");
    button(actions, null, t("取消"), () => modal.close(), t("取消"));
    button(actions, null, t("放弃草稿"), async () => { modal.close(); await session.reload(); }, t("放弃草稿")).classList.add("mod-warning");
    modal.open();
  }
}

module.exports = { DiffView };
