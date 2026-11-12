"use strict";

const { t } = require("./i18n.js");
const { measure } = require("./timing.js");
const { parseStatus, groupsFor } = require("./git-data.js");

const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const { MAX_OUTPUT, MAX_PREVIEW, MAX_IMAGE, IMAGE_TYPES, DIFF_OPTIONS } = require("./git-limits.js");
const stash = require("./git-stash.js");
const history = require("./git-history.js");
const conflicts = require("./git-conflicts.js");

class GitService {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    this.gitDir = null;
    this.settingsPath = options.settingsPath || ".obsidian/plugins/vaultbranch/data.json";
    this.binary = options.binary || "git";
    this.pullMethod = options.pullMethod === "merge" ? "merge" : "rebase";
  }

  run(args, { timeout = 20000, allowDiffExit = false, maxBuffer = MAX_OUTPUT, timing, encoding = "utf8" } = {}) {
    const end = timing?.span(`git:${args[0]}${args[0] === "cat-file" ? ":" + args[1] : ""}`);
    return new Promise((resolve, reject) => {
      execFile(this.binary, ["-c", "core.quotepath=false", "-c", "color.ui=false", ...args], {
        cwd: this.root,
        shell: false,
        windowsHide: true,
        encoding,
        timeout,
        maxBuffer,
        // Stash uses Git's own pathspecs to remove saved untracked files.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true", GIT_LITERAL_PATHSPECS: ["check-ignore", "stash"].includes(args[0]) ? "0" : "1" },
      }, (error, stdout, stderr) => {
        end?.();
        if (!error || (allowDiffExit && error.code === 1)) return resolve(stdout);
        if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" && maxBuffer === MAX_PREVIEW) return reject(new Error(t("仅支持编辑 2 MB 以内的 UTF-8 文本文件。")));
        if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" && maxBuffer === MAX_IMAGE) return reject(new Error(t("图片超过 10 MB，请在外部查看。")));
        if (Buffer.isBuffer(stderr)) stderr = stderr.toString("utf8");
        if (Buffer.isBuffer(stdout)) stdout = stdout.toString("utf8");
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
    const operations = await Promise.all([["rebase-merge", "rebase"], ["rebase-apply", "rebase"], ["MERGE_HEAD", "merge"], ["CHERRY_PICK_HEAD", "cherry-pick"], ["REVERT_HEAD", "revert"], ["sequencer", "sequencer"]].map(async ([name, label]) => {
      try {
        await fs.access(path.join(this.gitDir, name));
        return label;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      return null;
    }));
    return operations.find(Boolean) || null;
  }

  async status({ includeStash = true, timing } = {}) {
    const [output, operation, stash] = await Promise.all([
      this.run(["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"], { timing }),
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

  async diff(file, area, timing) {
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
    return this.preview(args, t("没有可显示的文本差异，文件状态可能已发生变化。"), timing);
  }

  async preview(args, emptyMessage, timing) {
    const patch = await this.run(args, { timing });
    if (Buffer.byteLength(patch, "utf8") > MAX_PREVIEW) return { message: t("差异超过 2 MB，请在外部编辑器中查看。"), patch: "" };
    return { patch, message: patch ? "" : emptyMessage };
  }

  worktreeVersions(filePath, timing) { return measure(timing, "read-worktree-versions", () => this.readWorktreeVersions(filePath, timing)); }

  async readWorktreeVersions(filePath, timing) {
    this.checkPaths([filePath]);
    const absolute = path.resolve(this.root, filePath);
    const [operation, [stat, actual, root], entries] = await Promise.all([
      measure(timing, "check-repository-operation", () => this.operation()),
      measure(timing, "validate-file-path", () => Promise.all([fs.lstat(absolute), fs.realpath(absolute), fs.realpath(this.root)])),
      // Stage numbers expose conflicts anywhere in the index without scanning
      // working files, untracked directories, branches or upstream refs.
      this.run(["ls-files", "--stage", "-z"], { timing }),
    ]);
    let entry;
    const files = [];
    for (const record of entries.split("\0")) {
      if (!record) continue;
      const match = /^(\d+) ([a-f0-9]+) ([0-3])\t([\s\S]*)$/.exec(record);
      if (!match) throw new Error(t("文件状态已改变，请刷新后重试。"));
      if (match[3] !== "0") files.push({ conflict: true });
      if (match[4] === filePath && match[3] === "0") entry = match;
    }
    this.assertNormal({ operation, files });
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
    const working = decode(await measure(timing, "read-working-file", () => fs.readFile(absolute)));
    const index = await this.textBlob(entry?.[2], timing);
    if (timing) { timing.record.workingBytes = stat.size; timing.record.indexBytes = Buffer.byteLength(index, "utf8"); }
    return { index, working };
  }

  async fetch() {
    return this.run(["fetch", "--all"], { timeout: 120000 });
  }

  stashExists() { return stash.stashExists(this); }

  stash() { return stash.stash(this); }

  stashPop(entry) { return stash.stashPop(this, entry); }
  stashApply(entry) { return stash.stashApply(this, entry); }

  stashSelector(hash) { return stash.stashSelector(this, hash); }

  restoreStash(entry, remove) { return stash.restoreStash(this, entry, remove); }

  rebaseOnto(hash) { return conflicts.rebaseOnto(this, hash); }

  stashFiles(hash) { return stash.stashFiles(this, hash); }

  stashHistory(limit) { return stash.stashHistory(this, limit); }

  history(limit, ref) { return history.history(this, limit, ref); }

  historyData(limit, ref, force) { return history.historyData(this, limit, ref, force); }

  readHistory(limit, ref, refs) { return history.readHistory(this, limit, ref, refs); }

  checkCommit(hash) {
    if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new Error(t("无效的提交编号。"));
  }

  async firstParent(hash, timing) {
    this.checkCommit(hash);
    return (await this.run(["rev-list", "--parents", "-n", "1", hash], { timing })).trim().split(" ")[1];
  }

  fileHistory(filePath, options) { return history.fileHistory(this, filePath, options); }

  fileHistoryGraph(commits, refs, all) { return history.fileHistoryGraph(this, commits, refs, all); }

  readFileHistory(filePath, refs, limit) { return history.readFileHistory(this, filePath, refs, limit); }

  async textBlob(hash, timing) {
    if (!hash) return "";
    this.checkCommit(hash);
    if (this.previewBlobs?.has(hash)) {
      const text = this.previewBlobs.get(hash);
      this.previewBlobs.delete(hash); this.previewBlobs.set(hash, text);
      if (timing) timing.record.blobCacheHits = (timing.record.blobCacheHits || 0) + 1;
      return text;
    }
    const text = await this.run(["cat-file", "blob", hash], { maxBuffer: MAX_PREVIEW, timing });
    if (Buffer.byteLength(text, "utf8") > MAX_PREVIEW) throw new Error(t("文件超过 2 MB，请在外部编辑器中查看。"));
    if (text.includes("\0") || text.includes("\ufffd")) throw new Error(t("此版本不是可预览的 UTF-8 文本。"));
    // Share the existing bounded immutable-blob cache across all diff views.
    // HEAD, index and working files are still read afresh on every request.
    this.previewBlobs ||= new Map();
    if (!this.previewBlobs.has(hash)) {
      this.previewBlobs.set(hash, text);
      this.previewBlobBytes = (this.previewBlobBytes || 0) + Buffer.byteLength(text, "utf8");
      while (this.previewBlobs.size > 8 || this.previewBlobBytes > MAX_PREVIEW * 2) {
        const oldest = this.previewBlobs.keys().next().value;
        this.previewBlobBytes -= Buffer.byteLength(this.previewBlobs.get(oldest), "utf8");
        this.previewBlobs.delete(oldest);
      }
    }
    return text;
  }

  async revisionText(hash, filePath, timing, read = (blobHash, _filePath, measureTiming) => this.textBlob(blobHash, measureTiming)) {
    if (!hash) return read(null, filePath, timing);
    this.checkCommit(hash);
    this.checkPaths([filePath]);
    const entry = (await this.run(["ls-tree", "-z", hash, "--", filePath], { timing })).split("\0").find(Boolean);
    if (!entry) return read(null, filePath, timing);
    const match = entry.match(/^\d+ blob ([a-f0-9]+)\t/);
    if (!match) throw new Error(t("此版本不是可预览的 UTF-8 文本。"));
    return read(match[1], filePath, timing, entry.split(" ")[0]);
  }

  async comparisonVersions(file, area, timing, read = (hash, _filePath, measureTiming) => this.textBlob(hash, measureTiming)) {
    this.checkPaths([file.path, ...(file.oldPath ? [file.oldPath] : [])]);
    if (area === "history") {
      const parent = await this.firstParent(file.commit, timing);
      const [left, right] = await Promise.all([
        this.revisionText(parent, file.oldPath || file.path, timing, read), this.revisionText(file.commit, file.path, timing, read),
      ]);
      return { left, right };
    }
    if (area !== "staged") return null;
    const [headOutput, indexOutput] = await Promise.all([
      this.run(["rev-parse", "--verify", "--quiet", "HEAD"], { allowDiffExit: true, timing }),
      this.run(["ls-files", "--stage", "-z", "--", file.path], { timing }),
    ]);
    const head = headOutput.trim();
    const entries = indexOutput.split("\0").filter(Boolean);
    const entry = entries.find(line => /^\d+ [a-f0-9]+ 0\t/.test(line));
    if (entries.length && !entry) throw new Error(t("请先解决冲突。"));
    const [left, right] = await Promise.all([
      this.revisionText(head, file.oldPath || file.path, timing, read), read(entry?.split(" ")[1], file.path, timing, entry?.split(" ")[0]),
    ]);
    return { left, right };
  }

  imageType(filePath) {
    const extension = path.extname(filePath).slice(1).toLowerCase();
    return Object.hasOwn(IMAGE_TYPES, extension) ? IMAGE_TYPES[extension] : null;
  }

  async imageVersions(file, area, timing) {
    this.checkPaths([file.path, ...(file.oldPath ? [file.oldPath] : [])]);
    const mime = this.imageType(file.path);
    const oldMime = this.imageType(file.oldPath || file.path);
    if (!mime && !oldMime) return null;
    const read = async (hash, filePath, _timing, mode) => {
      if (!hash) return null;
      this.checkCommit(hash);
      if (mode && !/^100(644|755)$/.test(mode)) throw new Error(t("此文件不支持图片预览。"));
      const type = this.imageType(filePath);
      if (!type) return null;
      const bytes = await this.run(["cat-file", "blob", hash], { encoding: null, maxBuffer: MAX_IMAGE, timing });
      return { mime: type, src: `data:${type};base64,${bytes.toString("base64")}` };
    };
    if (area !== "unstaged") {
      const versions = await this.comparisonVersions(file, area, timing, read);
      return versions && { images: versions };
    }
    const reads = await Promise.allSettled([
      this.status({ includeStash: false }),
      this.run(["ls-files", "--stage", "-z", "--", file.path], { timing }),
      this.workingImage(file.path),
    ]);
    // A failed image read must not leave a status/index read running behind it.
    const failure = reads.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    const [status, index, working] = reads.map(result => result.value);
    this.assertNormal(status);
    if (!status.files.some(entry => entry.path === file.path && entry.worktree !== " ")) throw new Error(t("文件状态已改变，请刷新后重试。"));
    const entries = index.split("\0").filter(Boolean);
    if (entries.some(entry => !/^100(644|755) [a-f0-9]+ 0\t/.test(entry))) throw new Error(t("此文件不支持图片预览。"));
    const left = await read(entries[0]?.split(" ")[1], file.oldPath || file.path);
    const right = working && mime ? { mime, src: `data:${mime};base64,${working.toString("base64")}` } : null;
    return { images: { left, right } };
  }

  async workingImage(filePath) {
    this.checkPaths([filePath]);
    const absolute = path.resolve(this.root, filePath);
    let stat, actual, root;
    try { [stat, actual, root] = await Promise.all([fs.lstat(absolute), fs.realpath(absolute), fs.realpath(this.root)]); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    const relative = path.relative(root, actual);
    if (!stat.isFile() || stat.isSymbolicLink() || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(t("此文件不支持图片预览。"));
    if (stat.size > MAX_IMAGE) throw new Error(t("图片超过 10 MB，请在外部查看。"));
    const handle = await fs.open(absolute, "r");
    try {
      const bytes = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length !== stat.size) throw new Error(t("文件状态已改变，请刷新后重试。"));
      return bytes.subarray(0, length);
    } finally { await handle.close(); }
  }

  commitFiles(hash) { return history.commitFiles(this, hash); }

  commitDiff(file, timing) { return history.commitDiff(this, file, timing); }

  conflictVersions(filePath) { return conflicts.conflictVersions(this, filePath); }

  resolveConflict(filePath, content, expected) { return conflicts.resolveConflict(this, filePath, content, expected); }

  continueOperation() { return conflicts.continueOperation(this); }

  abortOperation() { return conflicts.abortOperation(this); }

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

module.exports = { GitService };
