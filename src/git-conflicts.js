"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { t } = require("./i18n.js");
const { MAX_PREVIEW } = require("./git-limits.js");

async function rebaseOnto(git, hash) {
  git.checkCommit(hash);
  const status = await git.status();
  git.assertNormal(status);
  if (status.files.length) throw new Error(t("Rebase 前请先提交或 Stash 当前修改。"));
  await git.run(["symbolic-ref", "--quiet", "HEAD"]);
  return git.run(["rebase", "--no-autostash", hash], { timeout: 120000 });
}

async function conflictVersions(git, filePath) {
  git.checkPaths([filePath]);
  const status = await git.status();
  if (!status.files.some((file) => file.path === filePath && file.conflict)) throw new Error(t("该文件已不处于冲突状态，请刷新。"));
  const stages = (await git.run(["ls-files", "--unmerged", "-z", "--", filePath])).split("\0").filter(Boolean);
  const versions = { base: null, ours: null, theirs: null, binary: false };
  for (const record of stages) {
    const match = record.match(/^(\d+) ([a-f0-9]+) ([123])\t/);
    if (!match) continue;
    const size = Number((await git.run(["cat-file", "-s", match[2]])).trim());
    if (size > MAX_PREVIEW) throw new Error(t("冲突文件超过 2 MB，请使用外部工具解决。"));
    const text = await git.run(["show", `:${match[3]}:${filePath}`]);
    if (text.includes("\0")) versions.binary = true;
    versions[{ 1: "base", 2: "ours", 3: "theirs" }[match[3]]] = text;
  }
  let result = "";
  try {
    const absolute = path.resolve(git.root, filePath);
    if ((await fs.stat(absolute)).size > MAX_PREVIEW) throw new Error(t("冲突文件超过 2 MB，请使用外部工具解决。"));
    result = await fs.readFile(absolute, "utf8");
    if (result.includes("\0")) versions.binary = true;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (versions.binary) throw new Error(t("二进制冲突请使用外部工具解决。"));
  return { ...versions, result, operation: status.operation,
    oursLabel: status.operation === "rebase" ? t("上游版本") : t("本地版本"),
    theirsLabel: status.operation === "rebase" ? t("本地版本") : t("传入版本") };
}

async function resolveConflict(git, filePath, content, expected) {
  git.checkPaths([filePath]);
  if (/^(<{7}|={7}|>{7}|\|{7})(?: |$)/m.test(content)) throw new Error(t("结果中仍有冲突标记，请编辑完成后再标记已解决。"));
  const versions = await git.conflictVersions(filePath);
  if (expected !== undefined && versions.result !== expected) throw new Error(t("冲突文件已被其他编辑器修改，请重新打开冲突视图。"));
  if (versions.ours === null || versions.theirs === null) throw new Error(t("涉及删除的冲突请在外部工具中处理，再暂存结果。"));
  const absolute = path.resolve(git.root, filePath);
  const [actualParent, realRoot] = await Promise.all([fs.realpath(path.dirname(absolute)), fs.realpath(git.root)]);
  const relative = path.relative(realRoot, actualParent);
  if (relative.startsWith("..") || path.isAbsolute(relative) || (await fs.lstat(absolute)).isSymbolicLink()) throw new Error(t("不支持通过符号链接写入冲突结果。"));
  await fs.writeFile(absolute, content, "utf8");
  await git.stage([filePath]);
}

async function continueOperation(git) {
  const status = await git.status();
  if (status.files.some((file) => file.conflict)) throw new Error(t("仍有未解决的冲突。"));
  const unstaged = status.files.filter((file) => !file.untracked && file.worktree !== " ");
  if (unstaged.length) throw new Error(t`还有未暂存的修改，请先处理后再继续：\n${unstaged.map((file) => file.path).join("\n")}\n这些修改不会被自动加入冲突提交。`);
  if (status.operation === "rebase") return git.run(["rebase", "--continue"], { timeout: 120000 });
  if (status.operation === "merge") return git.run(["commit", "--no-edit"], { timeout: 120000 });
  throw new Error(t("当前没有可继续的 rebase / merge。"));
}

async function abortOperation(git) {
  const status = await git.status();
  if (status.operation === "rebase" || status.operation === "merge") return git.run([status.operation, "--abort"]);
  throw new Error(t("当前没有可中止的 rebase / merge。"));
}

module.exports = { rebaseOnto, conflictVersions, resolveConflict, continueOperation, abortOperation };
