"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const i18n = require("../src/i18n.js");
i18n.setLanguage("en");

class Node {
  constructor(classes = "") {
    this.children = []; this.dataset = {}; this.events = {}; this.attributes = {};
    const values = new Set(classes.split(" ").filter(Boolean));
    this.classList = {
      contains: name => values.has(name), add: name => values.add(name), remove: name => values.delete(name),
      toggle(name, enabled) { if (enabled) values.add(name); else values.delete(name); },
    };
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.events[name] = callback; }
  click() { this.events.click?.(); }
  querySelectorAll(selector) {
    const classes = selector.split(".").filter(Boolean), matches = [];
    for (const child of this.children) {
      if (classes.every(name => child.classList.contains(name))) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function harness() {
  const module = { exports: {} }, opened = [];
  const el = (parent, tag, classes, text) => {
    const node = new Node(classes); node.textContent = text; parent.children.push(node); return node;
  };
  const button = (parent, icon, label, callback) => {
    const node = el(parent, "button", "", label); node.addEventListener("click", callback); return node;
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../src/views/source.js"), "utf8"), {
    module, Intl, require(name) {
      if (name === "obsidian") return { ItemView: class {}, setIcon() {}, Notice: class {} };
      if (name === "../i18n.js") return i18n;
      if (name === "../git-data.js") return require("../src/git-data.js");
      if (name === "../branches.js") return {};
      if (name === "./shared.js") return { el, button, LABELS: { staged: "staged", unstaged: "unstaged", conflicts: "conflicts" }, STATUS_LABELS: {} };
      throw Error(name);
    },
  });
  const file = path => ({ path, index: "M", worktree: "M", conflict: false, untracked: false });
  const plugin = {
    settings: { language: "en" }, busy: false, status: { operation: null }, error: "",
    openDiff(file, area) { opened.push([file.path, area]); return Promise.resolve(); },
    openConflict(path) { opened.push([path, "conflicts"]); return Promise.resolve(); },
  };
  const view = new module.exports.SourceControlView({}, plugin);
  view.treeEl = new Node();
  const renderRows = (area, files) => view.renderTree(view.treeEl, { folders: new Map(), files: files.map(file) }, area, 0);
  return { view, plugin, opened, renderRows, rows: () => view.treeEl.querySelectorAll(".vaultbranch-file-row"), selected: () => view.treeEl.querySelectorAll(".vaultbranch-file-row.is-selected") };
}

test("selecting A then B retains every row and opens the requested diffs without rendering", () => {
  const h = harness(); h.renderRows("unstaged", ["A.md", "B.md"]);
  h.view.render = () => { throw Error("Selection rebuilt the sidebar"); };
  const [a, b] = h.rows();
  a.querySelector(".vaultbranch-file-open").click(); b.querySelector(".vaultbranch-file-open").click();
  assert.deepEqual(h.selected(), [b]);
  assert.deepEqual(h.rows(), [a, b]);
  assert.deepEqual(h.opened, [["A.md", "unstaged"], ["B.md", "unstaged"]]);
});

test("mixed staged/unstaged rows with the same special path and conflict navigation stay distinct", () => {
  const h = harness(), name = 'notes/中文 [a] "quote".md';
  for (const area of ["staged", "unstaged", "conflicts"]) h.renderRows(area, [name]);
  const rows = h.rows();
  rows.forEach((row, i) => {
    row.querySelector(".vaultbranch-file-open").click();
    assert.deepEqual(h.selected(), [row]);
    assert.equal(h.view.selected, ["staged", "unstaged", "conflicts"][i] + ":" + name);
  });
  assert.deepEqual(h.opened, [[name, "staged"], [name, "unstaged"], [name, "conflicts"]]);
  rows[2].querySelector(".vaultbranch-file-open").click();
  assert.equal(h.opened.length, 4, "clicking the selected file still opens it");
});

test("a subsequent unchanged status render retains the selected rows", () => {
  const h = harness(); h.renderRows("unstaged", ["A.md", "B.md"]);
  const rows = h.rows();
  h.view.updateButtons = () => {};
  h.view.renderSnapshot = JSON.stringify([h.plugin.status, h.plugin.busy, h.plugin.error, [...h.view.collapsed], h.plugin.settings.language]);
  rows[1].querySelector(".vaultbranch-file-open").click();
  h.view.render();
  assert.deepEqual(h.rows(), rows); assert.deepEqual(h.selected(), [rows[1]]);
});

test("rebuilding after a real status change restores the exact selected group", () => {
  const h = harness(); h.renderRows("unstaged", ["A.md", "B.md"]);
  h.rows()[1].querySelector(".vaultbranch-file-open").click();
  h.view.treeEl = new Node();
  h.renderRows("staged", ["B.md"]); h.renderRows("unstaged", ["B.md", "C.md"]);
  assert.equal(h.rows().length, 3); assert.equal(h.selected().length, 1);
  assert.equal(h.selected()[0], h.rows()[1]);
});
