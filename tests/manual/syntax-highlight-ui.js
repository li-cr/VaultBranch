(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in the note_test vault.");
  const p = app.plugins.plugins.vaultbranch;
  if (!p || [...p.editors.sessions.values()].some(s => s.dirty || s.saving)) throw Error("Save all diff drafts first.");
  const settings = { ...p.settings }, files = [], results = [];
  const check = (value, label) => { if (!value) throw Error(label); results.push(label); };
  const pause = () => new Promise(resolve => setTimeout(resolve, 120));
  const create = async (suffix, text) => { const file = await app.vault.create(`vb-highlight-${Date.now()}${suffix}`, text); files.push(file); return file; };
  const colored = editor => editor.contentDOM.querySelector('[class*="vb-syntax-"]');
  const open = async file => {
    const leaf = await p.openDiff({ path: file.path, untracked: true, index: "?", worktree: "?" }, "unstaged");
    await leaf.view.updateSyntaxHighlight(); await pause(); return leaf;
  };
  const undo = editor => { editor.focus(); editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true })); };
  let leaf, staged;
  try {
    await p.updateSetting("diffAutosave", false); await p.updateSetting("collapseUnchanged", false);
    await p.updateSetting("syntaxHighlighting", false);
    const tab = app.setting.pluginTabs.find(tab => tab.plugin === p || tab.id === "vaultbranch");
    const container = tab.containerEl, activeTab = tab.activeTab, settingsRoot = document.createElement("div");
    document.body.appendChild(settingsRoot);
    try {
      tab.containerEl = settingsRoot; tab.activeTab = "other"; tab.display();
      const toggle = [...settingsRoot.querySelectorAll(".setting-item")].find(item => /Diff syntax highlighting|差异语法高亮/.test(item.textContent))?.querySelector(".checkbox-container");
      check(toggle && !toggle.classList.contains("is-enabled"), "Other settings exposes the disabled syntax toggle");
      toggle.click(); await pause();
      check(p.settings.syntaxHighlighting && (await app.vault.readPluginData(p.manifest.dir)).syntaxHighlighting, "native syntax toggle persists its enabled preference");
      await p.updateSetting("syntaxHighlighting", false);
    } finally { tab.containerEl = container; tab.activeTab = activeTab; settingsRoot.remove(); }
    const json = await create(".json", '{\n  "title": "hello",\n  "count": 42,\n  "active": true\n}\n');
    await p.git.stage([json.path]); staged = json.path;
    const index = await p.git.run(["show", ":" + json.path]);
    await app.vault.modify(json, index.replace("hello", "world"));
    leaf = await p.openDiff({ path: json.path, index: "A", worktree: "M" }, "unstaged");
    const view = leaf.view, merge = view.merge;
    check(!colored(merge.a) && !colored(merge.b), "disabled JSON remains plain text in both panes");
    merge.b.dispatch({ changes: { from: 0, insert: " " }, selection: { anchor: 1 } });
    const draft = merge.b.state.doc, selection = merge.b.state.selection;
    await p.updateSetting("syntaxHighlighting", true); await pause();
    check(merge.a.contentDOM.querySelector(".vb-syntax-property") && merge.b.contentDOM.querySelector(".vb-syntax-string") && merge.b.contentDOM.querySelector(".vb-syntax-number"), "both JSON panes highlight keys, strings and values");
    check(view.merge === merge && merge.b.state.doc === draft && merge.b.state.selection === selection && view.session.dirty, "enabling preserves editor, unsaved draft and selection");
    check(view.contentEl.querySelector(".cm-changedText") && view.contentEl.querySelector(".cm-merge-revert button"), "highlighting retains diff backgrounds and native chunk revert");
    const green = getComputedStyle(view.contentEl.querySelector(".cm-merge-b .cm-changedText")).backgroundColor;
    await p.updateSetting("syntaxHighlighting", false); await pause();
    check(!colored(merge.a) && !colored(merge.b), "disabling immediately removes colors from both panes");
    check(getComputedStyle(view.contentEl.querySelector(".cm-merge-b .cm-changedText")).backgroundColor === green, "syntax toggle leaves the diff background unchanged");
    undo(merge.b); await pause();
    check(merge.b.state.doc.toString() === index.replace("hello", "world"), "Ctrl+Z still undoes input after toggling");
    check(await p.git.run(["show", ":" + json.path]) === index, "highlight toggle and undo preserve staged content");
    check(await app.vault.read(json) === index.replace("hello", "world"), "highlight toggle does not save drafts");
    await view.session.reload(); await leaf.detach(); leaf = null;
    await p.updateSetting("syntaxHighlighting", true);
    leaf = await p.openDiff({ path: json.path, index: "A", worktree: "M" }, "staged");
    await leaf.view.updateSyntaxHighlight(); await pause();
    check(colored(leaf.view.merge.b) && leaf.view.merge.a.state.readOnly && leaf.view.merge.b.state.readOnly, "staged JSON is colored and remains readonly");
    check(!leaf.view.contentEl.querySelector(".cm-merge-revert button"), "readonly highlighting adds no revert controls");
    await leaf.detach(); leaf = null;
    const md = await create(".md", "# Heading\n\n**bold** and *italic* with [link](https://example.com) and `code`.\n");
    leaf = await open(md);
    check(["heading", "strong", "emphasis", "link", "code"].every(name => leaf.view.merge.b.contentDOM.querySelector(".vb-syntax-" + name)), "Markdown colors headings, strong/emphasis, links and code");
    check(leaf.view.merge.b.state.doc.toString().startsWith("# Heading") && !leaf.view.contentEl.querySelector("h1"), "Markdown stays editable source rather than rendered preview");
    const same = leaf.view.merge;
    const off = p.updateSetting("syntaxHighlighting", false), on = p.updateSetting("syntaxHighlighting", true);
    await Promise.all([off, on]); await pause();
    check(leaf.view.merge === same && colored(same.b), "rapid off/on keeps the latest setting without rebuilding the editor");
    same.b.dispatch({ changes: { from: 0, insert: "x".repeat(10001) } }); await pause();
    check(!colored(same.b), "editing across the line limit safely disables colors after the transaction");
    undo(same.b); await pause();
    check(colored(same.b) && same.b.state.doc.toString().startsWith("# Heading"), "undoing an oversized edit restores colors and the original Markdown");
    await leaf.view.session.reload();
    await leaf.detach(); leaf = null;
    const js = await create(".js", "const value = 42;\n"); leaf = await open(js);
    check(!colored(leaf.view.merge.b) && !leaf.view.merge.vaultbranchHighlight.mode, "other extensions remain plain text");
    await leaf.detach(); leaf = null;
    const long = await create("-long.json", '"' + "x".repeat(10001) + '"'); leaf = await open(long);
    check(!colored(leaf.view.merge.b), "single lines above 10,000 characters fall back to plain text");
    await leaf.detach(); leaf = null;
    const large = await create("-large.md", "short line\n".repeat(19000)); leaf = await open(large);
    check(!colored(leaf.view.merge.b), "documents above 200,000 characters fall back to plain text");
    await leaf.detach(); leaf = null;
    const hidden = `.obsidian/vb-highlight-${Date.now()}.json`;
    await app.vault.adapter.write(hidden, '{"hidden":true}\n');
    try {
      leaf = await p.openDiff({ path: hidden, untracked: true, index: "?", worktree: "?" }, "unstaged");
      await leaf.view.updateSyntaxHighlight(); await pause();
      check(colored(leaf.view.merge.b), "hidden configuration JSON supports highlighting");
      await p.updateSetting("diffAutosave", true);
      const editor = leaf.view.merge.b;
      editor.dispatch({ changes: { from: 10, to: 14, insert: "false" } });
      await new Promise(resolve => setTimeout(resolve, 1000));
      check((await app.vault.adapter.read(hidden)).includes("false") && !leaf.view.session.dirty, "highlighted hidden JSON retains autosave behavior");
      await leaf.detach(); leaf = null;
    } finally {
      if (leaf) { await leaf.view.session?.reload(); await leaf.detach(); leaf = null; }
      await app.vault.adapter.trashLocal(hidden);
    }
    check(!p.editors.sessions.size, "closing clean comparisons releases all edit sessions");
    check(!(window.__vaultbranchErrors || []).length, "no runtime errors");
    return { results, errors: window.__vaultbranchErrors || [] };
  } finally {
    if (leaf) { await leaf.view.session?.reload(); await leaf.detach(); }
    if (staged) await p.git.run(["rm", "--cached", "--force", "--", staged]);
    for (const file of files) if (app.vault.getAbstractFileByPath(file.path)) await app.vault.trash(file, false);
    for (const key of ["syntaxHighlighting", "collapseUnchanged", "diffAutosave"]) await p.updateSetting(key, settings[key]);
  }
})()
