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
  let layoutReady;
  class HostPlugin {
    loadData() { return Promise.resolve(saved); }
    saveData(value) { writes.push({ ...value }); return Promise.resolve(); }
    registerView(type, factory) { factories.set(type, factory); }
    addSettingTab() {}
    addRibbonIcon() { return { setAttribute() {} }; }
    addCommand(command) { return command; }
    registerEvent() {}
    registerDomEvent() {}
    registerInterval() {}
  }
  const host = {
    Plugin: HostPlugin, Platform: { isMobile: false },
    ItemView: class { constructor(leaf) { this.leaf = leaf; this.app = leaf.app; } },
    PluginSettingTab: class {}, FuzzySuggestModal: class {}, Modal: class {},
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    loaded.add(file);
    const module = { exports: {} };
    modules.set(file, module);
    const localRequire = createRequire(file);
    vm.runInNewContext(fs.readFileSync(file, "utf8"), {
      module, document: {}, window: { setInterval() {} },
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
    workspace: { on() {}, onLayoutReady(callback) { layoutReady = callback; }, getLeavesOfType() { return []; } },
    vault: { on() {}, adapter: { getBasePath() { return path.dirname(root); } } },
  };
  plugin.manifest = { dir: ".obsidian/plugins/vaultbranch" };
  return { plugin, factories, loaded, writes, layout: () => layoutReady() };
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
