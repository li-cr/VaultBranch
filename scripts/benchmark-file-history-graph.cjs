"use strict";

// Isolated Git-data benchmark; no Obsidian UI or paint timing is measured.
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { GitService } = require("../src/git.js");

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vb-history-graph-bench-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  const report = { version: require("../manifest.json").version, node: process.version, platform: `${process.platform}/${process.arch}`,
    git: git("--version").trim(), scope: "Warm Git data loading only; includes subprocesses, excludes UI/paint. Five alternating samples per mode after warm-up. No concurrent tests/builds.", cases: [] };
  try {
    for (const interleaved of [false, true]) {
      const folder = path.join(root, interleaved ? "interleaved" : "chain"); await fs.mkdir(folder);
      execFileSync("git", ["init", "-b", "main"], { cwd: folder, windowsHide: true });
      let input = "";
      const file = "notes/deep/note.md";
      for (let n = 0; n < (interleaved ? 2000 : 1000); n++) {
        const name = interleaved && n % 2 ? "other.md" : file;
        const body = `# Revision ${n}\n` + "Example paragraph.\n".repeat(200);
        const message = `Update ${name} ${n}`;
        input += `commit refs/heads/main\ncommitter Benchmark <bench@example.invalid> ${1700000000 + n} +0000\ndata ${Buffer.byteLength(message)}\n${message}\nM 100644 inline ${name}\ndata ${Buffer.byteLength(body)}\n${body}\n`;
      }
      execFileSync("git", ["fast-import", "--quiet"], { cwd: folder, windowsHide: true, input, encoding: "utf8" });
      const service = new GitService(folder); await service.init();
      const run = service.run; let commands = [];
      service.run = function (args, options) { commands.push(args[0]); return run.call(this, args, options); };
      for (const graph of [false, true]) await service.fileHistory(file, { graph });
      const samples = [];
      for (let n = 0; n < 5; n++) for (const graph of n % 2 ? [true, false] : [false, true]) {
        commands = []; const start = performance.now();
        const data = await service.fileHistory(file, { graph });
        samples.push({ graph, ms: Number((performance.now() - start).toFixed(2)), rows: data.commits.length, commands: [...commands] });
      }
      const summary = [false, true].map(graph => {
        const values = samples.filter(s => s.graph === graph).map(s => s.ms).sort((a, b) => a - b);
        return { graph, samples: values.length, medianMs: values[2], minMs: values[0], maxMs: values.at(-1) };
      });
      report.cases.push({ name: interleaved ? "1000 file revisions interleaved with 1000 unrelated commits" : "1000 consecutive file revisions", page: 50, summary, samples });
    }
    console.log(JSON.stringify(report, null, 2));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
