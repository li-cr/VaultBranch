"use strict";

const fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--obsidian-cli", "--baseline-build", "--output-dir"].includes(args[i]) || !args[i + 1]) throw Error("Usage: npm run release:check -- --obsidian-cli <executable> --baseline-build <directory> --output-dir <directory>");
  options[args[i]] = path.resolve(args[i + 1]);
}
if (Object.keys(options).length !== 3) throw Error("Specify --obsidian-cli, --baseline-build and --output-dir; the UI vault is always note_test.");
for (const name of ["main.js", "manifest.json", "styles.css"]) fs.accessSync(path.join(options["--baseline-build"], name));
const output = options["--output-dir"];
fs.mkdirSync(output, { recursive: true });
function run(name, executable, parameters, timeout) {
  try {
    const result = execFileSync(executable, parameters, { cwd: root, windowsHide: true, encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024 });
    fs.writeFileSync(path.join(output, name + ".log"), result);
    if (/^(?:Error:|\[error\])/m.test(result)) throw Error(result);
    console.log(name + " passed");
    return result;
  } catch (error) {
    fs.writeFileSync(path.join(output, name + "-failed.log"), String(error.stdout || "") + "\n" + String(error.stderr || error.stack));
    throw error;
  }
}
try {
  run("check", process.execPath, [path.join(root, "scripts/validate.cjs")], 60000);
  run("test", process.execPath, ["--test", ...fs.readdirSync(path.join(root, "tests")).filter(name => name.endsWith(".test.cjs")).map(name => path.join(root, "tests", name))], 240000);
  run("build", process.execPath, [path.join(root, "scripts/build.cjs")], 60000);
  const code = `(async()=>{window.__vbReleaseOptions=${JSON.stringify({ sourceRoot: root, outputDir: output, baselineBuild: options["--baseline-build"] })};return await eval(require("node:fs").readFileSync(${JSON.stringify(path.join(root, "tests/manual/release-ui.js"))},"utf8"));})()`;
  const safe = "eval(String.fromCharCode(" + Array.from(code, char => char.charCodeAt(0)).join(",") + "))";
  console.log("Running both builds' startup/switch/edit measurements, then the complete UI regression suite in note_test.");
  const result = run("obsidian-ui", options["--obsidian-cli"], ["vault=note_test", "eval", "code=" + safe], 300000);
  const json = JSON.parse(result.slice(result.indexOf("=> ") + 3));
  console.log(JSON.stringify(json, null, 2));
  console.log("Reports: " + output);
} catch (error) { console.error(error.message); process.exitCode = 1; }
