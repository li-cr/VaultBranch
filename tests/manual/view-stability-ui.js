(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in note_test.");
  const p = app.plugins.plugins.vaultbranch;
  if (!p || [...p.editors.sessions.values()].some(s => s.dirty || s.saving)) throw Error("Save drafts first.");
  const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
  const exec = require("node:util").promisify(require("node:child_process").execFile);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vb-stability-"));
  const saved = { git: p.git, status: p.status, ready: p.ready, error: p.error, scheduleRefresh: p.scheduleRefresh, lastAutoRefresh: p.lastAutoRefresh };
  const git = async (...args) => (await exec(saved.git.binary, args, { cwd: root, windowsHide: true })).stdout;
  const checks = [], samples = [], leaves = [], restores = [];
  const check = (ok, name) => { checks.push({ name, ok: !!ok }); };
  const frame = () => new Promise(resolve => {
    const timer = setTimeout(resolve, 40);
    requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
  });
  const hold = (object, name) => {
    const original = object[name]; let begin, release;
    const started = new Promise(resolve => { begin = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    object[name] = async function(...args) { const result = await original.apply(this, args); begin(); await gate; return result; };
    const restore = () => { object[name] = original; };
    restores.push(restore);
    return { started, release, restore };
  };
  try {
    if (p.refreshTask) await p.refreshTask;
    p.refreshSoon?.cancel(); p.scheduleRefresh = () => {}; p.lastAutoRefresh = Date.now() + 3600000;
    await git("init", "-b", "main"); await git("config", "user.name", "UI Test"); await git("config", "user.email", "ui@example.invalid");
    const fixtures = [["small/note.md", "# Small\nvalue 0\n"], ["large/deep/json/data.json", JSON.stringify(Array.from({ length: 24000 }, (_, n) => ({ n, value: "abcdefghijklmnop" })), null, 2) + "\n"], ["small/deep/json/data.json", '{"value":0}\n'], ["large/note.md", "line abcdefghijklmnopqrstuvwxyz\n".repeat(40000)]];
    for (const [file, text] of fixtures) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), text); }
    await git("add", "."); await git("commit", "-m", "Base"); await git("branch", "side");
    for (let n = 1; n <= 5; n++) {
      await fs.appendFile(path.join(root, fixtures[0][0]), `revision ${n}\n`);
      await fs.writeFile(path.join(root, fixtures[1][0]), fixtures[1][1].replace('"n": 0', `"n": ${n}`));
      await git("commit", "-am", `Revision ${n}`);
    }
    p.git = new saved.git.constructor(root, { binary: saved.git.binary }); await p.git.init(); p.ready = true; p.status = await p.git.status();
    const index = await git("write-tree");
    const fileLeaf = await p.openFileHistory(fixtures[1][0]); leaves.push(fileLeaf);
    const view = fileLeaf.view;
    for (let n = 0; n < 5; n++) {
      const previous = view.merge, title = view.detailsEl.querySelector(".vaultbranch-diff-description")?.textContent, selected = view.selected;
      const held = hold(p.git, "comparisonVersions"), start = performance.now();
      const pending = view.selectCommit(view.commits[(n + 1) % view.commits.length]); await held.started; await frame();
      const partial = /读取差异中|Loading diff/.test(view.detailsEl.textContent) || view.merge !== previous || view.detailsEl.querySelector(".vaultbranch-diff-description")?.textContent !== title || view.selected !== selected;
      check(!partial, `file history detail ${n}: no placeholder or mismatched title before data`);
      held.release(); await pending; held.restore();
      samples.push({ operation: "file-history-detail", exposedPartial: partial, elapsedWithGateMs: performance.now() - start });
      check(!!view.merge && !view.detailsEl.inert, `file history detail ${n}: complete and interactive after read`);
    }
    {
      const previous = view.merge, list = view.rows[0];
      const held = hold(p.git, "fileHistory"), pending = view.render(); await held.started; await frame();
      check(view.merge === previous && view.rows[0] === list && list.isConnected, "file history refresh retains complete connected page while querying");
      held.release(); await pending; held.restore();
    }
    const graphLeaf = await p.openHistory(); leaves.push(graphLeaf); const graph = graphLeaf.view;
    const rows = () => [...graph.contentEl.querySelectorAll(".vaultbranch-history-row")];
    await rows()[0].onclick();
    for (let n = 0; n < 5; n++) {
      const before = graph.detailsEl.textContent, held = hold(p.git, "commitFiles");
      const pending = rows()[(n + 1) % rows().length].onclick(); await held.started; await frame();
      const partial = graph.detailsEl.textContent !== before;
      check(!partial, `graph detail ${n}: no heading-only intermediate state`);
      held.release(); await pending; held.restore();
      samples.push({ operation: "graph-detail", exposedPartial: partial });
    }
    {
      const original = p.git.historyData, data = await original.call(p.git, 100, "", false);
      p.git.historyData = async () => ({ ...data, commits: Array.from({ length: 250 }, (_, n) => ({ ...data.commits[n % data.commits.length] })) });
      restores.push(() => { p.git.historyData = original; });
      const old = graph.bodyEl; let exposed = false;
      const observer = new MutationObserver(() => { const count = graph.contentEl.querySelectorAll(".vaultbranch-history-row").length; if (count > 0 && count < 250 && graph.bodyEl !== old) exposed = true; });
      observer.observe(graph.contentEl, { subtree: true, childList: true });
      await graph.render(true); observer.disconnect();
      check(!exposed && rows().length === 250, "graph batches 250 rows without exposing a partial new list");
      p.git.historyData = original;
    }
    const sourceLeaf = await p.openSidebar(); const source = sourceLeaf.view; source.render();
    const oldNode = source.treeEl.firstChild; p.busy = true; source.render(); p.busy = false; source.render();
    check(source.treeEl.firstChild === oldNode, "busy-only sidebar updates preserve file tree nodes");
    check(await git("write-tree") === index, "browsing does not change the staged index");
    await graph.render(); await graph.render();
    await rows()[1].onclick();
    check(graph.selected === rows()[1].dataset.commit && graph.detailsEl.querySelector(".vaultbranch-history-detail-title")?.textContent.includes(rows()[1].querySelector(".vaultbranch-history-hash").textContent), "graph row handlers remain valid after unchanged-data refreshes");
    {
      const original = p.git.comparisonVersions;
      p.git.comparisonVersions = async () => { throw Error("Expected preview failure"); };
      await view.selectCommit(view.commits[1]);
      check(!view.detailsEl.inert && view.detailsEl.querySelector(".is-error"), "history read failure restores interaction and shows a complete error state");
      p.git.comparisonVersions = original;
      await view.selectCommit(view.commits[0]);
      check(!!view.merge && !view.detailsEl.inert, "history recovers from a failed comparison");
    }
    await git("switch", "side"); await fs.writeFile(path.join(root, fixtures[0][0]), "side conflict\n");
    await git("commit", "-am", "Side change"); await git("switch", "main");
    try { await git("merge", "side"); } catch { /* Intentional conflict in the isolated repository. */ }
    p.status = await p.git.status();
    const conflictLeaf = await p.openConflict(fixtures[0][0]); leaves.push(conflictLeaf); const conflict = conflictLeaf.view;
    const conflictIndex = await git("ls-files", "--stage");
    for (let n = 0; n < 5; n++) {
      const result = conflict.contentEl.querySelector(".vaultbranch-conflict-result"); result.value = `manual resolution ${n}\n`;
      const held = hold(p.git, "conflictVersions"), pending = conflict.render({ preserveDraft: true }); await held.started; await frame();
      check(conflict.contentEl.querySelector(".vaultbranch-conflict-result") === result && result.isConnected, `conflict refresh ${n}: retains the complete result while reading`);
      held.release(); await pending; held.restore();
      check(conflict.contentEl.querySelector(".vaultbranch-conflict-result").value === `manual resolution ${n}\n`, `conflict refresh ${n}: retains manual resolution`);
    }
    check(await git("ls-files", "--stage") === conflictIndex, "conflict browsing does not stage the resolution");
    {
      const held = hold(p.git, "comparisonVersions"), pending = view.selectCommit(view.commits[1]); await held.started;
      await fileLeaf.detach(); held.release(); await pending; held.restore();
      check(!view.merge, "closing history during a read does not resurrect its editor");
    }
    {
      const held = hold(p.git, "commitFiles"), pending = rows()[0].onclick(); await held.started;
      const title = graph.detailsEl.textContent;
      await graphLeaf.detach(); held.release(); await pending; held.restore();
      check(graph.detailsEl.textContent === title, "closing graph during a read rejects the late detail result");
    }
    check(!(window.__vaultbranchErrors || []).length, "no runtime errors");
    return { checks, failed: checks.filter(c => !c.ok), samples, fixtures: fixtures.map(([file, text]) => ({ path: file, bytes: Buffer.byteLength(text), lines: text.split("\n").length })), note: "Gated UI correctness checks, not latency benchmarks. 250-row batch case duplicates real commit metadata." };
  } finally {
    for (const restore of restores.reverse()) restore();
    for (const leaf of leaves.reverse()) await leaf.detach();
    p.git = saved.git; p.status = saved.status; p.ready = saved.ready; p.error = saved.error; p.busy = false; p.scheduleRefresh = saved.scheduleRefresh; p.lastAutoRefresh = saved.lastAutoRefresh;
    await p.refresh();
    await fs.rm(root, { recursive: true, force: true });
  }
})()
