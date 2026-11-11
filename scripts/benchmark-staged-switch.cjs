"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

(async () => {
  const port = Number(process.argv[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Supply the note_test CDP port.");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find(item => item.title.includes("note_test") && item.url.startsWith("app:"));
  if (!target) throw Error("note_test window not found.");
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  let id = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data), waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    message.error ? waiter.reject(Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
  };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const number = ++id, timer = setTimeout(() => { pending.delete(number); reject(Error(`CDP timeout: ${method}`)); }, 45000);
    pending.set(number, { resolve, reject, timer }); socket.send(JSON.stringify({ id: number, method, params }));
  });
  const evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  try {
    await call("Page.bringToFront");
    await evaluate(await fs.readFile(path.resolve(__dirname, "../tests/manual/staged-switch-ui.js"), "utf8"));
    for (let round = 0; round < 6; round++) {
      for (const area of ["staged", "unstaged"]) for (let file = 0; file < 4; file++) {
        const position = await evaluate(`window.__vbStagedSwitch.position(${file}, ${JSON.stringify(area)})`);
        await call("Input.dispatchMouseEvent", { type: "mouseMoved", ...position });
        await call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...position });
        await call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...position });
        const expected = round * 8 + (area === "unstaged" ? 4 : 0) + file + 1;
        const deadline = Date.now() + 15000;
        while (true) {
          const state = await evaluate("window.__vbStagedSwitch.poll()");
          if (state.count === expected && state.done) break;
          if (Date.now() > deadline) throw Error(`Click did not complete: ${round}/${area}/${file}: ${JSON.stringify(state)}`);
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    }
    const report = await evaluate("window.__vbStagedSwitch.report()");
    report.samples = report.samples.slice(8);
    report.note = "40 trusted GUI clicks after discarding eight warm-up clicks; DOM-ready and navigation completion exclude physical paint.";
    if (report.statusCounts.staged !== 100 || report.statusCounts.changed !== 100 || !report.indexUnchanged || !report.modeChecksPassed || !report.samples.every(sample => sample.trusted)) {
      throw Error("Fixture status, index, mode or trusted-click checks failed.");
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    try { await evaluate("window.__vbStagedSwitch?.cleanup()"); }
    finally { socket.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
