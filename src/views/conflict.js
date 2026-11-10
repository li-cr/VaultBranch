"use strict";

const { t } = require("../i18n.js");
const { CONFLICT_VIEW, el, button, GitView } = require("./shared.js");

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

module.exports = { ConflictView };
