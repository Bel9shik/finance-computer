(() => {
  if (window.__startupCheck) return window.__startupCheck;
  const nav = document.querySelector('nav[aria-label="Разделы"]');
  if (nav?.querySelectorAll("button").length !== 5 || !document.querySelector(".brand")?.getBoundingClientRect().height) return "pending";
  window.__startupCheck = "pending";
  void (async () => {
    try {
      // No mocked API: startup must complete through the actual signed app.
      const source = await window.__TAURI_INTERNALS__.invoke("load_ledger");
      const ledger = source ? JSON.parse(source) : null;
      if (ledger?.operations.some((o) => o.id === "finance-sandbox-1")) {
        const wait = async (predicate, name) => {
          for (let i = 0; i < 100; i++) {
            if (predicate()) return;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw Error("Timeout: " + name);
        };
        const button = (text, root = document) => [...root.querySelectorAll("button")]
          .find((item) => item.textContent.trim() === text);
        const check = (value, name) => { if (!value) throw Error(name); };
        const amount = (element) => element.textContent.replace(/\s/g, "");
        await wait(() => document.querySelectorAll(".chart-scroll").length === 3, "charts");
        const totals = [...document.querySelectorAll(".metric strong")].map(amount);
        check(totals[0] === "375,50₽" && totals[1] === "1005,00₽" && totals[2] === "100,00₽", "expense, income and savings totals");
        const pie = document.querySelector(".pie-layout");
        check(pie.compareDocumentPosition(document.querySelector(".chart-scroll")) & Node.DOCUMENT_POSITION_FOLLOWING, "pie before lines");
        pie.querySelector(".legend-row").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        check(!document.querySelector("dialog[open]"), "no hover drilldown");
        pie.querySelector(".pie-slice").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await wait(() => document.querySelector("dialog tbody tr"), "category operations");
        check(document.querySelectorAll("dialog tbody tr").length === 1, "category contains only its expense");
        button("Готово", document.querySelector("dialog[open]")).click();
        await wait(() => !document.querySelector("dialog[open]"), "close category");
        const period = document.querySelector(".filters select");
        period.value = "2026-10";
        period.dispatchEvent(new Event("change", { bubbles: true }));
        await wait(() => amount(document.querySelector(".metric strong")) === "250,00₽", "month filter");
        check(document.querySelector("main").textContent.includes("Расходы по дням"), "daily chart");
        period.value = "Все месяцы";
        period.dispatchEvent(new Event("change", { bubbles: true }));
        await wait(() => amount(document.querySelector(".metric strong")) === "375,50₽", "all months");
        button("Операции", nav).click();
        await wait(() => document.querySelectorAll("tbody tr").length === 5, "operations table");
        const amountHeader = button("Сумма");
        amountHeader.click();
        await wait(() => amount(document.querySelector("tbody tr td:nth-child(4)")).startsWith("-250,00"), "ascending sort");
        amountHeader.click();
        await wait(() => amount(document.querySelector("tbody tr td:nth-child(4)")).startsWith("1000,00"), "descending sort");
        button("Обзор", nav).click();
        await wait(() => document.querySelector(".pie-layout"), "return to overview");
        window.__sandboxCheck = "PASS";
      }
      const waitFor = async (predicate, name) => {
        for (let i = 0; i < 100; i++) {
          if (predicate()) return;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw Error("Timeout: " + name);
      };
      const findButton = text => [...document.querySelectorAll("button")].find(b => b.textContent.trim() === text);
      findButton("Группы и пресет").click();
      await waitFor(() => findButton("Авторазбор и MCC"), "automatic rules entry");
      findButton("Категории").click();
      await waitFor(() => document.querySelector('dialog[aria-label="Категории"] .group-row'), "categories editor");
      const uncategorized = [...document.querySelectorAll("dialog .group-row")].find(row => row.querySelector("strong")?.textContent === "Без категории");
      if (!uncategorized || uncategorized.querySelector("button")) throw Error("Uncategorized must be protected");
      const editCategory = [...document.querySelectorAll("dialog button")].find(b => b.textContent === "Изменить");
      if (editCategory) {
        editCategory.click();
        await waitFor(() => findButton("Переименовать"), "category rename editor");
        findButton("Отмена").click();
      }
      findButton("Готово").click();
      await waitFor(() => !document.querySelector("dialog[open]"), "close categories");
      findButton("Авторазбор и MCC").click();
      await waitFor(() => document.querySelector(".automatic-rules .notice"), "automatic preview");
      const inputs = document.querySelectorAll(".automatic-rules .toolbar input");
      const set = (element, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set(inputs[0], "5641");
      set(inputs[1], "Проверка просмотра");
      await waitFor(() => !findButton("Добавить в просмотр").disabled, "MCC draft");
      findButton("Добавить в просмотр").click();
      await waitFor(() => document.querySelector(".automatic-rules tbody")?.textContent.includes("Проверка просмотра"), "MCC preview row");
      findButton("Готово").click();
      await waitFor(() => !document.querySelector("dialog[open]"), "close preview");
      if (await window.__TAURI_INTERNALS__.invoke("load_ledger") !== source) throw Error("Preview changed the database");
      findButton("Обзор").click();
      const blocked = new Set();
      const violation = (e) => blocked.add(e.effectiveDirective);
      document.addEventListener("securitypolicyviolation", violation);
      // Loopback test server: no internet or financial data in the probes.
      await fetch("http://127.0.0.1:43127/offline-check").catch(() => {});
      const img = new Image();
      img.src = "http://127.0.0.1:43127/offline-image";
      document.body.append(img);
      const script = document.createElement("script");
      script.src = "http://127.0.0.1:43127/offline-script";
      document.body.append(script);
      const original = location.href;
      location.href = "http://127.0.0.1:43127/offline-navigation";
      await new Promise((resolve) => setTimeout(resolve, 250));
      document.removeEventListener("securitypolicyviolation", violation);
      img.remove(); script.remove();
      window.__startupCheck = location.href === original &&
        ["connect-src", "img-src", "script-src-elem"].every((directive) => blocked.has(directive))
          ? (window.__sandboxCheck === "PASS" ? "SANDBOX_PASS" : "PASS") : "FAIL: offline restrictions";
    } catch (error) {
      console.error("Startup check:", error);
      window.__startupCheck = "FAIL: " + String(error);
    }
  })();
  return "pending";
})();
