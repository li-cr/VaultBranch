(async () => {
  // Evaluate this file in an isolated Obsidian test vault, never in a personal vault.
  if (app.vault.getName() !== "note_test") throw Error("Use the isolated note_test vault.");
  const p = app.plugins.plugins.vaultbranch;
  const git = p.git, old = { history: git.history, historyData: git.historyData, commitFiles: git.commitFiles, run: git.run, stashExists: git.stashExists, lastAutoRefresh: p.lastAutoRefresh };
  const commits = p.core.graphFor(Array.from({length:1000}, (_, i) => ({
    hash:(1000-i).toString(16).padStart(40,"0"), parents:i<999?[(999-i).toString(16).padStart(40,"0")]:[],
    short:(1000-i).toString(16).padStart(7,"0"), subject:`Synthetic commit ${i}`, author:"Benchmark", date:"2026-01-01T00:00:00Z", refs:i===0?"main":""
  })));
  const data = { commits, branches: ["main"], hasStash:false, currentBranch:"main" };
  let leaf;
  try {
    if (p.refreshTask) await p.refreshTask;
    p.lastAutoRefresh = Date.now()+60000;
    p.refreshSoon?.cancel();
    git.history = async () => commits;
    git.commitFiles = async hash => [{path:"synthetic-note.md",index:"M",commit:hash}];
    if (git.historyData) git.historyData = async () => data;
    git.run = async args => args[0] === "for-each-ref" ? "main\n" : old.run.call(git, args);
    git.stashExists = async () => false;
    await p.ensureReady();
    leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({type:"vaultbranch-history",active:true,state:{limit:1000,selected:"",query:"",ref:""}});
    const view = leaf.view;
    await view.render(); // Warm the same view and scenario once.
    const samples = [];
    for (let i = 0; i < 5; i++) {
      let mutations = 0;
      const observer = new MutationObserver(records => { mutations += records.filter(record => record.type === "childList").length; });
      observer.observe(view.contentEl, {subtree:true,childList:true});
      const start = performance.now();
      await view.render();
      view.bodyEl.getBoundingClientRect(); // Include synchronous layout, not a paint-completion claim.
      await Promise.resolve(); observer.disconnect();
      if (view.bodyEl.querySelectorAll(".vaultbranch-history-row").length !== 1000) throw Error("Incomplete graph");
      samples.push({ms:Number((performance.now()-start).toFixed(2)), childListMutations:mutations});
    }
    const times = samples.map(s => s.ms).sort((a,b) => a-b);
    await view.bodyEl.querySelector(".vaultbranch-history-row").onclick();
    if (!view.detailsEl.textContent.includes("synthetic-note.md")) throw Error("Retained row cannot load details after unchanged refresh");
    return { plugin:p.manifest.version, userAgent:navigator.userAgent, electron:process.versions.electron, node:process.versions.node, scenario:"1000 synthetic commits, unchanged view reload, one warm-up; Git mocked out equally; render promise and synchronous layout, not paint completion", samples, medianMs:times[2], rangeMs:[times[0],times.at(-1)], checks:["1000 rows remain visible", "retained row opens changed files after repeated refresh"] };
  } finally {
    git.history=old.history; git.commitFiles=old.commitFiles; git.run=old.run; git.stashExists=old.stashExists;
    if (old.historyData) git.historyData=old.historyData;
    p.lastAutoRefresh=old.lastAutoRefresh;
    await leaf?.detach();
  }
})()
