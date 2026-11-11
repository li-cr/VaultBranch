(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in the note_test vault.");
  const p = app.plugins.plugins.vaultbranch;
  if (!p || [...p.editSessions.values()].some(s => s.dirty || s.saving)) throw Error("Save all diff drafts first.");
  if (p.refreshTask) await p.refreshTask; p.refreshSoon?.cancel();
  const source = (await p.openSidebar()).view;
  if (p.refreshTask) await p.refreshTask;
  const saved = { status: p.status, selected: source.selected, collapsed: source.collapsed, openDiff: p.openDiff, openConflict: p.openConflict, ready: p.ready, error: p.error, busy: p.busy, lastAutoRefresh: p.lastAutoRefresh, settings: { ...p.settings } };
  const results = [], files = [];
  const check = (value, name) => { if (!value) throw Error(name); results.push(name); };
  const rows = () => [...source.treeEl.querySelectorAll(".vaultbranch-file-row")];
  const matches = path => rows().filter(row => row.dataset.path === path);
  const click = row => row.querySelector(".vaultbranch-file-open").click();
  const selected = row => source.treeEl.querySelectorAll(".vaultbranch-file-row.is-selected").length === 1 && row.classList.contains("is-selected");
  const pause = () => new Promise(resolve => setTimeout(resolve, 120));
  let leaf, staged, opened;
  try {
    p.lastAutoRefresh = Date.now()+3600000; p.ready = true; p.busy = false; p.error = ""; source.collapsed = new Set();
    p.openDiff = async (file, area) => { opened = [file.path, area]; };
    p.openConflict = async path => { opened = [path, "conflicts"]; };
    const mixed = 'notes/中文 [a] "quote".md', conflict = "notes/conflict.md";
    p.status = { branch: "main", upstream: "origin/main", ahead: 0, behind: 0, operation: null, stash: false, files: [
      { path: mixed, index: "M", worktree: "M", conflict: false, untracked: false },
      { path: conflict, index: "U", worktree: "U", conflict: true, untracked: false },
    ] };
    source.renderSnapshot = null; source.render();
    const initial = rows(), pair = matches(mixed), firstControl = pair[0].querySelector(".vaultbranch-file-open");
    click(pair[0]); check(selected(pair[0]) && opened[1] === "staged", "staged mixed-state file selects and opens the staged comparison");
    click(pair[1]); check(selected(pair[1]) && opened[0] === mixed && opened[1] === "unstaged", "same special path in unstaged group selects independently");
    check(rows().every((row, index) => row === initial[index]) && firstControl.isConnected, "selection retains all row and button nodes");
    firstControl.focus(); firstControl.click();
    check(document.activeElement === firstControl && selected(pair[0]), "keyboard-equivalent activation retains the focused file button");
    source.render();
    check(rows().every((row, index) => row === initial[index]) && selected(pair[0]), "unchanged status render after selection retains the tree");
    click(matches(conflict)[0]); check(selected(matches(conflict)[0]) && opened[1] === "conflicts", "conflict row retains conflict-editor routing");
    source.toggle("conflicts:notes"); check(!matches(conflict).length, "folder collapse still rebuilds the visible tree");
    source.toggle("conflicts:notes"); check(selected(matches(conflict)[0]), "folder expansion restores the selected conflict row");
    p.status.files.push({ path: "notes/new.md", index: "?", worktree: "?", conflict: false, untracked: true }); source.render();
    check(matches("notes/new.md").length === 1 && selected(matches(conflict)[0]), "new status file appears and selection survives full refresh");
    p.status.files = p.status.files.filter(file => file.path !== conflict); source.render();
    check(!matches(conflict).length && !source.treeEl.querySelector(".vaultbranch-file-row.is-selected"), "removing selected file leaves no stale selected row");
    p.status.files.find(file => file.path === mixed).worktree = " "; source.render();
    check(matches(mixed).length === 1, "staging transition removes the obsolete unstaged row");
    p.busy = true; source.render();
    check([...source.treeEl.querySelectorAll(".vaultbranch-row-action")].every(button => button.disabled), "Git busy refresh still disables row actions");
    p.busy = false; p.status = saved.status; p.openDiff = saved.openDiff; p.openConflict = saved.openConflict;
    await p.updateSetting("diffAutosave", false); await p.updateSetting("collapseUnchanged", false);
    const name = `vb-sidebar-${Date.now()}`, base = Array.from({ length: 80 }, (_, n) => `line ${n}`).join("\n") + "\n";
    const a = await app.vault.create(name+"-A.md", base); files.push(a);
    const b = await app.vault.create(name+"-B.md", "# File B\n\ntext\n"); files.push(b);
    await p.git.stage([a.path]); staged = a.path;
    const index = await p.git.run(["show", ":"+a.path]);
    await app.vault.modify(a, base.replace("line 40", "edited line 40"));
    await p.refresh();
    const tree = source.treeEl, rowB = matches(b.path)[0];
    click(matches(a.path).at(-1)); await p.diffNavigationTask;
    leaf = app.workspace.getLeavesOfType("vaultbranch-diff").find(l=>l.view.file?.path === a.path);
    check(leaf && selected(matches(a.path).at(-1)) && tree === source.treeEl && rowB.isConnected, "real A click opens diff while retaining the sidebar");
    const mergeA = leaf.view.merge;
    mergeA.b.dispatch({ changes: { from: 0, insert: "draft line\n" } });
    check(mergeA.b.state.doc.lines === 82 && mergeA.chunks.length > 0 && leaf.view.session.dirty, "editing A updates line count and diff chunks immediately");
    click(rowB); await p.diffNavigationTask;
    check(leaf.view.file.path === b.path && selected(rowB), "real B click updates selection and opens B");
    click(matches(a.path).at(-1)); await p.diffNavigationTask;
    check(leaf.view.merge.b.state.doc.toString().startsWith("draft line\n") && leaf.view.session.dirty, "switching A to B and back preserves the manual draft");
    const retainedDraft = leaf.view.merge.b.state.doc.toString();
    leaf.view.merge.b.dispatch({ changes: { from: 0, insert: "new edit\n" } });
    leaf.view.merge.b.focus(); leaf.view.merge.b.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true })); await pause();
    check(leaf.view.merge.b.state.doc.toString() === retainedDraft, "undo of new input after reopening restores the retained draft");
    check(await p.git.run(["show", ":"+a.path]) === index, "clicking and editing preserve the staged index");
    check(await app.vault.read(a) === base.replace("line 40", "edited line 40"), "selection changes do not save a manual draft");
    await leaf.view.session.reload(); await leaf.detach(); leaf = null;
    check(!p.editSessions.size, "closing clean diff releases editor sessions");
    check(!(window.__vaultbranchErrors || []).length, "no runtime errors");
    return { results, errors: window.__vaultbranchErrors || [] };
  } finally {
    p.openDiff = saved.openDiff; p.openConflict = saved.openConflict; p.busy = saved.busy;
    if (leaf) { await leaf.view.session?.reload(); await leaf.detach(); }
    if (staged) await p.git.run(["rm", "--cached", "--force", "--", staged]);
    for (const file of files) if (app.vault.getAbstractFileByPath(file.path)) await app.vault.trash(file,false);
    source.selected = saved.selected; source.collapsed = saved.collapsed;
    p.status = saved.status; p.ready = saved.ready; p.error = saved.error; p.lastAutoRefresh = saved.lastAutoRefresh;
    for (const key of ["diffAutosave","collapseUnchanged"]) await p.updateSetting(key,saved.settings[key]);
    source.renderSnapshot = null; await p.refresh();
  }
})()
