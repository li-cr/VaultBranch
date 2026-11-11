"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const main = path.resolve(__dirname, "../src/main.js");
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const localRequire = createRequire(file);
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    module, setTimeout, clearTimeout,
    require: (name) => {
      if (name === "obsidian") return { Plugin: class {}, ItemView: class {}, PluginSettingTab: class {}, FuzzySuggestModal: class {}, setIcon() {} };
      const resolved = localRequire.resolve(name);
      return resolved.startsWith(path.join(__dirname, "../src/views/")) || ["settings.js", "branches.js"].some(name => resolved === path.join(__dirname, "../src/", name)) ? load(resolved) : localRequire(name);
    },
  }, { filename: file });
  return module.exports;
}
const Plugin = load(main);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("rapid file clicks keep the latest MD/hidden-JSON request visible even when loading times differ", async () => {
  const plugin = new Plugin();
  const calls = [];
  let visible;
  plugin.openView = async (_, { file }) => {
    calls.push(file.path);
    await pause(file.delay);
    visible = file.path;
    return file.path;
  };
  const files = [
    { path: "note.md", delay: 25 },
    { path: "regular.json", delay: 10 },
    { path: ".obsidian/plugins/example/data.json", delay: 0 },
  ];
  await Promise.all(files.map((file) => plugin.openDiff(file, "unstaged")));
  assert.deepEqual(calls, files.map((file) => file.path));
  assert.equal(visible, files.at(-1).path);
});

test("an unsuccessful file open does not prevent a later JSON request from opening", async () => {
  const plugin = new Plugin();
  plugin.openView = async (_, { file }) => {
    if (file.path === "missing.md") throw new Error("missing");
    return file.path;
  };
  const first = plugin.openDiff({ path: "missing.md" }, "unstaged");
  const next = plugin.openDiff({ path: ".obsidian/example.json" }, "unstaged");
  await assert.rejects(first, /missing/);
  assert.equal(await next, ".obsidian/example.json");
});

test("hidden JSON uses adapter processing without a TFile and preserves the index", async () => {
  const plugin = new Plugin();
  const filePath = ".obsidian/plugins/example/data.json";
  plugin.settings = { diffAutosave: false };
  const index = '{"value":"index"}\n';
  let disk = '{"value":"working"}\n';
  let processes = 0;
  plugin.editSessions = new Map(); plugin.editorTasks = new Map(); plugin.diffDrafts = new Map();
  plugin.git = { worktreeVersions: async () => ({ index, working: disk }) };
  plugin.scheduleRefresh = () => {};
  plugin.app = {
    workspace: { requestSaveLayout() {} },
    vault: {
      getAbstractFileByPath: () => null,
      process: () => { throw new Error("Must use adapter for an unindexed file"); },
      adapter: { process: async (path, update) => { assert.equal(path, filePath); processes++; disk = update(disk); } },
    },
  };
  const session = await plugin.editorSession(filePath);
  session.edit('{"value":"edited"}\n');
  assert.equal(await session.flush(), true);
  assert.equal(disk, '{"value":"edited"}\n');
  assert.equal(session.draft.index, index);
  assert.equal(processes, 1);
  session.edit('{"value":"draft"}\n');
  disk = '{"value":"external"}\n';
  assert.equal(await session.flush(), false);
  assert.equal(session.draft.text, '{"value":"draft"}\n');
  assert.equal(disk, '{"value":"external"}\n');
  assert.equal(processes, 1);
});

test("non-Git settings update without refreshing the repository or rewriting unchanged preferences", async () => {
  const plugin = new Plugin();
  plugin.settings = { dateFormat: "YYYY", gitPath: "" };
  let saved = 0, refreshed = 0, rendered = 0;
  plugin.saveData = async () => { saved++; };
  plugin.refresh = async () => { refreshed++; };
  plugin.renderViews = () => { rendered++; };
  plugin.configureGit = () => {};
  assert.equal(await plugin.updateSetting("dateFormat", "YYYY-MM-DD"), true);
  assert.equal(saved, 1);
  assert.equal(refreshed, 0);
  assert.equal(rendered, 1);
  await plugin.updateSetting("dateFormat", "YYYY-MM-DD");
  assert.equal(saved, 1);
  await plugin.updateSetting("gitPath", "git-custom");
  assert.equal(refreshed, 1);
});

function editorFixture() {
  const plugin = new Plugin();
  plugin.settings = { diffAutosave: false };
  plugin.editSessions = new Map(); plugin.editorTasks = new Map(); plugin.diffDrafts = new Map();
  let disk = "working\n";
  plugin.git = { worktreeVersions: async () => ({ index: "index\n", working: disk }) };
  plugin.scheduleRefresh = () => {};
  plugin.app = {
    workspace: { requestSaveLayout() {} },
    vault: { getAbstractFileByPath: () => null, adapter: { process: async (_, update) => { disk = update(disk); } } },
  };
  return plugin;
}

test("shared clean editor sessions are released only after the last view releases them", async () => {
  const plugin = editorFixture();
  const [first, second] = await Promise.all([plugin.editorSession("a.json", true), plugin.editorSession("a.json", true)]);
  assert.equal(first, second);
  assert.equal(first.users, 2);
  plugin.releaseEditorSession("a.json", first);
  assert.equal(plugin.editSessions.get("a.json"), second);
  plugin.releaseEditorSession("a.json", second);
  assert.equal(plugin.editSessions.size, 0);
  assert.equal(plugin.diffDrafts.size, 0);
});

test("closed manual drafts survive reopening and are released after saving and closing", async () => {
  const plugin = editorFixture();
  const session = await plugin.editorSession("a.json", true);
  session.edit("unsaved draft\n");
  plugin.releaseEditorSession("a.json", session);
  assert.equal(plugin.editSessions.get("a.json"), session);
  const reopened = await plugin.editorSession("a.json", true);
  assert.equal(reopened, session);
  assert.equal(reopened.draft.text, "unsaved draft\n");
  await reopened.flush();
  plugin.releaseEditorSession("a.json", reopened);
  assert.equal(plugin.editSessions.size, 0);
  assert.equal(plugin.diffDrafts.size, 0);
});

test("closing during a pending save retains its session until the write finishes", async () => {
  const plugin = editorFixture();
  let begin, release;
  const started = new Promise((resolve) => { begin = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  plugin.app.vault.adapter.process = async (_, update) => { begin(); await blocked; assert.equal(update("working\n"), "saved\n"); };
  const session = await plugin.editorSession("a.json", true);
  session.edit("saved\n");
  const saving = session.flush();
  await started;
  plugin.releaseEditorSession("a.json", session);
  assert.equal(plugin.editSessions.get("a.json"), session);
  release();
  assert.equal(await saving, true);
  assert.equal(plugin.editSessions.size, 0);
  assert.equal(plugin.diffDrafts.size, 0);
});

test("return-context cleanup visits every leaf and only removes closed leaves", () => {
  const plugin = new Plugin();
  plugin.graphReturns = new Map([["first", {}], ["second", {}], ["closed", {}]]);
  plugin.app = { workspace: { iterateAllLeaves: (visit) => {
    for (const id of ["first", "second"]) if (visit({ id })) break;
  } } };
  plugin.pruneGraphReturns();
  assert.deepEqual([...plugin.graphReturns.keys()], ["first", "second"]);
});

const { DiffView } = load(path.resolve(__dirname, "../src/views/diff.js"));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function loadingFixture() {
  const document = { createElement: () => node() };
  function node() {
    return {
      ownerDocument: document, children: [], attributes: {},
      appendChild(child) { this.children.push(child); },
      empty() { this.children = []; }, replaceChildren() { this.empty(); },
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; },
      addEventListener() {}, querySelector() { return null; },
    };
  }
  const view = Object.create(DiffView.prototype), released = [], gate = deferred();
  const session = { listeners: new Set(), sync: async () => {}, autoFlush: async () => {} };
  view.contentEl = node();
  view.contentEl.children.push("complete previous page");
  Object.assign(view, { request: 0, stateRequest: 0, file: { path: "new.json" }, area: "unstaged", app: { keymap: { popScope() {} } } });
  view.plugin = {
    settings: {}, diffDrafts: new Map(), ensureReady: async () => {},
    editorSession: () => gate.promise,
    releaseEditorSession: (filePath, session) => released.push({ filePath, session }),
    setGraphReturn() {},
  };
  view.updateDiffNavigation = () => {};
  view.renderEditor = body => { body.appendChild("complete editor"); };
  return { view, session, gate, released };
}

test("diff loading commits a complete page only after data arrives and ignores refreshes while pending", async () => {
  const { view, session, gate } = loadingFixture();
  const opening = view.render(true);
  await Promise.resolve();
  assert.deepEqual(view.contentEl.children, ["complete previous page"]);
  assert.equal(view.contentEl.inert, true);
  assert.equal(view.contentEl.attributes["aria-busy"], "true");
  const request = view.request;
  await view.render();
  assert.equal(view.request, request, "background refresh must not replace the pending navigation");
  gate.resolve(session); await opening;
  assert.equal(view.contentEl.inert, false);
  assert.equal(view.contentEl.attributes["aria-busy"], undefined);
  assert.equal(view.contentEl.children[0].className, "vaultbranch-diff-header");
  assert.equal(view.contentEl.children[2].children[0], "complete editor");
});

test("switching releases the displayed session under its original path", async () => {
  const { view, session, gate, released } = loadingFixture();
  const old = { listeners: new Set() };
  view.session = old; view.sessionPath = "old.md";
  const opening = view.render(true);
  gate.resolve(session); await opening;
  assert.equal(released.length, 1);
  assert.equal(released[0].filePath, "old.md");
  assert.equal(released[0].session, old);
  assert.equal(view.sessionPath, "new.json");
});

test("closing a pending diff releases the late session without replacing the closed page", async () => {
  const { view, session, gate, released } = loadingFixture();
  const opening = view.render(true);
  await Promise.resolve();
  view.request++;
  gate.resolve(session); await opening;
  assert.deepEqual(view.contentEl.children, ["complete previous page"]);
  assert.equal(released.length, 1);
  assert.equal(released[0].filePath, "new.json");
  assert.equal(released[0].session, session);
});

test("a failed diff load clears busy state and allows a subsequent file to load", async () => {
  const { view, session } = loadingFixture();
  view.plugin.ensureReady = async () => { throw Error("unavailable"); };
  await view.render(true);
  assert.equal(view.contentEl.inert, false);
  assert.equal(view.contentEl.children[2].children[0].textContent, "unavailable");
  view.plugin.ensureReady = async () => {};
  view.plugin.editorSession = async () => session;
  await view.render(true);
  assert.equal(view.contentEl.children[2].children[0], "complete editor");
});

test("uneditable files still fall back to patch previews after preparation", async () => {
  const { view } = loadingFixture();
  view.plugin.editorSession = async () => { throw Error("size limit"); };
  view.plugin.git = { diff: async () => ({ message: "patch preview", patch: "" }) };
  await view.render(true);
  assert.equal(view.contentEl.children[2].children[0].textContent, "patch preview");
  assert.equal(view.contentEl.children[3].textContent, "size limit");
});
