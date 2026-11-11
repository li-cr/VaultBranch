(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in note_test.");
  const p = app.plugins.plugins.vaultbranch, saved = { ...p.settings }, results = [];
  const check = (value, label) => { if (!value) throw Error(label); results.push(label); };
  try {
    app.setting.open(); app.setting.openTabById("vaultbranch");
    const tab = app.setting.activeTab; tab.activeTab = "other"; tab.display();
    const row = [...tab.containerEl.querySelectorAll(".setting-item")].find(el => /Timing record limit|调优记录保留条数/.test(el.querySelector(".setting-item-name")?.textContent));
    const input = row?.querySelector('input[type="number"]');
    check(!!input && input.min === "0" && input.step === "1", "native settings expose a nonnegative integer retention input");
    const beforeTyping = p.settings.performanceLogLimit;
    input.value = "2"; input.dispatchEvent(new Event("input", { bubbles: true }));
    check(p.settings.performanceLogLimit === beforeTyping, "typing the first digit of 250 does not prematurely trim records to two");
    const set = async value => {
      input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
      for (let n = 0; n < 100; n++) {
        if ((await p.loadData()).performanceLogLimit === p.settings.performanceLogLimit) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw Error("Preference did not persist");
    };
    await set("250"); check(p.settings.performanceLogLimit === 250, "manually entered 250 persists");
    await set("0"); check(p.settings.performanceLogLimit === 0, "manually entered zero selects unlimited retention");
    for (const invalid of ["-1", "1.5", ""]) {
      await set(invalid); check(p.settings.performanceLogLimit === 0, `invalid input ${JSON.stringify(invalid)} does not change the saved limit`);
    }
    input.dispatchEvent(new Event("blur")); check(input.value === "0", "leaving an invalid input restores the saved value");
    await p.updateSetting("language", saved.language === "en" ? "zh" : "en"); tab.display();
    check(/Timing record limit|调优记录保留条数/.test(tab.containerEl.textContent), "retention setting supports both interface languages");
    check(!(window.__vaultbranchErrors || []).length, "no runtime errors");
    return { results };
  } finally {
    await p.updateSetting("performanceLogLimit", saved.performanceLogLimit);
    await p.updateSetting("language", saved.language); app.setting.close();
  }
})()
