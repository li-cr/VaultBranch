"use strict";

const { t } = require("./i18n.js");

const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_OUTPUT = 12 * 1024 * 1024;
const MAX_PREVIEW = 2 * 1024 * 1024;
const DIFF_OPTIONS = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--unified=4"];
const CONFLICTS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function graphFor(commits) {
  let lanes = [];
  return commits.map((commit) => {
    if (!lanes.includes(commit.hash)) lanes.push(commit.hash);
    const before = [...lanes];
    const column = lanes.indexOf(commit.hash);
    lanes.splice(column, 1);
    for (let i = 0; i < commit.parents.length; i++) {
      const parent = commit.parents[i];
      if (!lanes.includes(parent)) lanes.splice(Math.min(column + i, lanes.length), 0, parent);
    }
    const edges = [];
    for (let i = 0; i < before.length; i++) {
      if (i !== column) edges.push({ from: i, to: lanes.indexOf(before[i]), through: true });
    }
    for (const parent of commit.parents) edges.push({ from: column, to: lanes.indexOf(parent), through: false });
    return { ...commit, column, before, after: [...lanes], edges, width: Math.max(before.length, lanes.length, 1) };
  });
}

function parseStatus(output) {
  const parts = output.split("\0");
  const files = [];
  let branch = "";
  let upstream = "";
  let ahead = 0;
  let behind = 0;
  for (let i = 0; i < parts.length; i++) {
    const record = parts[i];
    if (!record) continue;
    if (record.startsWith("## ")) {
      const header = record.slice(3);
      const bracket = header.lastIndexOf(" [");
      const ref = bracket === -1 ? header : header.slice(0, bracket);
      const diverged = ref.indexOf("...");
      branch = diverged === -1 ? ref : ref.slice(0, diverged);
      upstream = diverged === -1 ? "" : ref.slice(diverged + 3);
      if (/^(No commits yet on |Initial commit on )/.test(branch)) {
        branch = branch.replace(/^(No commits yet on |Initial commit on )/, "");
      }
      ahead = Number(header.match(/ahead (\d+)/)?.[1] || 0);
      behind = Number(header.match(/behind (\d+)/)?.[1] || 0);
      continue;
    }
    const index = record[0];
    const worktree = record[1];
    const file = { path: record.slice(3), index, worktree, oldPath: null };
    if (index === "R" || index === "C" || worktree === "R" || worktree === "C") {
      file.oldPath = parts[++i];
    }
    file.conflict = CONFLICTS.has(index + worktree);
    file.untracked = index === "?" && worktree === "?";
    files.push(file);
  }
  return { branch, upstream, ahead, behind, files };
}

function groupsFor(files) {
  return {
    conflicts: files.filter((file) => file.conflict),
    staged: files.filter((file) => !file.conflict && !file.untracked && file.index !== " "),
    unstaged: files.filter((file) => !file.conflict && (file.untracked || file.worktree !== " ")),
  };
}

function treeFor(files) {
  const root = { folders: new Map(), files: [] };
  for (const file of files) {
    const segments = file.path.split("/");
    let current = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i];
      if (!current.folders.has(name)) {
        current.folders.set(name, { folders: new Map(), files: [], path: segments.slice(0, i + 1).join("/") });
      }
      current = current.folders.get(name);
    }
    current.files.push(file);
  }
  return root;
}

function splitPatch(patch) {
  const rows = [];
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  let removed = [];
  let added = [];
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      rows.push({ kind: "change", left: removed[i] || null, right: added[i] || null });
    }
    removed = [];
    added = [];
  };
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      inHunk = false;
      rows.push({ kind: "meta", text: line });
      continue;
    }
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      flush();
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      rows.push({ kind: "hunk", text: line });
    } else if (!inHunk) {
      rows.push({ kind: "meta", text: line });
    } else if (line.startsWith("-")) {
      if (added.length) flush();
      removed.push({ line: oldLine++, text: line.slice(1) });
    } else if (line.startsWith("+")) {
      added.push({ line: newLine++, text: line.slice(1) });
    } else if (line.startsWith(" ")) {
      flush();
      rows.push({ kind: "context", left: { line: oldLine++, text: line.slice(1) }, right: { line: newLine++, text: line.slice(1) } });
    } else {
      flush();
      rows.push({ kind: "meta", text: line });
    }
  }
  flush();
  return rows;
}

class GitService {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    this.gitDir = null;
    this.settingsPath = options.settingsPath || ".obsidian/plugins/vaultbranch/data.json";
    this.binary = options.binary || "git";
    this.pullMethod = options.pullMethod === "merge" ? "merge" : "rebase";
  }

  run(args, { timeout = 20000, allowDiffExit = false } = {}) {
    return new Promise((resolve, reject) => {
      execFile(this.binary, ["-c", "core.quotepath=false", "-c", "color.ui=false", ...args], {
        cwd: this.root,
        shell: false,
        windowsHide: true,
        encoding: "utf8",
        timeout,
        maxBuffer: MAX_OUTPUT,
        // Stash uses Git's own pathspecs to remove saved untracked files.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true", GIT_LITERAL_PATHSPECS: ["check-ignore", "stash"].includes(args[0]) ? "0" : "1" },
      }, (error, stdout, stderr) => {
        if (!error || (allowDiffExit && error.code === 1)) return resolve(stdout);
        const detail = error.killed ? t("Git 操作超时；请检查网络、SSH 或凭据配置。") : ([stderr, stdout].filter((value) => value?.trim()).join("\n").trim() || error.message);
        if (/non-fast-forward|fetch first|remote contains work|tip of your current branch is behind/i.test(detail)) {
          reject(new Error(t`Push 被拒绝：远程有新提交。请先 Pull，解决可能的冲突后再 Push。\n\n${detail}`));
        } else if (error.code === "ENOENT") {
          reject(new Error(t("找不到 Git。请安装 Git，或在 VaultBranch 设置中填写 Git 可执行文件的完整路径。")));
        } else reject(new Error(detail));
      });
    });
  }

  async init() {
    const top = (await this.run(["rev-parse", "--show-toplevel"])).trim();
    const [actual, expected] = await Promise.all([fs.realpath(top), fs.realpath(this.root)]);
    const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
    if (normalize(actual) !== normalize(expected)) throw new Error(t("当前笔记库不是 Git 仓库根目录，已停止操作以免影响上级仓库。"));
    this.gitDir = path.resolve(this.root, (await this.run(["rev-parse", "--absolute-git-dir"])).trim());
  }

  async operation() {
    for (const [name, label] of [["rebase-merge", "rebase"], ["rebase-apply", "rebase"], ["MERGE_HEAD", "merge"], ["CHERRY_PICK_HEAD", "cherry-pick"], ["REVERT_HEAD", "revert"], ["sequencer", "sequencer"]]) {
      try {
        await fs.access(path.join(this.gitDir, name));
        return label;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return null;
  }

  async status({ includeStash = true } = {}) {
    const [output, operation, stash] = await Promise.all([
      this.run(["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"]),
      this.operation(),
      includeStash ? this.stashExists() : false,
    ]);
    const status = parseStatus(output);
    status.operation = operation;
    status.stash = stash;
    return status;
  }

  checkPaths(paths) {
    if (!paths.length) throw new Error(t("没有选中文件。"));
    for (const file of paths) {
      if (!file || file.includes("\0") || path.isAbsolute(file) || file.split(/[\\/]/).some((part) => part === ".." || part.toLowerCase() === ".git")) {
        throw new Error(t("无效的仓库相对路径。"));
      }
    }
  }

  async stage(paths) {
    this.checkPaths(paths);
    await this.run(["add", "--", ...new Set(paths)]);
  }

  async unstage(paths) {
    this.checkPaths(paths);
    let hasHead = true;
    try { await this.run(["rev-parse", "--verify", "HEAD"]); } catch { hasHead = false; }
    if (hasHead) await this.run(["reset", "--quiet", "HEAD", "--", ...new Set(paths)]);
    else await this.run(["rm", "--cached", "--force", "--quiet", "--", ...new Set(paths)]);
  }

  async discard(filePath) {
    this.checkPaths([filePath]);
    const status = await this.status();
    this.assertNormal(status);
    const file = status.files.find((entry) => entry.path === filePath);
    if (!file || file.worktree === " ") throw new Error(t("该文件没有未暂存的改动，请刷新。"));
    if (file.untracked) throw new Error(t("未跟踪文件请移入回收站，不能用 Git 恢复。"));
    // Restore only the worktree from the index, preserving staged content.
    return this.run(["restore", "--worktree", "--", filePath]);
  }

  assertNormal(status) {
    if (status.operation) throw new Error(t`正在进行 ${status.operation}。请先解决冲突并继续，或中止当前操作。`);
    if (status.files.some((file) => file.conflict)) throw new Error(t("存在未解决的冲突，请先处理冲突。"));
  }

  async commit(message) {
    if (!message.trim()) throw new Error(t("请填写提交说明。"));
    const status = await this.status();
    this.assertNormal(status);
    if (!groupsFor(status.files).staged.length) throw new Error(t("暂存区为空。请先点击文件旁的 + 暂存改动。"));
    // No `add`, `-a`, or path argument: commit exactly the current index.
    return this.run(["commit", "-m", message.trim()], { timeout: 120000 });
  }

  async pull() {
    const status = await this.status();
    this.assertNormal(status);
    if (!status.upstream) throw new Error(t("当前分支没有上游分支，请先通过终端设置 upstream。"));
    if (status.files.length) throw new Error(t("请先提交，或点击 Stash 收起未提交的改动，再 Pull。"));
    return this.run(["pull", this.pullMethod === "merge" ? "--no-rebase" : "--rebase", "--no-autostash", "--no-edit"], { timeout: 120000 });
  }

  async push() {
    const status = await this.status();
    this.assertNormal(status);
    if (!status.upstream) throw new Error(t("当前分支没有上游分支，请先通过终端设置 upstream。"));
    const remote = (await this.run(["config", "--get", `branch.${status.branch}.remote`])).trim();
    const target = (await this.run(["config", "--get", `branch.${status.branch}.merge`])).trim();
    if (!remote || !target.startsWith("refs/heads/")) throw new Error(t("无法确定当前分支的上游推送目标。"));
    return this.run(["push", "--", remote, `HEAD:${target}`], { timeout: 120000 });
  }

  async localBranches() {
    return (await this.run(["for-each-ref", "--format=%(refname:strip=2)%00%(HEAD)", "refs/heads/"]))
      .trimEnd().split("\n").filter(Boolean).map(line => {
        const [name, head] = line.split("\0");
        return { name, current: head === "*" };
      });
  }

  async checkBranchName(name) {
    if (typeof name !== "string" || !name || name.startsWith("-") || name.startsWith("refs/") || name.includes("\0") || name.includes("@{") || name === "HEAD") {
      throw new Error(t("请输入有效的本地分支名。"));
    }
    await this.run(["check-ref-format", "--branch", name]);
  }

  async switchBranch(name) {
    await this.checkBranchName(name);
    this.assertNormal(await this.status());
    await this.run(["show-ref", "--verify", `refs/heads/${name}`]);
    // Native switch refuses overwrites and preserves compatible working changes.
    return this.run(["switch", "--no-guess", "--", name]);
  }

  async createBranch(name, hash = "") {
    await this.checkBranchName(name);
    if (hash) this.checkCommit(hash);
    this.assertNormal(await this.status());
    return this.run(["switch", "--no-guess", "-c", name, ...(hash ? [hash] : [])]);
  }

  async diff(file, area) {
    this.checkPaths([file.path]);
    if (file.untracked && area === "unstaged") {
      const absolute = path.resolve(this.root, file.path);
      const stat = await fs.stat(absolute);
      if (stat.size > MAX_PREVIEW) return { message: t("文件超过 2 MB，请在外部编辑器中查看。"), patch: "" };
      const content = await fs.readFile(absolute);
      if (content.includes(0)) return { message: t("二进制文件，无法显示文本差异。"), patch: "" };
      const text = content.toString("utf8");
      if (!text) return { message: t("新增的空文件。"), patch: "" };
      const lines = text.split("\n");
      if (lines.at(-1) === "") lines.pop();
      return { patch: `--- /dev/null\n+++ ${file.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}\n` };
    }
    const args = ["diff", ...DIFF_OPTIONS];
    if (area === "staged") args.push("--cached");
    args.push("--", file.path);
    if (area === "staged" && file.oldPath) args.push(file.oldPath);
    return this.preview(args, t("没有可显示的文本差异，文件状态可能已发生变化。"));
  }

  async preview(args, emptyMessage) {
    const patch = await this.run(args);
    if (Buffer.byteLength(patch, "utf8") > MAX_PREVIEW) return { message: t("差异超过 2 MB，请在外部编辑器中查看。"), patch: "" };
    return { patch, message: patch ? "" : emptyMessage };
  }

  async worktreeVersions(filePath) {
    this.checkPaths([filePath]);
    this.assertNormal(await this.status({ includeStash: false }));
    const absolute = path.resolve(this.root, filePath);
    const [stat, actual, root] = await Promise.all([fs.lstat(absolute), fs.realpath(absolute), fs.realpath(this.root)]);
    const relative = path.relative(root, actual);
    if (!stat.isFile() || stat.isSymbolicLink() || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(t("此文件不支持在差异视图中编辑。"));
    }
    const decode = (bytes) => {
      if (bytes.length > MAX_PREVIEW || bytes.includes(0)) throw new Error(t("仅支持编辑 2 MB 以内的 UTF-8 文本文件。"));
      try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw new Error(t("仅支持编辑 2 MB 以内的 UTF-8 文本文件。")); }
    };
    if (stat.size > MAX_PREVIEW) throw new Error(t("仅支持编辑 2 MB 以内的 UTF-8 文本文件。"));
    const working = decode(await fs.readFile(absolute));
    const entry = (await this.run(["ls-files", "--stage", "-z", "--", filePath])).split("\0").find(Boolean);
    let index = "";
    if (entry) {
      const hash = entry.split(" ")[1];
      if (this.previewBlob?.hash === hash) index = this.previewBlob.text;
      else {
        if (Number(await this.run(["cat-file", "-s", hash])) > MAX_PREVIEW) throw new Error(t("仅支持编辑 2 MB 以内的 UTF-8 文本文件。"));
        index = await this.run(["cat-file", "blob", hash]);
        if (index.includes("\0") || index.includes("\ufffd")) throw new Error(t("仅支持编辑 2 MB 以内的 UTF-8 文本文件。"));
        // Blobs are immutable by hash. Keep only one, bounded by MAX_PREVIEW.
        this.previewBlob = { hash, text: index };
      }
    }
    return { index, working };
  }

  async fetch() {
    return this.run(["fetch", "--all"], { timeout: 120000 });
  }

  async stashExists() {
    try {
      await this.run(["rev-parse", "--verify", "--quiet", "refs/stash"]);
      return true;
    } catch {
      return false;
    }
  }

  async stash() {
    const status = await this.status();
    this.assertNormal(status);
    if (!status.files.length) throw new Error(t("当前没有需要 Stash 的修改。"));
    return this.run(["stash", "push", "--include-untracked", "--message", "VaultBranch temporary pull stash"]);
  }

  stashPop(entry = null) { return this.restoreStash(entry, true); }
  stashApply(entry) { return this.restoreStash(entry, false); }

  async stashSelector(hash) {
    this.checkCommit(hash);
    const fields = (await this.run(["stash", "list", "-z", "--format=%H%x00%gd"])).split("\0");
    for (let i = 0; i + 1 < fields.length; i += 2) if (fields[i] === hash) return fields[i + 1];
    throw new Error(t("这条 Stash 已被移除，请刷新历史后重新选择。"));
  }

  async restoreStash(entry, remove) {
    const status = await this.status();
    this.assertNormal(status);
    if (status.files.length) throw new Error(t("恢复 Stash 前请保持工作区干净。"));
    if (!status.stash) throw new Error(t("没有可恢复的 Stash。"));
    const hash = entry?.hash || (await this.run(["rev-parse", "refs/stash"])).trim();
    await this.stashSelector(hash);
    try {
      const output = await this.run(["stash", "apply", "--index", hash]);
      if (remove) await this.run(["stash", "drop", await this.stashSelector(hash)]);
      return output;
    } catch (error) {
      throw new Error(t`恢复未完成，Stash 仍保留。请检查文件状态；若出现冲突，在侧栏打开冲突文件解决。\n\n${error.message}`);
    }
  }

  async rebaseOnto(hash) {
    this.checkCommit(hash);
    const status = await this.status();
    this.assertNormal(status);
    if (status.files.length) throw new Error(t("Rebase 前请先提交或 Stash 当前修改。"));
    await this.run(["symbolic-ref", "--quiet", "HEAD"]);
    return this.run(["rebase", "--no-autostash", hash], { timeout: 120000 });
  }

  async stashFiles(hash) {
    const files = await this.commitFiles(hash);
    const parents = (await this.run(["rev-list", "--parents", "-n", "1", hash])).trim().split(" ");
    if (parents[3]) files.push(...await this.commitFiles(parents[3]));
    return files;
  }

  async stashHistory(limit) {
    const fields = (await this.run(["stash", "list", "-z", `--max-count=${Math.max(1, Math.min(1000, Number(limit) || 100))}`, "--format=%H%x00%gd%x00%gs%x00%P%x00%an%x00%aI"]))
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

  async history(limit = 100, ref = "") { return (await this.historyData(limit, ref)).commits; }

  async historyData(limit = 100, ref = "", force = false) {
    limit = Math.max(10, Math.min(1000, Number(limit) || 100));
    const [refs, head, stashes] = await Promise.all([
      this.run(["show-ref", "--head"], { allowDiffExit: true }),
      fs.readFile(path.join(this.gitDir, "HEAD"), "utf8"),
      this.stashHistory(limit),
    ]);
    // Re-read mutable refs, HEAD and the stash reflog every time. Bound the cache to one page.
    const key = JSON.stringify([refs, head, stashes, limit, ref]);
    if (!force && this.historyCache?.key === key) return this.historyCache.data;
    const branches = refs.split("\n").map(line => line.slice(line.indexOf(" ")+1))
      .filter(name => name.startsWith("refs/heads/") || name.startsWith("refs/remotes/"))
      .map(name => name.replace(/^refs\/(heads|remotes)\//, ""));
    const currentBranch = head.startsWith("ref: refs/heads/") ? head.trim().slice(16) : "";
    const commits = ref === "stash" ? [] : await this.readHistory(limit, ref, refs);
    if (!ref || ref === "stash") commits.unshift(...stashes);
    const data = { commits: graphFor(commits), branches, hasStash: Boolean(stashes.length), currentBranch };
    this.historyCache = { key, data };
    return data;
  }

  async readHistory(limit, ref, refs) {
    if (!refs.split("\n").some(line => line && !line.endsWith(" refs/stash"))) return [];
    const selection = ref ? (await this.run(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).trim() : null;
    const output = await this.run(["log", ...(selection ? [selection] : ["--exclude=refs/stash", "--all"]), "--topo-order", `--max-count=${Math.max(10, Math.min(1000, Number(limit) || 100))}`,
      "--format=%H%x00%P%x00%h%x00%an%x00%aI%x00%D%x00%s%x00", "-z"]);
    const fields = output.split("\0");
    const commits = [];
    let i = 0;
    while (i < fields.length) {
      while (i < fields.length && !fields[i]) i++;
      if (i + 6 >= fields.length) break;
      const [hash, parents, short, author, date, refs, subject] = fields.slice(i, i + 7);
      if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new Error(t("无法解析提交历史。"));
      commits.push({ hash, parents: parents ? parents.split(" ") : [], short, author, date, refs, subject });
      i += 7;
    }
    return commits;
  }

  checkCommit(hash) {
    if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new Error(t("无效的提交编号。"));
  }

  async firstParent(hash) {
    this.checkCommit(hash);
    return (await this.run(["rev-list", "--parents", "-n", "1", hash])).trim().split(" ")[1];
  }

  async fileHistory(filePath, { all = false, limit = 50 } = {}) {
    this.checkPaths([filePath]);
    limit = Math.max(1, Math.min(1000, Number(limit) || 50));
    const head = (await this.run(["rev-parse", "--verify", "--quiet", "HEAD"], { allowDiffExit: true })).trim();
    if (!head && !all) return { commits: [], hasMore: false };
    const refs = all ? ["--branches", "--remotes", ...(head ? [head] : [])] : [head];
    if (!head && !(await this.run(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"])).trim()) return { commits: [], hasMore: false };
    const paths = new Set([filePath]);
    if (all && head) {
      // A combined --follow walk can miss forks made before a rename. Seed it with
      // the current lineage's old names, including renames beyond this page.
      const renames = (await this.run(["log", head, "--follow", "--find-renames", "--diff-filter=R", "--max-count=1000", "--name-status", "-z", "--format=", "--", filePath])).split("\0").filter(Boolean);
      for (let n = 0; n + 2 < renames.length; n += 3) {
        this.checkPaths([renames[n + 1], renames[n + 2]]);
        paths.add(renames[n + 1]); paths.add(renames[n + 2]);
      }
    }
    const entries = new Map();
    for (const name of paths) for (const commit of await this.readFileHistory(name, refs, limit + 1)) {
      if (!entries.has(commit.hash)) entries.set(commit.hash, commit);
    }
    const commits = [...entries.values()].sort((a, b) => b.timestamp - a.timestamp);
    return { commits: commits.slice(0, limit), hasMore: commits.length > limit && limit < 1000 };
  }

  async readFileHistory(filePath, refs, limit) {
    const fields = (await this.run(["log", ...refs, "--follow", "--find-renames", "--diff-merges=first-parent", "--date-order",
      `--max-count=${limit}`, "--name-status", "-z", "--format=%H%x00%P%x00%an%x00%aI%x00%ct%x00%s", "--", filePath])).split("\0");
    const commits = [];
    let i = 0;
    while (i < fields.length && fields[i]) {
      const [hash, parents, author, date, timestamp, subject] = fields.slice(i, i + 6);
      this.checkCommit(hash);
      i += 6;
      let file;
      while (/^\n?[A-Z][0-9]*$/.test(fields[i] || "")) {
        const status = fields[i++].trim();
        const first = fields[i++];
        const renamed = status[0] === "R" || status[0] === "C";
        const current = renamed ? fields[i++] : first;
        this.checkPaths([current, ...(renamed ? [first] : [])]);
        file = { path: current, oldPath: renamed ? first : null, index: status[0], worktree: " ", commit: hash };
      }
      if (file) commits.push({ hash, parents: parents.split(" ").filter(Boolean), short: hash.slice(0, 7), author, date, timestamp: Number(timestamp), subject, ...file });
    }
    return commits;
  }

  async textBlob(hash) {
    if (!hash) return "";
    this.checkCommit(hash);
    if (Number(await this.run(["cat-file", "-s", hash])) > MAX_PREVIEW) throw new Error(t("文件超过 2 MB，请在外部编辑器中查看。"));
    const text = await this.run(["cat-file", "blob", hash]);
    if (text.includes("\0") || text.includes("\ufffd")) throw new Error(t("此版本不是可预览的 UTF-8 文本。"));
    return text;
  }

  async revisionText(hash, filePath) {
    if (!hash) return "";
    this.checkCommit(hash);
    this.checkPaths([filePath]);
    const entry = (await this.run(["ls-tree", "-z", hash, "--", filePath])).split("\0").find(Boolean);
    if (!entry) return "";
    const match = entry.match(/^\d+ blob ([a-f0-9]+)\t/);
    if (!match) throw new Error(t("此版本不是可预览的 UTF-8 文本。"));
    return this.textBlob(match[1]);
  }

  async comparisonVersions(file, area) {
    this.checkPaths([file.path, ...(file.oldPath ? [file.oldPath] : [])]);
    if (area === "history") {
      const parent = await this.firstParent(file.commit);
      const [left, right] = await Promise.all([
        this.revisionText(parent, file.oldPath || file.path), this.revisionText(file.commit, file.path),
      ]);
      return { left, right };
    }
    if (area !== "staged") return null;
    const head = (await this.run(["rev-parse", "--verify", "--quiet", "HEAD"], { allowDiffExit: true })).trim();
    const entries = (await this.run(["ls-files", "--stage", "-z", "--", file.path])).split("\0").filter(Boolean);
    const entry = entries.find(line => /^\d+ [a-f0-9]+ 0\t/.test(line));
    if (entries.length && !entry) throw new Error(t("请先解决冲突。"));
    const [left, right] = await Promise.all([
      this.revisionText(head, file.oldPath || file.path), this.textBlob(entry?.split(" ")[1]),
    ]);
    return { left, right };
  }

  async commitFiles(hash) {
    const parent = await this.firstParent(hash);
    const args = ["diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--no-renames"];
    if (parent) args.push(parent, hash);
    else args.push("--root", hash);
    const fields = (await this.run(args)).split("\0");
    const files = [];
    for (let i = 0; i + 1 < fields.length; i += 2) {
      if (fields[i]) files.push({ path: fields[i + 1], index: fields[i][0], worktree: " ", commit: hash });
    }
    return files;
  }

  async commitDiff(file) {
    this.checkPaths([file.path]);
    const parent = await this.firstParent(file.commit);
    const args = parent ? ["diff", ...DIFF_OPTIONS, parent, file.commit, "--", file.path]
      : ["show", ...DIFF_OPTIONS, "--format=", "--root", file.commit, "--", file.path];
    return this.preview(args, t("没有文本差异。"));
  }

  async conflictVersions(filePath) {
    this.checkPaths([filePath]);
    const status = await this.status();
    if (!status.files.some((file) => file.path === filePath && file.conflict)) throw new Error(t("该文件已不处于冲突状态，请刷新。"));
    const stages = (await this.run(["ls-files", "--unmerged", "-z", "--", filePath])).split("\0").filter(Boolean);
    const versions = { base: null, ours: null, theirs: null, binary: false };
    for (const record of stages) {
      const match = record.match(/^(\d+) ([a-f0-9]+) ([123])\t/);
      if (!match) continue;
      const size = Number((await this.run(["cat-file", "-s", match[2]])).trim());
      if (size > MAX_PREVIEW) throw new Error(t("冲突文件超过 2 MB，请使用外部工具解决。"));
      const text = await this.run(["show", `:${match[3]}:${filePath}`]);
      if (text.includes("\0")) versions.binary = true;
      versions[{ 1: "base", 2: "ours", 3: "theirs" }[match[3]]] = text;
    }
    let result = "";
    try {
      const absolute = path.resolve(this.root, filePath);
      if ((await fs.stat(absolute)).size > MAX_PREVIEW) throw new Error(t("冲突文件超过 2 MB，请使用外部工具解决。"));
      result = await fs.readFile(absolute, "utf8");
      if (result.includes("\0")) versions.binary = true;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (versions.binary) throw new Error(t("二进制冲突请使用外部工具解决。"));
    return { ...versions, result, operation: status.operation,
      oursLabel: status.operation === "rebase" ? t("上游版本") : t("本地版本"),
      theirsLabel: status.operation === "rebase" ? t("本地版本") : t("传入版本") };
  }

  async resolveConflict(filePath, content, expected) {
    this.checkPaths([filePath]);
    if (/^(<{7}|={7}|>{7}|\|{7})(?: |$)/m.test(content)) throw new Error(t("结果中仍有冲突标记，请编辑完成后再标记已解决。"));
    const versions = await this.conflictVersions(filePath);
    if (expected !== undefined && versions.result !== expected) throw new Error(t("冲突文件已被其他编辑器修改，请重新打开冲突视图。"));
    if (versions.ours === null || versions.theirs === null) throw new Error(t("涉及删除的冲突请在外部工具中处理，再暂存结果。"));
    const absolute = path.resolve(this.root, filePath);
    const [actualParent, realRoot] = await Promise.all([fs.realpath(path.dirname(absolute)), fs.realpath(this.root)]);
    const relative = path.relative(realRoot, actualParent);
    if (relative.startsWith("..") || path.isAbsolute(relative) || (await fs.lstat(absolute)).isSymbolicLink()) throw new Error(t("不支持通过符号链接写入冲突结果。"));
    await fs.writeFile(absolute, content, "utf8");
    await this.stage([filePath]);
  }

  async continueOperation() {
    const status = await this.status();
    if (status.files.some((file) => file.conflict)) throw new Error(t("仍有未解决的冲突。"));
    const unstaged = status.files.filter((file) => !file.untracked && file.worktree !== " ");
    if (unstaged.length) throw new Error(t`还有未暂存的修改，请先处理后再继续：\n${unstaged.map((file) => file.path).join("\n")}\n这些修改不会被自动加入冲突提交。`);
    if (status.operation === "rebase") return this.run(["rebase", "--continue"], { timeout: 120000 });
    if (status.operation === "merge") return this.run(["commit", "--no-edit"], { timeout: 120000 });
    throw new Error(t("当前没有可继续的 rebase / merge。"));
  }

  async abortOperation() {
    const status = await this.status();
    if (status.operation === "rebase" || status.operation === "merge") return this.run([status.operation, "--abort"]);
    throw new Error(t("当前没有可中止的 rebase / merge。"));
  }

  async ignored(filePath) {
    const output = await this.run(["check-ignore", "--no-index", "-v", "--", filePath], { allowDiffExit: true });
    const pattern = output.split("\t")[0].match(/:\d+:(.*)$/)?.[1];
    return Boolean(pattern && !pattern.startsWith("!"));
  }

  async settingsTracking() {
    const filePath = this.settingsPath;
    const [tracked, ignored] = await Promise.all([
      this.run(["ls-files", "--", filePath]), this.ignored(filePath),
    ]);
    return { path: filePath, tracked: Boolean(tracked.trim()), ignored };
  }

  async enableSettingsTracking() {
    this.assertNormal(await this.status());
    const parts = this.settingsPath.split("/").slice(0, -1);
    const parents = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    const rules = [];
    for (const parent of parents) {
      if (await this.ignored(parent)) rules.push(`!/${parent}/`, `/${parent}/*`);
    }
    const settingsPath = this.settingsPath;
    if (rules.length || await this.ignored(settingsPath)) rules.push(`!/${settingsPath}`);
    if (rules.length) {
      const ignorePath = path.join(this.root, ".gitignore");
      let content = "";
      try { content = await fs.readFile(ignorePath, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
      await fs.writeFile(ignorePath, `${content}${content && !content.endsWith("\n") ? "\n" : ""}\n# VaultBranch settings\n${rules.join("\n")}\n`, "utf8");
    }
    if ((await this.settingsTracking()).ignored) throw new Error(t("配置仍被忽略，请检查更高优先级的 Git 忽略规则。"));
    return t("配置已允许加入版本管理。请在未暂存列表中暂存 data.json 和 .gitignore，再提交。");
  }
}

module.exports = { GitService, parseStatus, groupsFor, treeFor, splitPatch, graphFor };
