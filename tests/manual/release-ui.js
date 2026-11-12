(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in note_test.");
  const options = window.__vbReleaseOptions;
  if (!options?.sourceRoot || !options?.outputDir || !options?.baselineBuild) throw Error("Run through npm run release:check with explicit paths.");
  const fs = require("node:fs/promises"), path = require("node:path"), manager = app.plugins;
  const current = manager.plugins.vaultbranch;
  if (!current || [...(current.editors?.sessions || current.editSessions).values()].some(session => session.dirty || session.saving)) throw Error("Enable the plugin and save drafts first.");
  const target = path.join(app.vault.adapter.getBasePath(), current.manifest.dir);
  const legacyEnabled = Boolean(manager.plugins["my-git"]), reports = {}, checks = [];
  const originalTrash = app.vault.trash;
  app.vault.trash = async function (...args) {
    // The host metadata queue can still hold a synthetic Markdown read after
    // the view closes. Finish those reads before removing a test fixture.
    const deadline = Date.now() + 30000;
    while (app.metadataCache.inProgressTaskCount > 0) {
      if (Date.now() > deadline) throw Error("Host metadata indexing did not finish before fixture cleanup.");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return originalTrash.apply(this, args);
  };
  window.__vaultbranchErrors = [];
  const consoleErrors = [], originalConsoleError = console.error;
  console.error = function (...args) {
    consoleErrors.push({ messages: args.map(value => value?.stack || String(value)), callsite: new Error("Console error during release checks").stack });
    return originalConsoleError.apply(this, args);
  };
  const run = async file => await eval(await fs.readFile(path.join(options.sourceRoot, file), "utf8"));
  const store = async (name, data) => { await fs.writeFile(path.join(options.outputDir, name + ".json"), JSON.stringify(data, null, 2)); return data; };
  async function install(source) {
    const plugin = manager.plugins.vaultbranch;
    if (plugin?.refreshTask) await plugin.refreshTask;
    plugin?.refreshSoon?.cancel();
    await manager.disablePlugin("vaultbranch");
    for (const file of ["main.js", "manifest.json", "styles.css"]) await fs.copyFile(path.join(source, file), path.join(target, file));
    await manager.loadManifests(); await manager.enablePlugin("vaultbranch");
  }
  async function measure(name, build) {
    await install(build);
    const startup = await store(name + "-startup", await run("scripts/benchmark-startup.js"));
    await run("tests/manual/staged-switch-ui.js");
    const switching = await store(name + "-switch", await run("tests/manual/profile-switch-ui.js"));
    await store(name + "-switch-profile", window.__vbSwitchProfile); delete window.__vbSwitchProfile;
    await run("tests/manual/staged-switch-ui.js");
    const editing = await store(name + "-edit", await run("tests/manual/edit-latency-ui.js"));
    return { startup, switching, editing };
  }
  try {
    if (legacyEnabled) await manager.disablePlugin("my-git");
    reports.before = await measure("before", options.baselineBuild);
    reports.after = await measure("after", path.join(options.sourceRoot, "dist/vaultbranch"));
    for (const name of ["shared-editor-ui", "diff-loading-ui", "chunk-revert-ui", "syntax-highlight-ui", "startup-ui", "diff-navigation-ui", "sidebar-selection-ui", "performance-timing-ui", "image-preview-ui", "svg-preview-ui", "file-history-ui", "history-editor-ui", "syntax-history-ui", "view-stability-ui"]) {
      const result = await store(name, await run("tests/manual/" + name + ".js"));
      if (result.failed?.length || result.checks?.some(check => check.ok === false) || result.errors?.length) throw Error(name + " failed: " + JSON.stringify(result));
      checks.push({ name, checks: result.results?.length ?? result.checks?.length ?? 0 });
    }
    const plugin = manager.plugins.vaultbranch;
    const result = { version: plugin.manifest.version, reports, checks, sessions: plugin.editors.sessions.size, pending: plugin.editors.pending.size, errors: window.__vaultbranchErrors || [], consoleErrors };
    if (result.sessions || result.pending || result.errors.length || consoleErrors.length) throw Error("Release suite cleanup/runtime errors: " + JSON.stringify(result));
    await store("release-ui", result);
    return { version: result.version, benchmarks: ["startup", "trusted file switching", "trusted Changed insert/newline/delete"], checks, sessions: result.sessions, pending: result.pending, errors: result.errors };
  } finally {
    app.vault.trash = originalTrash;
    console.error = originalConsoleError;
    await store("console-errors", consoleErrors);
    await window.__vbStagedSwitch?.cleanup();
    delete window.__vbSwitchProfile;
    await install(path.join(options.sourceRoot, "dist/vaultbranch"));
    if (legacyEnabled) await manager.enablePlugin("my-git");
    const plugin = manager.plugins.vaultbranch; await plugin.openSidebar(); await plugin.refresh();
    delete window.__vbReleaseOptions;
  }
})()
