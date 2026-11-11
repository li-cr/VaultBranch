"use strict";

const { t } = require("./i18n.js");

async function stashExists(git) {
  try {
    await git.run(["rev-parse", "--verify", "--quiet", "refs/stash"]);
    return true;
  } catch {
    return false;
  }
}

async function stash(git) {
  const status = await git.status();
  git.assertNormal(status);
  if (!status.files.length) throw new Error(t("当前没有需要 Stash 的修改。"));
  return git.run(["stash", "push", "--include-untracked", "--message", "VaultBranch temporary pull stash"]);
}

function stashPop(git, entry = null) { return git.restoreStash(entry, true); }

function stashApply(git, entry) { return git.restoreStash(entry, false); }

async function stashSelector(git, hash) {
  git.checkCommit(hash);
  const fields = (await git.run(["stash", "list", "-z", "--format=%H%x00%gd"])).split("\0");
  for (let i = 0; i + 1 < fields.length; i += 2) if (fields[i] === hash) return fields[i + 1];
  throw new Error(t("这条 Stash 已被移除，请刷新历史后重新选择。"));
}

async function restoreStash(git, entry, remove) {
  const status = await git.status();
  git.assertNormal(status);
  if (status.files.length) throw new Error(t("恢复 Stash 前请保持工作区干净。"));
  if (!status.stash) throw new Error(t("没有可恢复的 Stash。"));
  const hash = entry?.hash || (await git.run(["rev-parse", "refs/stash"])).trim();
  await git.stashSelector(hash);
  try {
    const output = await git.run(["stash", "apply", "--index", hash]);
    if (remove) await git.run(["stash", "drop", await git.stashSelector(hash)]);
    return output;
  } catch (error) {
    throw new Error(t`恢复未完成，Stash 仍保留。请检查文件状态；若出现冲突，在侧栏打开冲突文件解决。\n\n${error.message}`);
  }
}

async function stashFiles(git, hash) {
  const files = await git.commitFiles(hash);
  const parents = (await git.run(["rev-list", "--parents", "-n", "1", hash])).trim().split(" ");
  if (parents[3]) files.push(...await git.commitFiles(parents[3]));
  return files;
}

async function stashHistory(git, limit) {
  const fields = (await git.run(["stash", "list", "-z", `--max-count=${Math.max(1, Math.min(1000, Number(limit) || 100))}`, "--format=%H%x00%gd%x00%gs%x00%P%x00%an%x00%aI"]))
    .split("\0");
  const entries = [];
  for (let i = 0; i + 5 < fields.length; i += 6) {
    const [hash, ref, subject, parents, author, date] = fields.slice(i, i + 6);
    if (!/^[a-f0-9]{40,64}$/.test(hash)) continue;
    entries.push({
      hash, parents: parents.split(" ").filter(Boolean).slice(0, 1), short: hash.slice(0, 7),
      author, date, refs: "stash", stashRef: ref,
      subject: `${ref} · ${subject.replace(/^On [^:]+: /, "")}`, stash: true,
    });
  }
  return entries;
}

module.exports = { stashExists, stash, stashPop, stashApply, stashSelector, restoreStash, stashFiles, stashHistory };
