(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in note_test.");
  const p = app.plugins.plugins.vaultbranch;
  if (!p || [...p.editors.sessions.values()].some(s => s.dirty || s.saving)) throw Error("Save drafts first.");
  await p.diffNavigationTask; await p.refreshTask; p.refreshSoon?.cancel();
  const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
  const exec = require("node:util").promisify(require("node:child_process").execFile);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vaultbranch-images-"));
  const saved = { git: p.git, status: p.status, ready: p.ready, scheduleRefresh: p.scheduleRefresh, lastAutoRefresh: p.lastAutoRefresh };
  const results = [], fixtures = [];
  const check = (value, name) => { if (!value) throw Error(name); results.push(name); };
  const git = async (...args) => (await exec(saved.git.binary, args, { cwd: root, windowsHide: true })).stdout;
  const write = async (name, bytes) => { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), bytes); };
  const png = (width, height, color, noise = false) => {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = color; context.fillRect(0, 0, width, height);
    if (noise) {
      const data = context.getImageData(0, 0, width, height); let seed = 123;
      for (let i = 0; i < data.data.length; i += 4) for (let n = 0; n < 3; n++) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; data.data[i + n] = seed >>> 24; }
      context.putImageData(data, 0, 0);
    }
    return Buffer.from(canvas.toDataURL("image/png").split(",")[1], "base64");
  };
  let release, pending, leaf, historyLeaf, source, collapsed, selected;
  try {
    p.scheduleRefresh = () => {}; p.lastAutoRefresh = Date.now() + 3600000;
    for (const open of app.workspace.getLeavesOfType("vaultbranch-diff")) await open.detach();
    for (const open of app.workspace.getLeavesOfType("vaultbranch-file-history")) await open.detach();
    await git("init", "-b", "main"); await git("config", "user.name", "Image UI test"); await git("config", "user.email", "test@example.invalid");
    const name = "Fig/deep/nested/TMP-{counter_00X}.png", big = "Fig/large/nested/TMP-{counter_00X}.png";
    const base = png(80, 60, "#cc5555"), staged = png(100, 70, "#55bb66"), working = png(120, 90, "#5588cc"), large = png(1024, 1024, "#000000", true);
    fixtures.push({ path: name, bytes: base.length, width: 80, height: 60 }, { path: big, bytes: large.length, width: 1024, height: 1024 });
    check(large.length > 1024 * 1024, "large image fixture exceeds one MiB");
    await write(name, base); await write(big, large); await git("add", "."); await git("commit", "-m", "Image base");
    const created = (await git("rev-parse", "HEAD")).trim();
    await write(name, staged); await git("add", name); await git("commit", "-m", "Image edit");
    const edited = (await git("rev-parse", "HEAD")).trim();
    await write(name, working); await git("add", name); await write(name, base);
    await write(big, Buffer.concat([large, Buffer.from("working")]));
    await write("new.png", working); await write("broken.png", "broken image"); await write("binary.bin", Buffer.from([0, 255]));
    const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 24;
    canvas.getContext("2d").fillRect(0, 0, 32, 24);
    for (const [extension, mime] of [["jpg", "image/jpeg"], ["webp", "image/webp"]]) await write(`sample.${extension}`, Buffer.from(canvas.toDataURL(mime).split(",")[1], "base64"));
    await write("sample.gif", Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
    const index = await git("write-tree");
    p.git = new saved.git.constructor(root, { binary: saved.git.binary }); await p.git.init(); p.ready = true; p.status = await p.git.status();
    source = (await p.openSidebar()).view; collapsed = new Set(source.collapsed); selected = source.selected;
    source.collapsed.clear(); source.renderSnapshot = null; source.render();
    const open = async (filePath, area = "unstaged", extra = {}) => {
      leaf = await p.openDiff({ ...(p.status.files.find(file => file.path === filePath) || { path: filePath }), ...extra }, area);
      return [...leaf.view.contentEl.querySelectorAll(".vaultbranch-image-preview img")];
    };
    let images = await open(name);
    check(images.length === 2 && images[0].naturalWidth === 120 && images[1].naturalWidth === 80, "Changes uses index and disk images, fully decoded");
    const zoomImage = images[0], otherImage = images[1];
    const preview = zoomImage.parentElement, grid = preview.closest(".vaultbranch-image-comparison");
    const initial = zoomImage.getBoundingClientRect(), gridSize = grid.getBoundingClientRect();
    const wheel = (deltaY, deltaMode = 0) => zoomImage.dispatchEvent(new WheelEvent("wheel", { deltaY, deltaMode, clientX: initial.x + initial.width / 2, clientY: initial.y + initial.height / 2, bubbles: true, cancelable: true }));
    check(!wheel(-100) && zoomImage.getBoundingClientRect().width > initial.width, "wheel up zooms the hovered image and prevents page scrolling");
    check(!otherImage.style.transform, "zooming one image leaves the other version unchanged");
    check(Math.abs(grid.getBoundingClientRect().width - gridSize.width) < 1 && Math.abs(grid.getBoundingClientRect().height - gridSize.height) < 1, "zooming does not resize the comparison layout");
    for (let n = 0; n < 40; n++) wheel(-100);
    check(Math.abs(zoomImage.getBoundingClientRect().width / initial.width - 8) < 0.01, "image zoom is bounded at eight times the initial size");
    for (let n = 0; n < 40; n++) wheel(100);
    check(Math.abs(zoomImage.getBoundingClientRect().width - initial.width) < 1 && !preview.classList.contains("is-zoomed"), "wheel down never shrinks below the initial fit");
    wheel(-3, 1); check(preview.classList.contains("is-zoomed"), "line-mode wheel events also zoom");
    zoomImage.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    check(Math.abs(zoomImage.getBoundingClientRect().width - initial.width) < 1 && !preview.classList.contains("is-zoomed"), "double click resets the initial fit");
    const electron = require("electron").remote;
    electron.getCurrentWindow().show(); electron.getCurrentWindow().focus();
    const web = electron.getCurrentWebContents();
    const input = (type, data, expected) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { document.removeEventListener(expected, done, true); reject(Error(`Missing native ${expected} event`)); }, 3000);
      const done = event => { clearTimeout(timer); document.removeEventListener(expected, done, true); setTimeout(() => resolve(event), 0); };
      document.addEventListener(expected, done, true); web.sendInputEvent({ type, ...data });
    });
    const point = { x: Math.round(initial.x + initial.width / 2), y: Math.round(initial.y + initial.height / 2) };
    const nativeWheel = await input("mouseWheel", { ...point, deltaX: 0, deltaY: 200, canScroll: true }, "wheel");
    check(nativeWheel.isTrusted && preview.classList.contains("is-zoomed"), "native trusted mouse wheel enlarges the hovered image");
    // Use a larger scale so this small fixture overflows its pane and can pan.
    for (let n = 0; n < 20; n++) wheel(-100);
    const xBefore = new DOMMatrix(zoomImage.style.transform).m41;
    const down = await input("mouseDown", { ...point, button: "left", clickCount: 1 }, "pointerdown");
    const move = await input("mouseMove", { x: point.x + 40, y: point.y, modifiers: ["leftButtonDown"] }, "pointermove");
    await input("mouseUp", { x: point.x + 40, y: point.y, button: "left", clickCount: 1 }, "pointerup");
    check(down.isTrusted && move.isTrusted && new DOMMatrix(zoomImage.style.transform).m41 > xBefore, "native mouse drag pans the enlarged image");
    check(!preview.hasPointerCapture(down.pointerId), "mouse release ends pointer capture");
    for (let n = 0; n < 8; n++) await input("mouseWheel", { ...point, deltaX: 0, deltaY: -200, canScroll: true }, "wheel");
    check(Math.abs(zoomImage.getBoundingClientRect().width - initial.width) < 1 && !preview.classList.contains("is-zoomed"), "native wheel down returns to the original fit without shrinking below it");
    check(!leaf.view.merge && !leaf.view.session && !leaf.view.contentEl.querySelector(".vaultbranch-diff-navigation"), "image previews create no text editor, save or chunk controls");
    const oldImages = images;
    images = await open(name, "staged");
    check(images[0].naturalWidth === 100 && images[1].naturalWidth === 120, "Staged uses HEAD and index, ignoring later disk contents");
    check(oldImages.every(image => !image.getAttribute("src")), "switching releases old image sources");
    check(images.every(image => !image.style.transform), "switching image versions starts at the initial fit");
    images = await open("new.png");
    check(images.length === 1 && images[0].naturalWidth === 120 && leaf.view.contentEl.querySelectorAll(".vaultbranch-image-pane").length === 2, "new image shows current image and an empty old version");
    for (const extension of ["jpg", "webp", "gif"]) {
      images = await open(`sample.${extension}`);
      check(images.length === 1 && images[0].naturalWidth > 0, `${extension} decodes as an image preview`);
    }
    images = await open(name, "history", { commit: created });
    check(images.length === 1 && images[0].naturalWidth === 80, "root commit image has no parent image");
    images = await open(name, "history", { commit: edited });
    check(images[0].naturalWidth === 80 && images[1].naturalWidth === 100, "commit diff decodes parent and current images");
    for (const filePath of [big, name, big, "new.png", name]) {
      images = await open(filePath);
      check(images.every(image => image.complete && image.naturalWidth > 0), `mixed image switch completes: ${filePath}`);
    }
    const view = leaf.view, read = view.readComparison;
    const before = view.contentEl.querySelector(".vaultbranch-image-comparison");
    let started; const start = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; }); let late;
    view.readComparison = async function(...args) {
      const loaded = await read.apply(this, args);
      if (args[0].path === big) { late = loaded; started(); await gate; }
      return loaded;
    };
    pending = p.openDiff(p.status.files.find(file => file.path === big), "unstaged"); await start;
    check(view.contentEl.querySelector(".vaultbranch-image-comparison") === before && view.contentEl.inert, "pending image switch preserves the complete previous page");
    await open("new.png");
    check(view.file.path === "new.png" && !view.contentEl.inert, "new image becomes usable before a blocked old request");
    release(); await pending; pending = null; view.readComparison = read;
    check(view.file.path === "new.png", "late image read cannot replace the newer page");
    const removed = document.createElement("div"); late.images.render(removed, ["old", "new"]);
    check([...removed.querySelectorAll("img")].every(image => !image.getAttribute("src")), "cancelled image preview releases its sources");
    await open("broken.png"); check(!!view.contentEl.querySelector(".is-error") && !view.contentEl.inert, "corrupt image shows a readable error and restores interaction");
    await open(name); check(view.contentEl.querySelectorAll("img").length === 2, "a valid image opens after a decode failure");
    await write("huge.png", Buffer.alloc(10 * 1024 * 1024 + 1)); await open("huge.png");
    check(view.contentEl.querySelector(".is-error")?.textContent.includes("10 MB"), "over-ten-MiB image falls back to an external-view message");
    await open("binary.bin"); check(!view.images && !view.contentEl.querySelector("img"), "other binary files retain their existing fallback");
    historyLeaf = await p.openFileHistory(name);
    check(historyLeaf.view.detailsEl.querySelectorAll("img").length === 2, "file history displays both decoded image versions");
    await historyLeaf.view.selectCommit(historyLeaf.view.commits.find(commit => commit.hash === created));
    check(historyLeaf.view.detailsEl.querySelectorAll("img").length === 1, "file history root selection has one image");
    await historyLeaf.detach(); historyLeaf = null;
    await fs.unlink(path.join(root, name)); images = await open(name);
    check(images.length === 1 && images[0].naturalWidth === 120, "deleted working image retains its index preview");
    await leaf.detach(); leaf = null;
    check(!images[0].getAttribute("src") && !p.editors.sessions.size, "closing clears image sources and leaves no editor sessions");
    check((await git("write-tree")) === index, "all previews and history navigation leave the index unchanged");
    check(!(window.__vaultbranchErrors || []).length, "no runtime errors");
    return { results, fixtures, errors: window.__vaultbranchErrors || [] };
  } finally {
    release?.(); if (pending) await pending.catch(() => {});
    if (leaf) await leaf.detach(); if (historyLeaf) await historyLeaf.detach();
    p.git = saved.git; p.status = saved.status; p.ready = saved.ready;
    p.scheduleRefresh = saved.scheduleRefresh; p.lastAutoRefresh = saved.lastAutoRefresh;
    if (source) { source.collapsed = collapsed; source.selected = selected; source.renderSnapshot = null; }
    await p.refresh(); await fs.rm(root, { recursive: true, force: true });
  }
})()
