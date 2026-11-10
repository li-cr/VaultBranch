"use strict";

const { FuzzySuggestModal, Modal, Setting, Notice } = require("obsidian");
const { t } = require("./i18n.js");
const { el, button } = require("./views/shared.js");

class BranchPicker extends FuzzySuggestModal {
  constructor(plugin, branches) {
    super(plugin.app);
    this.plugin = plugin; this.branches = branches;
    this.setPlaceholder(t("切换本地分支…"));
  }
  getItems() { return this.branches; }
  getItemText(branch) { return branch.name + (branch.current ? t("（当前分支）") : ""); }
  onChooseItem(branch) {
    if (!branch.current) void this.plugin.mutate(t("切换分支"), () => this.plugin.git.switchBranch(branch.name));
  }
}

async function chooseBranch(plugin) {
  await plugin.ensureReady();
  const branches = await plugin.git.localBranches();
  if (!branches.length) { new Notice(t("还没有本地分支，请先提交。")); return; }
  new BranchPicker(plugin, branches).open();
}

function createBranch(plugin, commit = null) {
  const modal = new Modal(plugin.app);
  modal.titleEl.textContent = t("创建并切换分支");
  el(modal.contentEl, "p", "", commit ? t`起点：${commit.short} · ${commit.subject}` : t("从当前提交创建新分支并切换，保留可兼容的工作区修改。"));
  let name = "", field;
  new Setting(modal.contentEl).setName(t("分支名")).addText(input => {
    field = input.inputEl; input.setPlaceholder("feature/notes").onChange(value => { name = value.trim(); });
  });
  const actions = el(modal.contentEl, "div", "vaultbranch-confirm-actions");
  button(actions, null, t("取消"), () => modal.close(), t("取消"));
  const submit = button(actions, "git-branch-plus", t("创建并切换"), async () => {
    submit.disabled = true;
    try { if (await plugin.mutate(t("创建分支"), () => plugin.git.createBranch(name, commit?.hash || ""))) modal.close(); }
    finally { submit.disabled = false; }
  }, t("创建并切换"));
  submit.classList.add("mod-cta");
  field.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); if (!submit.disabled) submit.click(); } });
  modal.open(); field.focus();
}

module.exports = { chooseBranch, createBranch };
