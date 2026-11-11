"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TimingLog, measure } = require("../src/timing.js");

test("disabled tracing preserves synchronous and asynchronous action behavior", async () => {
  assert.equal(measure(undefined, "disabled", () => 7), 7);
  assert.equal(await measure(undefined, "disabled", async () => 8), 8);
  assert.throws(() => measure(undefined, "disabled", () => { throw Error("same error"); }), /same error/);
});

test("records are bounded and clearing invalidates pending spans and completions", () => {
  let now = 0;
  const log = new TimingLog(2, () => now), first = log.start({ path: "a.md" });
  const end = first.span("read"); now = 5; end(); end(); first.finish("complete");
  assert.deepEqual(first.record.stages, [{ name: "read", startMs: 0, durationMs: 5 }]);
  const second = log.start({ path: "b.md" }), third = log.start({ path: "c.md" });
  assert.deepEqual(log.records.map(r => r.path), ["b.md", "c.md"]);
  log.clear(); second.finish("complete"); third.span("late")();
  assert.equal(log.records.length, 0);
  assert.equal(second.record.status, "pending");
});

test("concurrent asynchronous traces keep Git-like spans with the correct click", async () => {
  const log = new TimingLog(), a = log.start({ path: "a.md" }), b = log.start({ path: "b.json" });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = measure(a, "a-read", async () => { await gate; });
  await measure(b, "b-read", async () => { release(); });
  await first;
  assert.deepEqual(a.record.stages.map(s => s.name), ["a-read"]);
  assert.deepEqual(b.record.stages.map(s => s.name), ["b-read"]);
});

test("render readiness is separate from completion and unavailable hidden frames are explicit", () => {
  let now = 0;
  const trace = new TimingLog(100, () => now).start({ path: "note.md" });
  now = 10; trace.ready({ hidden: true }, () => true);
  now = 30; trace.finish("complete");
  assert.equal(trace.record.domReadyMs, 10);
  assert.equal(trace.record.completedMs, 30);
  assert.equal(trace.record.frameStatus, "hidden");
  assert.equal(trace.record.firstFrameMs, undefined);
});

test("frame callbacks report scheduling and discard superseded or cleared pages", () => {
  let now = 0;
  const frames = [], document = { hidden: false, defaultView: { requestAnimationFrame: fn => frames.push(fn) } };
  const log = new TimingLog(100, () => now), trace = log.start({ path: "note.md" });
  now = 5; trace.ready(document, () => true); now = 6; trace.finish("complete");
  now = 10; frames.shift()(); now = 20; frames.shift()();
  assert.equal(trace.record.domReadyMs, 5); assert.equal(trace.record.firstFrameMs, 10); assert.equal(trace.record.nextFrameMs, 20);
  assert.equal(trace.record.frameStatus, "observed");
  const stale = log.start({}); stale.ready(document, () => false); frames.shift()();
  assert.equal(stale.record.frameStatus, "superseded");
  const cleared = log.start({}); cleared.ready(document, () => true); log.clear(); frames.shift()();
  assert.equal(cleared.record.firstFrameMs, undefined);
});
