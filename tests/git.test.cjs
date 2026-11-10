"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { GitService, parseStatus, groupsFor, treeFor, splitPatch } = require("../src/git.js");

const cleanup = [];
after(async () => {
  for (const target of cleanup) await fs.rm(target, { recursive: true, force: true });
});

function git(root, ...args) {
  return execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vaultbranch-test-"));
  cleanup.push(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "VaultBranch Test");
  git(root, "config", "user.email", "vaultbranch-test@example.invalid");
  git(root, "config", "core.autocrlf", "false");
  const service = new GitService(root);
  await service.init();
  return { root, service };
}

async function write(root, file, text) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), text);
}

test("status parsing preserves Chinese, spaces, newline names, mixed states and rename order", () => {
  const state = parseStatus("## main...origin/main [ahead 2, behind 3]\0MM 笔记/中文 空格.md\0R  新名字.md\0旧名字.md\0?? 换\n行.md\0UU 冲突.md\0");
  assert.equal(state.branch, "main");
  assert.equal(state.upstream, "origin/main");
  assert.equal(state.ahead, 2);
  assert.equal(state.behind, 3);
  assert.equal(state.files[1].path, "新名字.md");
  assert.equal(state.files[1].oldPath, "旧名字.md");
  assert.equal(state.files[2].path, "换\n行.md");
  const groups = groupsFor(state.files);
  assert.equal(groups.staged.length, 2);
  assert.equal(groups.unstaged.length, 2);
  assert.equal(groups.conflicts.length, 1);
  assert.equal(treeFor(groups.unstaged).folders.get("笔记").files.length, 1);
});

test("commit includes exactly staged content and leaves later edits and untracked files untouched", async () => {
  const { root, service } = await fixture();
  await write(root, "中文 空格.md", "original\n");
  await service.stage(["中文 空格.md"]);
  await service.commit("initial");
  await write(root, "中文 空格.md", "staged version\n");
  await service.stage(["中文 空格.md"]);
  await write(root, "中文 空格.md", "later unstaged version\n");
  await write(root, "untracked.md", "must not commit\n");
  const status = await service.status();
  const file = status.files.find((entry) => entry.path === "中文 空格.md");
  assert.equal(file.index + file.worktree, "MM");
  assert.match((await service.diff(file, "staged")).patch, /\+staged version/);
  assert.match((await service.diff(file, "unstaged")).patch, /\+later unstaged version/);
  await service.commit("only staged\n\nmessage with `literal` and $(literal)");
  assert.equal(git(root, "show", "HEAD:中文 空格.md"), "staged version\n");
  assert.equal(await fs.readFile(path.join(root, "中文 空格.md"), "utf8"), "later unstaged version\n");
  assert.doesNotMatch(git(root, "ls-tree", "-r", "--name-only", "HEAD"), /untracked/);
  await assert.rejects(() => service.commit("empty"), /暂存区为空/);
});

test("stash includes staged, unstaged and untracked files and restores them", async () => {
  const { root, service } = await fixture();
  await write(root, "note.md", "initial\n");
  await service.stage(["note.md"]);
  await service.commit("initial");
  await write(root, "note.md", "staged\n");
  await service.stage(["note.md"]);
  await write(root, "note.md", "unstaged\n");
  await write(root, "new.md", "untracked\n");
  assert.equal((await service.status()).stash, false);
  await service.stash();
  assert.equal((await service.status()).files.length, 0);
  assert.equal((await service.status()).stash, true);
  const stashHistory = (await service.history()).filter((commit) => commit.stash);
  assert.equal(stashHistory.length, 1);
  assert.equal(stashHistory[0].refs, "stash");
  assert.match(stashHistory[0].subject, /stash@\{0\}/);
  assert.equal((await service.history("100", "main")).some((commit) => commit.stash), false);
  await service.stashPop();
  const restored = await service.status();
  assert.equal(restored.files.find((file) => file.path === "note.md").worktree, "M");
  assert.equal(restored.files.find((file) => file.path === "new.md").untracked, true);
  assert.equal(await fs.readFile(path.join(root, "note.md"), "utf8"), "unstaged\n");
  assert.equal(await fs.readFile(path.join(root, "new.md"), "utf8"), "untracked\n");
});

test("three consecutive stashes remain visible and restore newest first with index and untracked content", async () => {
  const { root, service } = await fixture();
  for (let n = 1; n <= 3; n++) await write(root, `note-${n}.md`, "base\n");
  await service.stage(["note-1.md", "note-2.md", "note-3.md"]);
  await service.commit("base");
  const hashes = [];
  for (let n = 1; n <= 3; n++) {
    await write(root, `note-${n}.md`, `staged-${n}\n`);
    await service.stage([`note-${n}.md`]);
    await write(root, `note-${n}.md`, `working-${n}\n`);
    await write(root, `new-${n}.md`, `untracked-${n}\n`);
    await service.stash();
    hashes.unshift(git(root, "rev-parse", "refs/stash").trim());
    assert.equal((await service.status()).files.length, 0);
    const entries = await service.stashHistory(100);
    assert.deepEqual(entries.map((entry) => entry.hash), hashes);
    assert.deepEqual(entries.map((entry) => entry.stashRef), hashes.map((_, i) => `stash@{${i}}`));
    assert.ok(entries.every((entry) => entry.parents.length === 1));
    assert.deepEqual((await service.history()).filter((entry) => entry.stash).map((entry) => entry.hash), hashes);
    assert.deepEqual((await service.history(100, "stash")).map((entry) => entry.hash), hashes);
    assert.equal((await service.history(100, "main")).length, 1);
  }
  assert.equal((await service.stashHistory(2)).length, 2);
  const commands = [];
  const run = service.run.bind(service);
  service.run = (args, options) => { commands.push(args[0]); return run(args, options); };
  const entries = await service.stashHistory(100);
  assert.deepEqual(commands, ["stash"], "all stash metadata comes from a single Git process");
  assert.ok(entries.every((entry) => entry.author === "VaultBranch Test" && Number.isFinite(Date.parse(entry.date))));
  assert.ok(entries.every((entry) => entry.parents[0] === git(root, "rev-parse", "HEAD").trim()));
  service.run = run;
  await write(root, "blocked.md", "keep this\n");
  await assert.rejects(() => service.stashPop(), /工作区干净/);
  assert.equal((await service.stashHistory(100)).length, 3);
  await fs.unlink(path.join(root, "blocked.md"));
  for (let n = 3; n >= 1; n--) {
    await service.stashPop();
    hashes.shift();
    assert.equal(await fs.readFile(path.join(root, `note-${n}.md`), "utf8"), `working-${n}\n`);
    assert.equal(git(root, "show", `:note-${n}.md`), `staged-${n}\n`);
    assert.equal(await fs.readFile(path.join(root, `new-${n}.md`), "utf8"), `untracked-${n}\n`);
    assert.deepEqual((await service.stashHistory(100)).map((entry) => entry.hash), hashes);
    // Save this recovered batch before restoring the next one.
    await service.stage([`note-${n}.md`, `new-${n}.md`]);
    await service.commit(`recovered ${n}`);
  }
  assert.equal((await service.status()).stash, false);
  assert.deepEqual(await service.history(100, "stash"), []);
  await assert.rejects(() => service.stashPop(), /没有可恢复/);
});

test("selected older stashes pop by hash even after stash numbers shift", async () => {
  const { root, service } = await fixture();
  for (let n = 1; n <= 3; n++) await write(root, `note-${n}.md`, "base\n");
  await service.stage(["note-1.md", "note-2.md", "note-3.md"]); await service.commit("base");
  const entries = [];
  for (let n = 1; n <= 3; n++) {
    await write(root, `note-${n}.md`, `saved-${n}\n`);
    await write(root, `new-${n}.md`, `new-${n}\n`);
    await service.stash(); entries[n] = (await service.stashHistory(100))[0];
    assert.ok((await service.stashFiles(entries[n].hash)).some((file) => file.path === `new-${n}.md`));
  }
  for (const n of [2, 1, 3]) {
    await service.stashPop(entries[n]);
    assert.equal(await fs.readFile(path.join(root, `note-${n}.md`), "utf8"), `saved-${n}\n`);
    assert.equal(await fs.readFile(path.join(root, `new-${n}.md`), "utf8"), `new-${n}\n`);
    assert.ok(!(await service.stashHistory(100)).some((entry) => entry.hash === entries[n].hash));
    await service.stage([`note-${n}.md`, `new-${n}.md`]); await service.commit(`save ${n}`);
    if (n === 2) await assert.rejects(() => service.stashPop(entries[n]), /已被移除/);
  }
  assert.equal((await service.status()).stash, false);
});

test("apply selected stash keeps records; a conflicting pop keeps the selected stash", async () => {
  const { root, service } = await fixture();
  await write(root, "note.md", "base\n"); await service.stage(["note.md"]); await service.commit("base");
  await write(root, "note.md", "older\n"); await service.stash();
  const older = (await service.stashHistory(100))[0];
  await write(root, "new.md", "latest\n"); await service.stash();
  const hashes = (await service.stashHistory(100)).map((entry) => entry.hash);
  await service.stashApply(older);
  assert.equal(await fs.readFile(path.join(root, "note.md"), "utf8"), "older\n");
  assert.deepEqual((await service.stashHistory(100)).map((entry) => entry.hash), hashes);
  await service.stage(["note.md"]); await service.commit("applied old change");
  await write(root, "note.md", "different\n"); await service.stage(["note.md"]); await service.commit("new version");
  await assert.rejects(() => service.stashPop(older), /Stash 仍保留/);
  assert.ok((await service.status()).files.some((file) => file.conflict));
  assert.deepEqual((await service.stashHistory(100)).map((entry) => entry.hash), hashes);
});

test("rebase onto selected commit moves current branch and preserves both branches' files", async () => {
  const { root, service } = await fixture();
  await write(root, "base.md", "base\n"); await service.stage(["base.md"]); await service.commit("base");
  git(root, "checkout", "-b", "target");
  await write(root, "target.md", "target\n"); await service.stage(["target.md"]); await service.commit("target");
  const target = git(root, "rev-parse", "HEAD").trim();
  git(root, "checkout", "main");
  await write(root, "local.md", "local\n"); await service.stage(["local.md"]); await service.commit("local");
  await write(root, "dirty.md", "keep\n");
  await assert.rejects(() => service.rebaseOnto(target), /先提交或 Stash/);
  await fs.unlink(path.join(root, "dirty.md"));
  await service.rebaseOnto(target);
  assert.equal(git(root, "rev-parse", "HEAD^").trim(), target);
  assert.equal(git(root, "branch", "--show-current").trim(), "main");
  assert.equal(await fs.readFile(path.join(root, "target.md"), "utf8"), "target\n");
  assert.equal(await fs.readFile(path.join(root, "local.md"), "utf8"), "local\n");
  await assert.rejects(() => service.rebaseOnto("--all"), /无效/);
});

test("stage uses literal paths and cannot accidentally stage wildcard matches", async () => {
  const { root, service } = await fixture();
  await write(root, "[abc].md", "literal\n");
  await write(root, "a.md", "other\n");
  await service.stage(["[abc].md"]);
  assert.equal(groupsFor((await service.status()).files).staged.length, 1);
  assert.equal(groupsFor((await service.status()).files).staged[0].path, "[abc].md");
  await service.unstage(["[abc].md"]);
  assert.equal(groupsFor((await service.status()).files).staged.length, 0);
  assert.equal(await fs.readFile(path.join(root, "[abc].md"), "utf8"), "literal\n");
  await assert.rejects(() => service.stage(["../outside.md"]), /无效/);
});

test("unstage on an unborn branch preserves staged and later working content", async () => {
  const { root, service } = await fixture();
  await write(root, "new.md", "staged\n");
  await service.stage(["new.md"]);
  await write(root, "new.md", "later edit\n");
  await service.unstage(["new.md"]);
  assert.equal(groupsFor((await service.status()).files).staged.length, 0);
  assert.equal(await fs.readFile(path.join(root, "new.md"), "utf8"), "later edit\n");
});

test("discard restores the index version and preserves staged content and unrelated changes", async () => {
  const { root, service } = await fixture();
  await write(root, "note.md", "base\n");
  await service.stage(["note.md"]); await service.commit("base");
  await write(root, "note.md", "staged\n"); await service.stage(["note.md"]);
  await write(root, "note.md", "unstaged\n");
  await write(root, "unrelated.md", "keep\n");
  await service.discard("note.md");
  assert.equal(await fs.readFile(path.join(root, "note.md"), "utf8"), "staged\n");
  assert.equal(git(root, "show", ":note.md"), "staged\n");
  assert.equal(git(root, "show", "HEAD:note.md"), "base\n");
  assert.equal(await fs.readFile(path.join(root, "unrelated.md"), "utf8"), "keep\n");
  await assert.rejects(() => service.discard("note.md"), /没有未暂存/);
});

test("discard restores a deleted file and treats wildcard and option-like names literally", async () => {
  const { root, service } = await fixture();
  for (const name of ["[abc].md", "a.md", "--note.md"]) await write(root, name, "base\n");
  await service.stage(["[abc].md", "a.md", "--note.md"]); await service.commit("base");
  await fs.unlink(path.join(root, "[abc].md"));
  await write(root, "a.md", "keep edit\n");
  await write(root, "--note.md", "discard edit\n");
  await service.discard("[abc].md"); await service.discard("--note.md");
  assert.equal(await fs.readFile(path.join(root, "[abc].md"), "utf8"), "base\n");
  assert.equal(await fs.readFile(path.join(root, "--note.md"), "utf8"), "base\n");
  assert.equal(await fs.readFile(path.join(root, "a.md"), "utf8"), "keep edit\n");
});

test("discard protects untracked files and rejects paths outside the worktree", async () => {
  const { root, service } = await fixture();
  await write(root, "new.md", "not in Git\n");
  await assert.rejects(() => service.discard("new.md"), /回收站/);
  assert.equal(await fs.readFile(path.join(root, "new.md"), "utf8"), "not in Git\n");
  await assert.rejects(() => service.discard("../outside.md"), /无效/);
  await assert.rejects(() => service.discard(".git/config"), /无效/);
  await assert.rejects(() => service.discard("missing.md"), /没有未暂存/);
});

test("rename, deletion and unstage retain working files", async () => {
  const { root, service } = await fixture();
  await write(root, "旧名字.md", "keep content\n");
  await write(root, "delete.md", "delete me\n");
  await service.stage(["旧名字.md", "delete.md"]);
  await service.commit("initial");
  git(root, "mv", "旧名字.md", "新名字.md");
  const renamed = (await service.status()).files[0];
  assert.equal(renamed.oldPath, "旧名字.md");
  const patch = (await service.diff(renamed, "staged")).patch;
  assert.match(patch, /新名字/);
  assert.match(patch, /旧名字/);
  await service.unstage([renamed.path, renamed.oldPath]);
  assert.equal(await fs.readFile(path.join(root, "新名字.md"), "utf8"), "keep content\n");
  await fs.unlink(path.join(root, "delete.md"));
  await service.stage(["delete.md"]);
  assert.equal(groupsFor((await service.status()).files).staged.find((file) => file.path === "delete.md").index, "D");
  await service.unstage(["delete.md"]);
  assert.equal((await service.status()).files.find((file) => file.path === "delete.md").worktree, "D");
});

test("untracked text and binary previews are handled without modifying the index", async () => {
  const { root, service } = await fixture();
  await write(root, "note.md", "one\ntwo\n");
  await fs.writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]));
  const state = await service.status();
  const note = state.files.find((file) => file.path === "note.md");
  const binary = state.files.find((file) => file.path === "binary.bin");
  assert.match((await service.diff(note, "unstaged")).patch, /\+one\n\+two/);
  assert.match((await service.diff(binary, "unstaged")).message, /二进制/);
  assert.equal(groupsFor((await service.status()).files).staged.length, 0);
});

test("editable versions load complete index and worktree content without staging later edits", async () => {
  const { root, service } = await fixture();
  const name = "[中文 空格].md";
  const staged = "unchanged before\nstaged\n" + "context\n".repeat(12) + "unchanged after\n";
  await write(root, name, "base\n"); await service.stage([name]); await service.commit("base");
  await write(root, name, staged); await service.stage([name]);
  const working = staged.replace("staged", "working");
  await write(root, name, working);
  assert.deepEqual(await service.worktreeVersions(name), { index: staged, working });
  assert.equal(git(root, "show", `:${name}`), staged);
  assert.equal(await fs.readFile(path.join(root, name), "utf8"), working);
});

test("editable snapshots reuse immutable index blobs and reload them after staging new content", async () => {
  const { root, service } = await fixture();
  await write(root, "note.md", "index one\n");
  await service.stage(["note.md"]);
  const originalRun = service.run;
  let commands = [];
  service.run = function (args, ...rest) { commands.push(args[0]); return originalRun.call(this, args, ...rest); };
  assert.equal((await service.worktreeVersions("note.md")).index, "index one\n");
  commands = [];
  await write(root, "note.md", "working change\n");
  const snapshot = await service.worktreeVersions("note.md");
  assert.equal(snapshot.index, "index one\n");
  assert.equal(snapshot.working, "working change\n");
  assert.deepEqual(commands, ["status", "ls-files"]);
  await service.stage(["note.md"]);
  assert.equal((await service.worktreeVersions("note.md")).index, "working change\n");
  assert.equal(commands.filter((cmd) => cmd === "cat-file").length, 2);
});

test("editable versions handle untracked empty files and retain CRLF and UTF-8 BOM", async () => {
  const { root, service } = await fixture();
  await write(root, "empty.md", "");
  assert.deepEqual(await service.worktreeVersions("empty.md"), { index: "", working: "" });
  await write(root, "note.md", "\ufefffirst\r\nsecond\r\n");
  assert.equal((await service.worktreeVersions("note.md")).working, "\ufefffirst\r\nsecond\r\n");
});

test("editable versions reject binary, invalid UTF-8, oversized files and unsafe paths", async () => {
  const { root, service } = await fixture();
  await fs.writeFile(path.join(root, "binary.md"), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(root, "invalid.md"), Buffer.from([0xc3, 0x28]));
  await fs.writeFile(path.join(root, "large.md"), Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  for (const name of ["binary.md", "invalid.md", "large.md"]) await assert.rejects(() => service.worktreeVersions(name), /UTF-8/);
  await assert.rejects(() => service.worktreeVersions("../outside.md"), /无效/);
  await assert.rejects(() => service.worktreeVersions(".git/config"), /无效/);
  await service.stage(["large.md"]); await write(root, "large.md", "small\n");
  await assert.rejects(() => service.worktreeVersions("large.md"), /UTF-8/);
});

test("editable versions reject symbolic links rather than editing their targets", async (context) => {
  const { root, service } = await fixture();
  await write(root, "target.md", "keep\n");
  try { await fs.symlink(path.join(root, "target.md"), path.join(root, "link.md")); }
  catch (error) { if (error.code === "EPERM") { context.skip("OS does not permit symlinks"); return; } throw error; }
  await assert.rejects(() => service.worktreeVersions("link.md"), /不支持/);
  assert.equal(await fs.readFile(path.join(root, "target.md"), "utf8"), "keep\n");
});

test("split diff pairs deletion and addition lines with correct line numbers", () => {
  const rows = splitPatch("--- a/note.md\n+++ b/note.md\n@@ -1,3 +1,4 @@\n same\n-old\n+new\n+extra\n end\n");
  const changes = rows.filter((row) => row.kind === "change");
  assert.deepEqual(changes[0], { kind: "change", left: { line: 2, text: "old" }, right: { line: 2, text: "new" } });
  assert.deepEqual(changes[1], { kind: "change", left: null, right: { line: 3, text: "extra" } });
  assert.equal(rows.at(-1).left.line, 3);
  assert.equal(rows.at(-1).right.line, 4);
  const multiple = splitPatch("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-before\n+after\n");
  assert.equal(multiple.filter((row) => row.kind === "change").length, 2);
  assert.equal(multiple.filter((row) => row.kind === "meta" && row.text.startsWith("---")).length, 2);
});

test("push and pull/rebase work against a local remote and protect dirty working trees", async () => {
  const { root, service } = await fixture();
  const remote = path.join(root, ".git", "test-remote.git");
  git(root, "init", "--bare", remote);
  await write(root, "local.md", "initial\n");
  await service.stage(["local.md"]);
  await service.commit("initial");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-u", "origin", "main");
  await write(root, "local.md", "local edit\n");
  await assert.rejects(() => service.pull(), /先提交/);
  await service.stage(["local.md"]);
  await service.commit("local edit");
  await service.push();
  const peer = await fs.mkdtemp(path.join(os.tmpdir(), "vaultbranch-peer-"));
  cleanup.push(peer);
  git(peer, "clone", "--branch", "main", remote, ".");
  git(peer, "config", "user.name", "Peer");
  git(peer, "config", "user.email", "peer@example.invalid");
  await write(peer, "remote.md", "from remote\n");
  git(peer, "add", "--", "remote.md");
  git(peer, "commit", "-m", "remote change");
  git(peer, "push");
  await write(root, "local-only.md", "not pushed\n");
  await service.stage(["local-only.md"]);
  await service.commit("local-only commit");
  await service.pull();
  assert.equal(await fs.readFile(path.join(root, "remote.md"), "utf8"), "from remote\n");
  assert.equal(git(root, "log", "-1", "--format=%s").trim(), "local-only commit");
  assert.equal(git(root, "log", "--merges", "--format=%h").trim(), "");
  await service.push();
  assert.equal((await service.status()).ahead, 0);
});

test("conflicted rebase is detected and blocks normal commit/pull/push", async () => {
  const { root, service } = await fixture();
  await write(root, "conflict.md", "base\n");
  await service.stage(["conflict.md"]);
  await service.commit("base");
  git(root, "checkout", "-b", "other");
  await write(root, "conflict.md", "other\n");
  await service.stage(["conflict.md"]);
  await service.commit("other");
  git(root, "checkout", "main");
  await write(root, "conflict.md", "main\n");
  await service.stage(["conflict.md"]);
  await service.commit("main");
  assert.throws(() => git(root, "rebase", "other"));
  const status = await service.status();
  assert.equal(status.operation, "rebase");
  assert.equal(groupsFor(status.files).conflicts.length, 1);
  await assert.rejects(() => service.commit("wrong"), /正在进行 rebase/);
  await assert.rejects(() => service.pull(), /正在进行 rebase/);
  await assert.rejects(() => service.push(), /正在进行 rebase/);
  await assert.rejects(() => service.discard("conflict.md"), /正在进行 rebase/);
  git(root, "rebase", "--abort");
});

test("a vault nested inside another repository is rejected", async () => {
  const { root } = await fixture();
  await fs.mkdir(path.join(root, "nested"));
  const nested = new GitService(path.join(root, "nested"));
  await assert.rejects(() => nested.init(), /不是 Git 仓库根目录/);
});

test("history cache rechecks refs and HEAD, updates external changes and skips unchanged log queries", async () => {
  const { root, service } = await fixture();
  assert.deepEqual((await service.historyData()).commits, []);
  await write(root, "note.md", "base\n"); await service.stage(["note.md"]); await service.commit("base");
  const first = await service.historyData();
  const commands = [], run = service.run.bind(service);
  service.run = (args, options) => { commands.push(args[0]); return run(args, options); };
  assert.equal(await service.historyData(), first);
  assert.deepEqual(commands.sort(), ["show-ref", "stash"]);
  assert.equal(first.currentBranch, "main");
  git(root, "branch", "same-tip");
  const added = await service.historyData();
  assert.notEqual(added, first);
  assert.ok(added.branches.includes("same-tip"));
  git(root, "switch", "same-tip");
  const switched = await service.historyData();
  assert.notEqual(switched, added, "same-tip branch switch invalidates HEAD decorations");
  assert.equal(switched.currentBranch, "same-tip");
  assert.match(switched.commits[0].refs, /HEAD -> same-tip/);
  git(root, "checkout", "--detach", "HEAD");
  const detached = await service.historyData();
  assert.equal(detached.currentBranch, "");
  assert.notEqual(detached, switched);
  git(root, "tag", "external-tag");
  const tagged = await service.historyData();
  assert.match(tagged.commits[0].refs, /external-tag/);
  git(root, "update-ref", "refs/remotes/origin/new", "HEAD");
  assert.ok((await service.historyData()).branches.includes("origin/new"));
  const branchPage = await service.historyData(100, "refs/heads/main");
  assert.equal(branchPage.commits.length, 1);
  assert.notEqual(await service.historyData(10, "refs/heads/main"), branchPage);
  const page = await service.historyData();
  assert.notEqual(await service.historyData(100, "", true), page, "manual refresh bypasses the cache");
});

test("history cache observes older stash deletion even when refs/stash is unchanged", async () => {
  const { root, service } = await fixture();
  await write(root, "note.md", "base\n"); await service.stage(["note.md"]); await service.commit("base");
  for (let i = 0; i < 3; i++) { await write(root, "note.md", `stash ${i}\n`); await service.stash(); }
  const page = await service.historyData();
  const tip = git(root, "rev-parse", "refs/stash");
  git(root, "stash", "drop", "stash@{1}");
  assert.equal(git(root, "rev-parse", "refs/stash"), tip);
  const changed = await service.historyData();
  assert.notEqual(changed, page);
  assert.equal(changed.commits.filter(commit => commit.stash).length, 2);
  assert.deepEqual(changed.commits.filter(commit => commit.stash).map(commit => commit.stashRef), ["stash@{0}", "stash@{1}"]);
  assert.equal((await service.historyData(100, "stash")).commits.length, 2);
  assert.equal((await service.historyData(100, "main")).commits.some(commit => commit.stash), false);
});

test("branch creation and switching preserve compatible staged and working changes", async () => {
  const { root, service } = await fixture();
  await write(root, "note.md", "base\n"); await service.stage(["note.md"]); await service.commit("base");
  const head = git(root, "rev-parse", "HEAD").trim();
  await write(root, "note.md", "staged\n"); await service.stage(["note.md"]); await write(root, "note.md", "working\n");
  await write(root, "untracked.md", "keep\n");
  await service.createBranch("feature/中文");
  assert.equal(git(root, "branch", "--show-current").trim(), "feature/中文");
  assert.equal(git(root, "rev-parse", "HEAD").trim(), head, "creation does not commit");
  await service.switchBranch("main");
  assert.equal(git(root, "show", ":note.md"), "staged\n");
  assert.equal(await fs.readFile(path.join(root, "note.md"), "utf8"), "working\n");
  assert.equal(await fs.readFile(path.join(root, "untracked.md"), "utf8"), "keep\n");
  assert.deepEqual((await service.localBranches()).map(branch => [branch.name, branch.current]), [["feature/中文", false], ["main", true]]);
});

test("branch switching refuses overwrites, and creation from a selected commit does not reset existing branches", async () => {
  const { root, service } = await fixture();
  await write(root, "note.md", "base\n"); await service.stage(["note.md"]); await service.commit("base");
  const base = git(root, "rev-parse", "HEAD").trim();
  await service.createBranch("target");
  await write(root, "note.md", "target\n"); await service.stage(["note.md"]); await service.commit("target");
  await service.switchBranch("main"); await write(root, "note.md", "local\n");
  await assert.rejects(service.switchBranch("target"), /overwritten|local changes/i);
  assert.equal(git(root, "branch", "--show-current").trim(), "main");
  assert.equal(await fs.readFile(path.join(root, "note.md"), "utf8"), "local\n");
  await service.discard("note.md"); await service.switchBranch("target");
  const target = git(root, "rev-parse", "HEAD").trim();
  await service.createBranch("from-selected", base);
  assert.equal(git(root, "rev-parse", "HEAD").trim(), base);
  assert.equal(git(root, "rev-parse", "target").trim(), target);
  await assert.rejects(service.createBranch("target"), /already exists/i);
  for (const name of ["--force", "@{-1}", "HEAD", "refs/heads/main", "bad\0name", "bad name"]) await assert.rejects(service.switchBranch(name));
  assert.equal(git(root, "branch", "--show-current").trim(), "from-selected");
  await fs.writeFile(path.join(service.gitDir, "MERGE_HEAD"), target+"\n");
  await assert.rejects(service.switchBranch("main"), /merge/);
  await assert.rejects(service.createBranch("blocked"), /merge/);
});

test("history shows merge parents and branch lanes; commit details use the first parent", async () => {
  const { root, service } = await fixture();
  assert.deepEqual(await service.history(), []);
  await write(root, "base.md", "base\n"); await service.stage(["base.md"]); await service.commit("base");
  const first = git(root, "rev-parse", "HEAD").trim();
  const rootFiles = await service.commitFiles(first);
  assert.equal(rootFiles[0].path, "base.md");
  assert.match((await service.commitDiff(rootFiles[0])).patch, /\+base/);
  git(root, "checkout", "-b", "feature");
  await write(root, "feature.md", "feature\n"); await service.stage(["feature.md"]); await service.commit("feature");
  git(root, "checkout", "main");
  await write(root, "main.md", "main\n"); await service.stage(["main.md"]); await service.commit("main");
  git(root, "merge", "--no-ff", "feature", "-m", "merge feature");
  const history = await service.history();
  assert.equal(history.length, 4);
  assert.equal(history[0].parents.length, 2);
  assert.equal(history[0].edges.length, 2);
  assert.ok(history.some((row) => row.width === 2));
  assert.equal(history.at(-1).hash, first);
  assert.equal(history.at(-1).parents.length, 0);
  const mergeFiles = await service.commitFiles(history[0].hash);
  assert.deepEqual(mergeFiles.map((file) => file.path), ["feature.md"]);
  assert.match((await service.commitDiff(mergeFiles[0])).patch, /\+feature/);
});

async function twoClones() {
  const { root, service } = await fixture();
  const remote = path.join(root, ".git", "remote.git");
  git(root, "init", "--bare", remote);
  await write(root, "conflict.md", "base\n"); await service.stage(["conflict.md"]); await service.commit("base");
  git(root, "remote", "add", "origin", remote); git(root, "push", "-u", "origin", "main");
  const peer = await fs.mkdtemp(path.join(os.tmpdir(), "vaultbranch-conflict-peer-")); cleanup.push(peer);
  git(peer, "clone", "--branch", "main", remote, ".");
  git(peer, "config", "user.name", "Peer"); git(peer, "config", "user.email", "peer@example.invalid");
  git(peer, "config", "core.autocrlf", "false");
  const other = new GitService(peer); await other.init();
  return { root, service, peer, other };
}

test("non-fast-forward push is rejected without force; pull conflict can be resolved, continued and pushed", async () => {
  const { root, service, peer, other } = await twoClones();
  await write(root, "conflict.md", "local edit\n"); await service.stage(["conflict.md"]); await service.commit("local change");
  await write(peer, "conflict.md", "remote edit\n"); await other.stage(["conflict.md"]); await other.commit("remote change"); await other.push();
  const localBefore = git(root, "rev-parse", "HEAD").trim();
  await assert.rejects(() => service.push(), /Push 被拒绝/);
  assert.equal(git(root, "rev-parse", "HEAD").trim(), localBefore);
  await assert.rejects(() => service.pull(), /[Cc][Oo][Nn][Ff][Ll][Ii][Cc][Tt]|could not apply/);
  const state = await service.status();
  assert.equal(state.operation, "rebase"); assert.equal(groupsFor(state.files).conflicts.length, 1);
  const versions = await service.conflictVersions("conflict.md");
  assert.equal(versions.base, "base\n"); assert.equal(versions.ours, "remote edit\n"); assert.equal(versions.theirs, "local edit\n");
  assert.match(versions.oursLabel, /上游/); assert.match(versions.theirsLabel, /本地/);
  await assert.rejects(() => service.continueOperation(), /未解决/);
  await assert.rejects(() => service.resolveConflict("conflict.md", versions.result), /冲突标记/);
  await assert.rejects(() => service.resolveConflict("conflict.md", "resolved\n", "stale content"), /其他编辑器/);
  await service.resolveConflict("conflict.md", "remote edit\nlocal edit\n", versions.result);
  assert.equal(groupsFor((await service.status()).files).conflicts.length, 0);
  await write(root, "conflict.md", "late un-staged edit\n");
  await assert.rejects(() => service.continueOperation(), /未暂存/);
  await write(root, "conflict.md", "remote edit\nlocal edit\n");
  await service.continueOperation(); assert.equal((await service.status()).operation, null);
  await service.push(); await other.pull();
  assert.equal(await fs.readFile(path.join(peer, "conflict.md"), "utf8"), "remote edit\nlocal edit\n");
});

test("aborting a pull/rebase conflict restores the original local commit and worktree", async () => {
  const { root, service, peer, other } = await twoClones();
  await write(root, "conflict.md", "local\n"); await service.stage(["conflict.md"]); await service.commit("local");
  const original = git(root, "rev-parse", "HEAD").trim();
  await write(peer, "conflict.md", "remote\n"); await other.stage(["conflict.md"]); await other.commit("remote"); await other.push();
  await assert.rejects(() => service.pull());
  await service.abortOperation();
  assert.equal(git(root, "rev-parse", "HEAD").trim(), original);
  assert.equal(await fs.readFile(path.join(root, "conflict.md"), "utf8"), "local\n");
  assert.equal((await service.status()).operation, null);
});

test("merge pull conflicts use current/incoming labels and can finish a merge commit", async () => {
  const { root, service, peer, other } = await twoClones();
  service.pullMethod = "merge";
  await write(root, "conflict.md", "local\n"); await service.stage(["conflict.md"]); await service.commit("local");
  await write(peer, "conflict.md", "remote\n"); await other.stage(["conflict.md"]); await other.commit("remote"); await other.push();
  await assert.rejects(() => service.pull());
  const versions = await service.conflictVersions("conflict.md");
  assert.equal(versions.operation, "merge"); assert.equal(versions.ours, "local\n"); assert.equal(versions.theirs, "remote\n");
  await service.resolveConflict("conflict.md", "local\nremote\n", versions.result); await service.continueOperation(); await service.push();
  assert.equal((await service.history())[0].parents.length, 2);
});

test("settings tracking unmasks only VaultBranch settings and never stages unrelated files", async () => {
  const { root, service } = await fixture();
  await write(root, ".gitignore", ".obsidian/\n");
  await write(root, ".obsidian/plugins/vaultbranch/data.json", '{"refreshSeconds":5}\n');
  await write(root, ".obsidian/plugins/other/data.json", "private\n");
  await write(root, ".obsidian/workspace.json", "local UI\n");
  assert.equal((await service.settingsTracking()).ignored, true);
  await service.enableSettingsTracking();
  assert.equal((await service.settingsTracking()).ignored, false);
  assert.equal(await service.ignored(".obsidian/plugins/other/data.json"), true);
  assert.equal(await service.ignored(".obsidian/workspace.json"), true);
  assert.equal(groupsFor((await service.status()).files).staged.length, 0);
  await service.stage([".gitignore", ".obsidian/plugins/vaultbranch/data.json"]); await service.commit("track settings");
  assert.equal((await service.settingsTracking()).tracked, true);
  await write(root, ".obsidian/plugins/vaultbranch/data.json", '{"refreshSeconds":10}\n');
  assert.equal((await service.status()).files.find((file) => file.path.endsWith("data.json")).worktree, "M");
});
