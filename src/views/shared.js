"use strict";

const { ItemView, Notice, setIcon } = require("obsidian");

const SOURCE_VIEW = "vaultbranch-source-control";
const DIFF_VIEW = "vaultbranch-diff";
const HISTORY_VIEW = "vaultbranch-history";
const CONFLICT_VIEW = "vaultbranch-conflict";
const DEFAULT_SETTINGS = require("../../default-settings.json");
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

class GitView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.request = 0; }
  async onOpen() { this.contentEl.addClass(this.getViewType()); await this.render(); }
  async onClose() { this.request++; }
}

module.exports = { SOURCE_VIEW, DIFF_VIEW, HISTORY_VIEW, CONFLICT_VIEW, DEFAULT_SETTINGS, LABELS, STATUS_LABELS, el, button, GitView };
