"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { t } = require("./i18n.js");
const { graphFor } = require("./git-data.js");
const { DIFF_OPTIONS } = require("./git-limits.js");

async function history(git, limit = 100, ref = "") { return (await git.historyData(limit, ref)).commits; }

async function historyData(git, limit = 100, ref = "", force = false) {
  limit = Math.max(10, Math.min(1000, Number(limit) || 100));
  const [refs, head, stashes] = await Promise.all([
    git.run(["show-ref", "--head"], { allowDiffExit: true }),
    fs.readFile(path.join(git.gitDir, "HEAD"), "utf8"),
    git.stashHistory(limit),
  ]);
  // Re-read mutable refs, HEAD and the stash reflog every time. Bound the cache to one page.
  const key = JSON.stringify([refs, head, stashes, limit, ref]);
  if (!force && git.historyCache?.key === key) return git.historyCache.data;
  const branches = refs.split("\n").map(line => line.slice(line.indexOf(" ")+1))
    .filter(name => name.startsWith("refs/heads/") || name.startsWith("refs/remotes/"))
    .map(name => name.replace(/^refs\/(heads|remotes)\//, ""));
  const currentBranch = head.startsWith("ref: refs/heads/") ? head.trim().slice(16) : "";
  const commits = ref === "stash" ? [] : await git.readHistory(limit, ref, refs);
  if (!ref || ref === "stash") commits.unshift(...stashes);
  const data = { commits: graphFor(commits), branches, hasStash: Boolean(stashes.length), currentBranch };
  git.historyCache = { key, data };
  return data;
}

async function readHistory(git, limit, ref, refs) {
  if (!refs.split("\n").some(line => line && !line.endsWith(" refs/stash"))) return [];
  const selection = ref ? (await git.run(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).trim() : null;
  const output = await git.run(["log", ...(selection ? [selection] : ["--exclude=refs/stash", "--all"]), "--topo-order", `--max-count=${Math.max(10, Math.min(1000, Number(limit) || 100))}`,
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

async function fileHistory(git, filePath, { all = false, limit = 50, graph = false } = {}) {
  git.checkPaths([filePath]);
  limit = Math.max(1, Math.min(1000, Number(limit) || 50));
  const head = (await git.run(["rev-parse", "--verify", "--quiet", "HEAD"], { allowDiffExit: true })).trim();
  if (!head && !all) return { commits: [], hasMore: false };
  const refs = all ? ["--branches", "--remotes", ...(head ? [head] : [])] : [head];
  if (!head && !(await git.run(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"])).trim()) return { commits: [], hasMore: false };
  const paths = new Set([filePath]);
  if (all && head) {
    // A combined --follow walk can miss forks made before a rename. Seed it with
    // the current lineage's old names, including renames beyond this page.
    const renames = (await git.run(["log", head, "--follow", "--find-renames", "--diff-filter=R", "--max-count=1000", "--name-status", "-z", "--format=", "--", filePath])).split("\0").filter(Boolean);
    for (let n = 0; n + 2 < renames.length; n += 3) {
      git.checkPaths([renames[n + 1], renames[n + 2]]);
      paths.add(renames[n + 1]); paths.add(renames[n + 2]);
    }
  }
  const entries = new Map();
  for (const name of paths) for (const commit of await git.readFileHistory(name, refs, limit + 1)) {
    if (!entries.has(commit.hash)) entries.set(commit.hash, commit);
  }
  const commits = [...entries.values()].sort((a, b) => b.timestamp - a.timestamp);
  const page = commits.slice(0, limit);
  return { commits: graph && page.length ? await git.fileHistoryGraph(page, refs, all) : page, hasMore: commits.length > limit && limit < 1000 };
}

async function fileHistoryGraph(git, commits, refs, all) {
  // The current branch is one ancestry line when there are no visible merges.
  // Project skipped unrelated commits onto displayed rows without another process.
  if (!all && commits.every(commit => commit.parents.length <= 1)) {
    return graphFor(commits.map((commit, index) => ({ ...commit,
      graphParents: index + 1 < commits.length ? [commits[index + 1].hash] : [],
    })));
  }
  const paths = [...new Set(commits.flatMap(commit => [commit.path, commit.oldPath].filter(Boolean)))];
  // Git rewrites parents across commits hidden by path filtering. Retain merge
  // connectors, then project them onto visible file-history entries in one read.
  const output = await git.run(["rev-list", "--parents", "--topo-order", "--full-history", "--max-count=10000", ...refs, "--", ...paths]);
  const topology = new Map(output.trim().split("\n").filter(Boolean).map(line => {
    const [hash, ...parents] = line.trim().split(" "); return [hash, parents];
  }));
  const visible = new Set(commits.map(commit => commit.hash));
  const nearest = hash => {
    const found = new Set(), seen = new Set(), pending = [hash];
    while (pending.length) {
      const current = pending.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      if (visible.has(current) || !topology.has(current)) found.add(current);
      else pending.push(...topology.get(current));
    }
    // Preserve an ancestry continuation below this page instead of inventing a root.
    return found.size ? [...found] : [hash];
  };
  const order = new Map([...topology.keys()].map((hash, index) => [hash, index]));
  return graphFor(commits.map(commit => ({ ...commit,
    graphParents: [...new Set((topology.get(commit.hash) || commit.parents).flatMap(nearest))],
  })).sort((a, b) => (order.get(a.hash) ?? Infinity) - (order.get(b.hash) ?? Infinity)));
}

async function readFileHistory(git, filePath, refs, limit) {
  const fields = (await git.run(["log", ...refs, "--follow", "--find-renames", "--diff-merges=first-parent", "--date-order",
    `--max-count=${limit}`, "--name-status", "-z", "--format=%H%x00%P%x00%an%x00%aI%x00%ct%x00%s", "--", filePath])).split("\0");
  const commits = [];
  let i = 0;
  while (i < fields.length && fields[i]) {
    const [hash, parents, author, date, timestamp, subject] = fields.slice(i, i + 6);
    git.checkCommit(hash);
    i += 6;
    let file;
    while (/^\n?[A-Z][0-9]*$/.test(fields[i] || "")) {
      const status = fields[i++].trim();
      const first = fields[i++];
      const renamed = status[0] === "R" || status[0] === "C";
      const current = renamed ? fields[i++] : first;
      git.checkPaths([current, ...(renamed ? [first] : [])]);
      file = { path: current, oldPath: renamed ? first : null, index: status[0], worktree: " ", commit: hash };
    }
    if (file) commits.push({ hash, parents: parents.split(" ").filter(Boolean), short: hash.slice(0, 7), author, date, timestamp: Number(timestamp), subject, ...file });
  }
  return commits;
}

async function commitFiles(git, hash) {
  const parent = await git.firstParent(hash);
  const args = ["diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--no-renames"];
  if (parent) args.push(parent, hash);
  else args.push("--root", hash);
  const fields = (await git.run(args)).split("\0");
  const files = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i]) files.push({ path: fields[i + 1], index: fields[i][0], worktree: " ", commit: hash });
  }
  return files;
}

async function commitDiff(git, file, timing) {
  git.checkPaths([file.path]);
  const parent = await git.firstParent(file.commit, timing);
  const args = parent ? ["diff", ...DIFF_OPTIONS, parent, file.commit, "--", file.path]
    : ["show", ...DIFF_OPTIONS, "--format=", "--root", file.commit, "--", file.path];
  return git.preview(args, t("没有文本差异。"), timing);
}

module.exports = { history, historyData, readHistory, fileHistory, fileHistoryGraph, readFileHistory, commitFiles, commitDiff };
