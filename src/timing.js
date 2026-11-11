"use strict";

function measure(trace, name, action) {
  const end = trace?.span(name);
  if (!end) return action();
  try {
    const result = action();
    if (result?.then) return result.then(value => { end(); return value; }, error => { end(); throw error; });
    end(); return result;
  } catch (error) { end(); throw error; }
}

class TimingLog {
  constructor(limit = 100, clock = () => performance.now()) {
    this.records = []; this.limit = limit; this.clock = clock; this.generation = 0; this.sequence = 0;
  }
  clear() { this.records.length = 0; this.generation++; }
  start(details) {
    const start = this.clock(), generation = this.generation;
    const record = { id: ++this.sequence, time: new Date().toISOString(), ...details, status: "pending", stages: [] };
    this.records.push(record);
    if (this.records.length > this.limit) this.records.shift();
    const valid = () => generation === this.generation;
    const elapsed = () => Math.round((this.clock() - start) * 100) / 100;
    return {
      record,
      mark: name => { if (valid()) record[name] = elapsed(); },
      span: name => {
        const at = this.clock(); let ended = false;
        return () => {
          if (ended || !valid()) return;
          ended = true;
          if (record.stages.length < 100) record.stages.push({ name, startMs: Math.round((at - start) * 100) / 100, durationMs: Math.round((this.clock() - at) * 100) / 100 });
        };
      },
      ready: (document, isCurrent) => {
        if (!valid()) return;
        record.domReadyMs = elapsed();
        if (document.hidden) { record.frameStatus = "hidden"; return; }
        record.frameStatus = "pending";
        document.defaultView.requestAnimationFrame(() => {
          if (!valid()) return;
          if (!isCurrent()) { record.frameStatus = "superseded"; return; }
          record.firstFrameMs = elapsed();
          document.defaultView.requestAnimationFrame(() => {
            if (!valid()) return;
            record.frameStatus = isCurrent() ? "observed" : "superseded";
            if (isCurrent()) record.nextFrameMs = elapsed();
          });
        });
      },
      finish: status => { if (valid()) { record.status = status; record.completedMs = elapsed(); } },
    };
  }
}

module.exports = { TimingLog, measure };
