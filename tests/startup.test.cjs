"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../src");
const defaults = require("../default-settings.json");

function harness(saved) {
  const loaded = new Set(), modules = new Map(), factories = new Map(), writes = [];
  let layoutReady, interval, pending;
  const events = new Map(), vaultEvents = new Map(), domEvents = new Map(), document = { hidden: false }, leaves = [];
  class HostPlugin {
    loadData() { return Promise.resolve(saved); }
    saveData(value) { writes.push({ ...value }); return Promise.resolve(); }
    registerView(type, factory) { factories.set(type, factory); }
    addSettingTab() {}
    addRibbonIcon() { return { setAttribute() {} }; }
    addCommand(command) { return command; }
    registerEvent() {}
    registerDomEvent(target, name, callback) { domEvents.set(name, callback); }
    registerInterval() {}
  }
  const host = {
    Plugin: HostPlugin, Platform: { isMobile: false },
    ItemView: class { constructor(leaf) { this.leaf = leaf; this.app = leaf.app; } },
    PluginSettingTab: class {}, FuzzySuggestModal: class {}, Modal: class {},
    debounce(callback) {
      const schedule = () => { pending = callback; };
      schedule.cancel = () => { pending = null; };
      return schedule;
    },
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    loaded.add(file);
    const module = { exports: {} };
    modules.set(file, module);
    const localRequire = createRequire(file);
    vm.runInNewContext(fs.readFileSync(file, "utf8"), {
      module, document, window: { setInterval(callback) { interval = callback; } },
      require(name) {
        if (name === "obsidian") return host;
        if (name.startsWith("@codemirror/")) throw Error("Editor requested: " + name);
        const resolved = localRequire.resolve(name);
        return resolved.startsWith(root + path.sep) ? load(resolved) : localRequire(name);
      },
    }, { filename: file });
    return module.exports;
  }
  const Plugin = load(path.join(root, "main.js")), plugin = new Plugin();
  plugin.app = {
    workspace: { on(name, callback) { events.set(name, callback); }, onLayoutReady(callback) { layoutReady = callback; }, getLeavesOfType() { return leaves; }, iterateAllLeaves() {} },
    vault: { on(name, callback) { vaultEvents.set(name, callback); }, adapter: { getBasePath() { return path.dirname(root); } } },
  };
  plugin.manifest = { dir: ".obsidian/plugins/vaultbranch" };
  return { plugin, factories, loaded, writes, document, leaves, events, vaultEvents, domEvents, tick: () => interval(), flush: () => { const callback = pending; pending = null; callback?.(); }, layout: () => layoutReady() };
}

test("startup registers every view without evaluating view implementations or starting Git", async () => {
  const h = harness({ ...defaults, openOnStartup: false });
  await h.plugin.onload();
  assert.equal(h.factories.size, 5);
  assert.deepEqual([...h.loaded].filter(file => file.includes(path.sep + "views" + path.sep)).map(file => path.basename(file)), ["shared.js"]);
  assert.equal(h.plugin.ready, false);
  h.plugin.openSidebar = () => { throw Error("Unexpected startup sidebar"); };
  h.layout();
  assert.equal(h.writes.length, 0);
});

test("opting into highlighting still defers every editor and parser until a diff opens", async () => {
  const h = harness({ ...defaults, syntaxHighlighting: true, openOnStartup: false });
  await h.plugin.onload(); h.layout();
  assert.deepEqual([...h.loaded].filter(file => file.includes(path.sep + "views" + path.sep)).map(file => path.basename(file)), ["shared.js"]);
  assert.equal(h.plugin.ready, false);
  assert.equal(h.writes.length, 0);
});

test("restored sidebar factory loads synchronously and leaves editors deferred until a diff is requested", async () => {
  const h = harness(defaults);
  await h.plugin.onload();
  const type = "vaultbranch-source-control", leaf = { app: h.plugin.app };
  const first = h.factories.get(type)(leaf), second = h.factories.get(type)(leaf);
  assert.equal(first.getViewType(), type);
  assert.equal(first.constructor, second.constructor);
  assert.equal(h.plugin.isView(first, type), true);
  assert.equal(h.plugin.isView(first, "vaultbranch-diff"), false);
  assert.throws(() => h.factories.get("vaultbranch-diff")(leaf), /Editor requested: @codemirror\/merge/);
});

test("new and legacy settings get defaults without a startup write; actual preference changes persist them", async () => {
  for (const saved of [null, { language: "zh", refreshSeconds: 17, customPreference: "keep" }]) {
    const h = harness(saved);
    await h.plugin.onload();
    assert.equal(h.plugin.settings.showDiffNavigation, true);
    assert.equal(h.plugin.settings.collapseUnchanged, true);
    assert.equal(h.plugin.settings.syntaxHighlighting, false);
    assert.equal(h.plugin.settings.refreshSeconds, saved?.refreshSeconds || defaults.refreshSeconds);
    assert.equal(h.writes.length, 0);
    await h.plugin.updateSetting("dateFormat", "YYYY");
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].dateFormat, "YYYY");
    assert.equal(h.writes[0].showDiffNavigation, true);
    if (saved) assert.equal(h.writes[0].customPreference, "keep");
  }
});

test("startup still opens the requested sidebar after layout and repairs invalid language in memory", async () => {
  const h = harness({ openOnStartup: true, language: "unsupported" });
  await h.plugin.onload();
  let opened = 0;
  h.plugin.openSidebar = async () => { opened++; };
  h.layout();
  assert.equal(opened, 1);
  assert.equal(h.plugin.settings.language, defaults.language);
  assert.equal(h.writes.length, 0);
});

async function refreshHarness() {
  const h = harness({ ...defaults, openOnStartup: false });
  await h.plugin.onload();
  h.plugin.ready = true;
  h.counts = { status: 0, sync: 0 };
  h.plugin.git.status = async () => { h.counts.status++; return { files: [] }; };
  h.plugin.renderViews = () => {};
  h.leaf = { getRoot: () => h.root, view: { containerEl: { isShown: () => h.shown } } };
  h.root = { collapsed: false }; h.shown = true;
  h.settle = async () => { if (h.plugin.refreshTask) await h.plugin.refreshTask; };
  return h;
}

test("closed, collapsed, inactive-tab and hidden-window sidebars perform no automatic status queries", async () => {
  for (const mode of ["closed", "collapsed", "inactive", "window"]) {
    const h = await refreshHarness();
    if (mode !== "closed") h.leaves.push(h.leaf);
    if (mode === "collapsed") h.root.collapsed = true;
    if (mode === "inactive") h.shown = false;
    if (mode === "window") h.document.hidden = true;
    for (let n = 0; n < 20; n++) h.plugin.scheduleRefresh();
    h.flush(); h.tick(); await h.settle();
    assert.equal(h.counts.status, 0, mode);
    assert.equal(h.plugin.lastAutoRefresh, undefined);
  }
});

test("a refresh queued while visible rechecks visibility after the sidebar is hidden", async () => {
  const h = await refreshHarness(); h.leaves.push(h.leaf);
  h.plugin.scheduleRefresh();
  h.root.collapsed = true;
  h.flush(); await h.settle();
  assert.equal(h.counts.status, 0);
});

test("revealing the sidebar refreshes once and coalesces repeated layout and timer checks", async () => {
  const h = await refreshHarness(); h.leaves.push(h.leaf);
  h.root.collapsed = true; h.events.get("resize")();
  h.root.collapsed = false; h.events.get("resize")();
  h.events.get("layout-change")(); h.tick(); await h.settle();
  assert.equal(h.counts.status, 1);
  h.plugin.lastAutoRefresh = Date.now() - 6000;
  h.tick(); await h.settle();
  assert.equal(h.counts.status, 2);
  h.document.hidden = true; h.domEvents.get("visibilitychange")();
  h.document.hidden = false; h.domEvents.get("visibilitychange")();
  await h.settle();
  assert.equal(h.counts.status, 3);
});

test("hidden-sidebar file events still sync editor sessions and explicit refresh remains available", async () => {
  const h = await refreshHarness();
  h.plugin.editors.sessions.set("file.md", { sync() { h.counts.sync++; } });
  h.plugin.editors.sessions.set("hidden.json", { sync() { h.counts.sync++; } });
  h.plugin.app.vault.getAbstractFileByPath = () => null;
  h.vaultEvents.get("modify")({ path: "file.md" });
  h.vaultEvents.get("raw")("hidden.json"); h.flush(); await h.settle();
  assert.equal(h.counts.sync, 2);
  assert.equal(h.counts.status, 0);
  await h.plugin.refresh(true);
  assert.equal(h.counts.status, 1);
});
