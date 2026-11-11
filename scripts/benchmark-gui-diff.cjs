"use strict";
// Run against a disposable note_test Electron instance with remote debugging.
// Usage: node scripts/benchmark-gui-diff.cjs 9225 > result.json
const fs = require("node:fs/promises");
const path = require("node:path");
(async () => {
  const port = Number(process.argv[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Supply the test instance's CDP port.");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find(t => t.title.includes("note_test") && t.url.startsWith("app:"));
  if (!target) throw Error("note_test window not found");
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  let id = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data), waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    if (message.error) waiter.reject(Error(JSON.stringify(message.error))); else waiter.resolve(message.result);
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
    await evaluate(`window.__vbGuiTimingMode = ${JSON.stringify(process.argv[3] === "off" ? "off" : "on")}`);
    await evaluate(await fs.readFile(path.resolve(__dirname, "../tests/manual/gui-timing-fixture.js"), "utf8"));
    for (let round = 0; round < 6; round++) for (let n = 0; n < 4; n++) {
      const position = await evaluate(`window.__vbGuiTiming.position(${n})`);
      await call("Input.dispatchMouseEvent", { type: "mouseMoved", ...position });
      await call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...position });
      await call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...position });
      const deadline = Date.now() + 15000;
      while (true) {
        const state = await evaluate("window.__vbGuiTiming.poll()");
        if (state.count === round * 4 + n + 1 && state.done) {
          if (!state.hasFrame) await new Promise(resolve => setTimeout(resolve, 50));
          break;
        }
        if (Date.now() > deadline) throw Error(`GUI click did not complete: ${round}:${n}, ${JSON.stringify(state)}`);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    const report = await evaluate("window.__vbGuiTiming.report()");
    report.samples = report.samples.slice(4); // Discard the warm-up cycle.
    if (!report.samples.every(sample => sample.trusted)) throw Error("Expected trusted GUI clicks");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    try { await evaluate("window.__vbGuiTiming?.cleanup()"); }
    finally { socket.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
