"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { builtinModules } = require("node:module");
const { build } = require("esbuild");

(async () => {
  const root = path.resolve(__dirname, "..");
  await build({
    entryPoints: [path.join(root, "src/main.js")],
    outfile: path.join(root, "main.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "es2022",
    external: ["obsidian", "@codemirror/state", "@codemirror/view", "@codemirror/commands", "@codemirror/language", "@lezer/common", "@lezer/highlight", "@lezer/lr", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
    banner: { js: "/* VaultBranch | MIT License | https://github.com/li-cr/VaultBranch */" },
  });
  const dist = path.join(root, "dist/vaultbranch");
  await fs.mkdir(dist, { recursive: true });
  for (const file of ["main.js", "manifest.json", "styles.css", "README.md", "LICENSE"]) {
    await fs.copyFile(path.join(root, file), path.join(dist, file));
  }
  console.log("Built main.js and dist/vaultbranch (no extra runtime files required).");
})().catch((error) => { console.error(error); process.exitCode = 1; });
