"use strict";

// Optional first argument: a baseline git.js with its adjacent i18n.js.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { GitService } = require(process.argv[2] ? path.resolve(process.argv[2]) : "../src/git.js");

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vaultbranch-history-benchmark-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  try {
    git("init", "-b", "main");
    git("config", "user.name", "Benchmark"); git("config", "user.email", "benchmark@example.invalid");
    let input = "blob\nmark :1\ndata 5\nbase\n\n";
    for (let i = 0; i < 1000; i++) {
      const message = `Benchmark commit ${i}`;
      input += `commit refs/heads/main\ncommitter Benchmark <benchmark@example.invalid> ${1700000000+i} +0000\ndata ${Buffer.byteLength(message)}\n${message}\n${i ? "" : "M 100644 :1 note.md\n"}\n`;
    }
    execFileSync("git", ["fast-import", "--quiet"], { cwd: root, input, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    git("reset", "--hard", "HEAD");
    for (let i = 0; i < 3; i++) { await fs.writeFile(path.join(root, "note.md"), `stash ${i}\n`); git("stash", "push", "-m", `benchmark ${i}`); }
    const service = new GitService(root);
    await service.init();
    const read = () => service.historyData ? service.historyData(1000) : Promise.all([
      service.history(1000),
      service.run(["for-each-ref", "--format=%(refname:short)", "refs/heads/", "refs/remotes/"]),
      service.stashExists(),
    ]);
    await read(); // Warm the same scenario once; do not mix cold and warm samples.
    const run = service.run.bind(service), samples = [];
    for (let i = 0; i < 5; i++) {
      const commands = [];
      service.run = (args, options) => { commands.push(args[0]); return run(args, options); };
      const start = performance.now(); await read();
      samples.push({ ms: Number((performance.now()-start).toFixed(2)), gitProcesses: commands.length, commands });
    }
    const times = samples.map(s => s.ms).sort((a, b) => a-b);
    console.log(JSON.stringify({ environment: { platform: `${process.platform} ${os.release()}`, node: process.version, git: git("--version").trim() }, scenario: "1000 commits, 3 stashes, unchanged history reload; one warm-up; includes Git reads, parsing and graph calculation, excludes DOM/paint", samples, medianMs:times[2], rangeMs:[times[0],times.at(-1)] }, null, 2));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
