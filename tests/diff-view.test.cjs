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
      if (name === "obsidian") return { Plugin: class {}, ItemView: class { async setState() {} }, PluginSettingTab: class {}, FuzzySuggestModal: class {}, setIcon() {} };
      const resolved = localRequire.resolve(name);
      return resolved.startsWith(path.join(__dirname, "../src/views/")) || ["settings.js", "branches.js"].some(name => resolved === path.join(__dirname, "../src/", name)) ? load(resolved) : localRequire(name);
    },
  }, { filename: file });
  return module.exports;
}
const Plugin = load(main);

function navigationFixture() {
  const plugin = new Plugin();
  const leaf = { view: {}, updateHeader() {} };
  plugin.app = { workspace: { getLeavesOfType: () => [leaf], revealLeaf: async () => {}, requestSaveLayout() {} } };
  plugin.isView = () => true;
  return { plugin, leaf };
}

test("B opens before A finishes, and superseded requests cannot overwrite B", async () => {
  const { plugin, leaf } = navigationFixture(), gate = deferred(), started = deferred();
  const calls = []; let visible, request = 0;
  leaf.view.setState = async ({ file }) => {
    const current = ++request; calls.push(file.path);
    if (file.path === "large.json") { started.resolve(); await gate.promise; }
    if (current === request) visible = file.path;
  };
  const first = plugin.openDiff({ path: "large.json" }, "unstaged");
  await started.promise;
  await plugin.openDiff({ path: ".obsidian/plugins/example/data.json" }, "unstaged");
  assert.equal(visible, ".obsidian/plugins/example/data.json", "B must not wait for A's read/verification");
  gate.resolve(); await first;
  assert.equal(visible, ".obsidian/plugins/example/data.json");
  assert.deepEqual(calls, ["large.json", ".obsidian/plugins/example/data.json"]);
});

test("rapid initial clicks share one native view creation and skip superseded reads", async () => {
  const { plugin, leaf } = navigationFixture(), gate = deferred(), calls = [];
  plugin.isView = view => view === leaf.view;
  plugin.app.workspace.getLeavesOfType = () => [];
  let created = 0;
  plugin.openView = async () => { created++; await gate.promise; return leaf; };
  leaf.view.setState = async ({ file }) => { calls.push(file.path); };
  const requests = ["a.md", "b.json", "deep/last.md"].map(path => plugin.openDiff({ path }, "unstaged"));
  assert.equal(created, 1);
  gate.resolve(); await Promise.all(requests);
  assert.deepEqual(calls, ["deep/last.md"]);
});

test("an unsuccessful file open does not prevent a later JSON request from opening", async () => {
  const { plugin, leaf } = navigationFixture();
  leaf.view.setState = async ({ file }) => {
    if (file.path === "missing.md") throw new Error("missing");
  };
  const first = plugin.openDiff({ path: "missing.md" }, "unstaged");
  await assert.rejects(first, /missing/);
  assert.equal(await plugin.openDiff({ path: ".obsidian/example.json" }, "unstaged"), leaf);
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
    git: {}, settings: {}, diffDrafts: new Map(), ensureReady: async () => {},
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

test("an obsolete read releases its session while a newer file becomes ready first", async () => {
  const { view, session, gate, released } = loadingFixture();
  const other = { ...session, listeners: new Set() };
  view.plugin.editorSession = path => path === "large.json" ? gate.promise : Promise.resolve(other);
  const first = view.setState({ file: { path: "large.json" } }, {});
  await Promise.resolve(); await Promise.resolve();
  await view.setState({ file: { path: "small.md" } }, {});
  assert.equal(view.file.path, "small.md"); assert.equal(view.session, other);
  gate.resolve(session); await first;
  assert.equal(view.session, other);
  assert.equal(released.length, 1); assert.equal(released[0].filePath, "large.json");
});

test("switching waits for a dirty autosave but does not enqueue a clean session behind verification", async () => {
  const { view, session, gate } = loadingFixture(), saved = deferred();
  let saves = 0;
  view.session = { dirty: true, listeners: new Set(), autoFlush: async () => { saves++; await saved.promise; } };
  const first = view.setState({ file: { path: "after-save.md" } }, {});
  await Promise.resolve(); assert.equal(view.file.path, "new.json");
  saved.resolve(); gate.resolve(session); await first;
  assert.equal(saves, 1); assert.equal(view.file.path, "after-save.md");
  session.dirty = false; session.autoFlush = () => { throw Error("clean sessions must not wait for pending verification"); };
  await view.setState({ file: { path: "clean.json" } }, {});
  assert.equal(view.file.path, "clean.json");
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

test("stable editor notifications avoid chrome writes while save state and navigation stay live", () => {
  const { DiffView } = load(path.join(__dirname, "../src/views/diff.js"));
  let writes = 0;
  const node = () => {
    const result = { dataset: {}, attributes: {}, setAttribute(name, value) { writes++; this.attributes[name] = value; } };
    for (const [key, initial] of [["textContent", ""], ["title", ""], ["disabled", false], ["hidden", false]]) {
      let value = initial;
      Object.defineProperty(result, key, { get: () => value, set: next => { writes++; value = next; } });
    }
    return result;
  };
  const previous = node(), next = node(), revert = node();
  previous.dataset.label = "上一处差异"; next.dataset.label = "下一处差异";
  const controls = { children: [previous, next] }, header = { querySelector: () => controls };
  const view = Object.create(DiffView.prototype);
  Object.assign(view, {
    contentEl: { querySelector: () => header },
    plugin: { settings: { language: "zh", collapseUnchanged: false, showDiffNavigation: true } },
    session: { draft: { index: "base", text: "edited" }, error: "", saving: false, dirty: true, enabled: false },
    merge: { a: { contentDOM: node() }, b: { contentDOM: node(), state: { readOnly: false } }, chunks: [{}], dom: { querySelectorAll: () => [revert] } },
    editorIndex: "base", editorText: "edited", collapseEnabled: false, revertLocked: false,
    leftCaption: node(), rightCaption: node(), saveButton: node(), warningEl: node(), updateSyntaxHighlight() {},
  });
  Object.assign(view.warningEl.dataset, { error: "", language: "zh" });
  view.updateEditor();
  assert.equal(view.saveButton.disabled, false);
  const dirtyCaption = view.rightCaption.textContent;
  writes = 0;
  for (let n = 0; n < 30; n++) view.updateEditor();
  assert.equal(writes, 0, "stable notifications must not reset labels or button attributes");
  view.session.saving = true; view.updateEditor();
  assert.equal(view.saveButton.disabled, true);
  assert.notEqual(view.rightCaption.textContent, dirtyCaption);
  view.session.saving = false; view.session.dirty = false; view.merge.chunks = []; view.updateEditor();
  assert.equal(view.saveButton.disabled, true);
  assert.equal(previous.disabled, true); assert.equal(next.disabled, true);
  view.session.dirty = true; view.merge.chunks = [{}]; view.updateEditor();
  assert.equal(view.saveButton.disabled, false);
  assert.equal(previous.disabled, false); assert.equal(next.disabled, false);
  assert.equal(view.rightCaption.textContent, dirtyCaption);
});
