"use strict";

const CONFLICTS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function graphFor(commits) {
  let lanes = [];
  return commits.map((commit) => {
    const parents = commit.graphParents || commit.parents;
    const incoming = lanes.includes(commit.hash);
    if (!incoming) lanes.push(commit.hash);
    const before = [...lanes];
    const column = lanes.indexOf(commit.hash);
    lanes.splice(column, 1);
    for (let i = 0; i < parents.length; i++) {
      const parent = parents[i];
      if (!lanes.includes(parent)) lanes.splice(Math.min(column + i, lanes.length), 0, parent);
    }
    const edges = [];
    for (let i = 0; i < before.length; i++) {
      if (i !== column) edges.push({ from: i, to: lanes.indexOf(before[i]), through: true });
    }
    for (const parent of parents) edges.push({ from: column, to: lanes.indexOf(parent), through: false });
    return { ...commit, column, incoming, before, after: [...lanes], edges, width: Math.max(before.length, lanes.length, 1) };
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

module.exports = { parseStatus, groupsFor, treeFor, splitPatch, graphFor };
