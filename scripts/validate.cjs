"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const manifest = require(path.join(root, "manifest.json"));
const pkg = require(path.join(root, "package.json"));
const versions = require(path.join(root, "versions.json"));
assert.equal(manifest.id, "vaultbranch");
assert.equal(manifest.name, "VaultBranch");
assert.equal(pkg.version, manifest.version);
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.isDesktopOnly, true);
for (const file of ["README.md", "LICENSE", "src/main.js", "src/git.js", "src/i18n.js", "styles.css"]) {
  assert.ok(fs.statSync(path.join(root, file)).size, `Missing ${file}`);
}
const sourceFiles = fs.readdirSync(path.join(root, "src"), { recursive: true }).filter((file) => file.endsWith(".js")).map((file) => path.join("src", file));
for (const file of sourceFiles) execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe", windowsHide: true });
for (const file of [...sourceFiles, "default-settings.json"]) {
  assert.doesNotMatch(fs.readFileSync(path.join(root, file), "utf8"), /C:[\\/]|my-git|note_test|createRequire/);
}
assert.doesNotMatch(fs.readFileSync(path.join(root, "styles.css"), "utf8"), /!\s*important\b/i, "Use scoped selectors or CSS variables instead of !important.");
console.log("Manifest, version map, portable runtime and CSS validated.");
