"use strict";

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { t, setLanguage } = require("../src/i18n.js");

afterEach(() => setLanguage("zh"));

test("language selection translates controls and interpolated errors without altering user content", () => {
  setLanguage("en");
  assert.equal(t("撤销更改"), "Discard changes");
  assert.equal(t("界面语言"), "Language");
  assert.equal(t("切换本地分支…"), "Switch local branch…");
  assert.equal(t("从此提交创建分支…"), "Create branch from this commit…");
  assert.equal(t`正在进行 ${"rebase"}。请先解决冲突并继续，或中止当前操作。`, "A rebase is in progress. Resolve conflicts and continue, or abort the current operation.");
  const userMessage = "笔记 {1} $& `example`";
  assert.equal(t`最终提交说明：${userMessage}`, `Final commit message: ${userMessage}`);
  assert.equal(t("unknown output"), "unknown output");
  assert.match(t("支持 {{date}} 和 {{hostname}}；提交时自动加在手写说明前。留空关闭前缀。"), /\{\{date\}\}.*\{\{hostname\}\}/);
  setLanguage("zh");
  assert.equal(t("撤销更改"), "撤销更改");
  assert.equal(t`最终提交说明：${userMessage}`, `最终提交说明：${userMessage}`);
});

test("an unsupported language falls back to Chinese", () => {
  setLanguage("en");
  setLanguage("unexpected");
  assert.equal(t("取消"), "取消");
});
