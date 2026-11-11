(async () => {
  if (app.vault.getName() !== "note_test" || !window.__vbStagedSwitch) throw Error("Run staged-switch-ui.js in note_test first.");
  const p = app.plugins.plugins.vaultbranch, electron = require("electron").remote;
  const web = electron.getCurrentWebContents(), debug = web.debugger, attached = debug.isAttached();
  electron.getCurrentWindow().show(); electron.getCurrentWindow().focus();
  let profiling = false;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    for (let round = 0; round < 6; round++) {
      if (round === 1) {
        if (!attached) debug.attach("1.3");
        await debug.sendCommand("Profiler.enable"); await debug.sendCommand("Profiler.start"); profiling = true;
      }
      for (const area of ["staged", "unstaged"]) for (let file = 0; file < 4; file++) {
        const point = window.__vbStagedSwitch.position(file, area); await pause(20);
        const click = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { document.removeEventListener("click", done, true); reject(Error("Native click timeout")); }, 3000);
          function done(event) {
            clearTimeout(timer); document.removeEventListener("click", done, true);
            if (!event.isTrusted) reject(Error("Untrusted click")); else resolve();
          }
          document.addEventListener("click", done, true);
        });
        const data = { x: Math.round(point.x), y: Math.round(point.y), button: "left", clickCount: 1 };
        web.sendInputEvent({ type: "mouseDown", ...data }); web.sendInputEvent({ type: "mouseUp", ...data }); await click;
        const expected = round * 8 + (area === "unstaged" ? 4 : 0) + file + 1, deadline = performance.now() + 15000;
        while (true) {
          const state = window.__vbStagedSwitch.poll();
          if (state.count === expected && state.done) break;
          if (performance.now() > deadline) throw Error("Diff timeout: " + JSON.stringify(state));
          await pause(10);
        }
        await pause(30);
      }
    }
    window.__vbSwitchProfile = (await debug.sendCommand("Profiler.stop")).profile; profiling = false;
    const report = await window.__vbStagedSwitch.report();
    report.samples = report.samples.slice(8); report.records = p.timingLog.records.slice(8);
    report.note = "40 trusted native GUI clicks after 8 warm-up clicks. CPU sampling on measured rounds; timings include sampling overhead. Records separate input delay, queue, DOM ready, verification and frame callbacks; no physical paint claim.";
    if (!report.indexUnchanged || !report.modeChecksPassed || !report.samples.every(sample => sample.trusted)) throw Error("Correctness checks failed");
    return report;
  } finally {
    try { if (profiling) window.__vbSwitchProfile = (await debug.sendCommand("Profiler.stop")).profile; }
    finally { if (!attached && debug.isAttached()) debug.detach(); await window.__vbStagedSwitch.cleanup(); }
  }
})()
