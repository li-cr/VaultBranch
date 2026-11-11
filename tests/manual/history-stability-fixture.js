(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in note_test.");
  const p = app.plugins.plugins.vaultbranch;
  if (!p || window.__vbHistoryStability || [...p.editors.sessions.values()].some(s => s.dirty || s.saving)) throw Error("Finish other tests and save drafts.");
  const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
  const exec = require("node:util").promisify(require("node:child_process").execFile);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vb-history-click-"));
  const saved = { git: p.git, status: p.status, ready: p.ready, error: p.error, scheduleRefresh: p.scheduleRefresh, lastAutoRefresh: p.lastAutoRefresh };
  const git = async (...args) => (await exec(saved.git.binary, args, { cwd: root, windowsHide: true })).stdout;
  const name = "large/deep/json/data.json", small = '{"value":0}\n';
  const large = JSON.stringify(Array.from({ length: 24000 }, (_, n) => ({ n, value: "abcdefghijklmnop" })), null, 2) + "\n";
  const samples = []; let leaf, active, observer;
  const snapshot = () => {
    if (!active) return;
    const view = leaf.view, title = view.detailsEl.querySelector(".vaultbranch-diff-description")?.textContent;
    if (/读取差异中|Loading diff/.test(view.detailsEl.textContent) || (view.merge === active.oldMerge && title !== active.oldTitle)) active.partial = true;
  };
  const click = event => {
    const row = event.target.closest(".vaultbranch-file-history-entry");
    if (!row || !leaf.view.contentEl.contains(row)) return;
    const view = leaf.view;
    active = { trusted: event.isTrusted, partial: false, oldMerge: view.merge, oldTitle: view.detailsEl.querySelector(".vaultbranch-diff-description")?.textContent, expected: view.commits[view.rows.indexOf(row)].hash };
    samples.push(active);
  };
  const cleanup = async () => {
    observer?.disconnect(); document.removeEventListener("click", click, true);
    await leaf?.detach();
    Object.assign(p, saved);
    await p.refresh(); await fs.rm(root, { recursive: true, force: true });
    delete window.__vbHistoryStability;
  };
  window.__vbHistoryStability = { cleanup };
  try {
    if (p.refreshTask) await p.refreshTask; p.refreshSoon?.cancel();
    p.scheduleRefresh = () => {}; p.lastAutoRefresh = Date.now() + 3600000;
    await git("init", "-b", "main"); await git("config", "user.name", "UI Test"); await git("config", "user.email", "ui@example.invalid");
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    for (let n = 0; n < 4; n++) {
      await fs.writeFile(path.join(root, name), n % 2 ? large.replace('"n": 0', `"n": ${n}`) : small.replace("0", String(n)));
      await git("add", name); await git("commit", "-m", `Revision ${n}`);
    }
    p.git = new saved.git.constructor(root, { binary: saved.git.binary }); await p.git.init(); p.ready = true; p.status = await p.git.status();
    leaf = await p.openFileHistory(name);
    document.addEventListener("click", click, true);
    observer = new MutationObserver(snapshot); observer.observe(leaf.view.detailsEl, { subtree: true, childList: true, characterData: true });
    Object.assign(window.__vbHistoryStability, {
      position(index) {
        const row = leaf.view.rows[index]; row.scrollIntoView({ block: "nearest" });
        const r = row.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 100), y: r.top + r.height / 2 };
      },
      poll() {
        snapshot();
        const view = leaf.view;
        if (active && view.selected === active.expected && view.merge && view.merge !== active.oldMerge && !view.detailsEl.inert && !/读取差异中|Loading diff/.test(view.detailsEl.textContent)) active.done = true;
        return { count: samples.length, done: !!active?.done };
      },
      report() { return { version: p.manifest.version, samples: samples.map(({ oldMerge, oldTitle, ...sample }) => sample), fixtures: [{ bytes: Buffer.byteLength(small), lines: 2 }, { bytes: Buffer.byteLength(large), lines: large.split("\n").length }], errors: window.__vaultbranchErrors || [], note: "Real trusted GUI stability checks; no latency claim." }; },
    });
    return { ready: true };
  } catch (error) { await cleanup(); throw error; }
})()
