"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const main = path.resolve(__dirname, "../src/main.js");
const localRequire = createRequire(main);
const exported = { exports: {} };
vm.runInNewContext(fs.readFileSync(main, "utf8"), {
  module: exported,
  require: (name) => name === "obsidian" ? {
    Plugin: class {}, ItemView: class {}, PluginSettingTab: class {},
  } : localRequire(name),
});
const Plugin = exported.exports;
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
