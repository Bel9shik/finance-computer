// Executed only by the native test host; production does not include this file.
const initial = {
  version: 1,
  classificationVersion: 1,
  imports: [],
  operations: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      date: "2026-10-01",
      bank: "Test",
      account: "0001",
      details: "Оплата в CAFE",
      amount: -12550,
      currency: "RUB",
      category: "Кафе",
      kind: "Расход",
      source: "test",
      sourceRow: "1",
      bankID: "",
      possibleDuplicate: false,
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      date: "2026-10-02",
      bank: "Test",
      account: "0001",
      details: "Зарплата",
      amount: 100000,
      currency: "RUB",
      category: "Доходы",
      kind: "Доход",
      source: "test",
      sourceRow: "2",
      bankID: "",
      possibleDuplicate: false,
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      date: "2026-09-02",
      bank: "Test",
      account: "0001",
      details: "Накопления",
      amount: -10000,
      currency: "RUB",
      category: "Переводы",
      kind: "Откладывание на счета",
      source: "test",
      sourceRow: "3",
      bankID: "",
      possibleDuplicate: false,
    },
  ],
};
window.isTauri = true;
window.testSaves = [];
window.testBackups = [];
window.testExports = [];
window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args) => {
    if (cmd === "load_ledger") return JSON.stringify(initial);
    if (cmd === "save_ledger") {
      window.testSaves.push(JSON.parse(args.data));
      window.testBackups.push(args.backup);
      return;
    }
    if (cmd === "plugin:dialog|confirm") return true;
    if (cmd === "plugin:dialog|open") {
      const path =
        window.testFilename ||
        "file:///private/%D0%92%D1%8B%D0%BF%D0%B8%D1%81%D0%BA%D0%B0%20%D0%90%D0%BB%D1%8C%D1%84%D0%B0.xlsx";
      return args.options.multiple ? [path] : path;
    }
    if (cmd === "plugin:dialog|save") return "settings.json";
    if (cmd === "plugin:fs|write_file") {
      window.testExports.push(JSON.parse(new TextDecoder().decode(args)));
      return;
    }
    if (cmd === "plugin:fs|stat")
      return { size: window.testFile.length, isFile: true };
    if (cmd === "plugin:fs|read_file") return Array.from(window.testFile);
    throw Error("Unexpected native call: " + cmd);
  },
};
window.addEventListener("error", (e) =>
  window.webkit.messageHandlers.testResult.postMessage({
    ok: false,
    error: e.message,
  }),
);
window.addEventListener("unhandledrejection", (e) =>
  window.webkit.messageHandlers.testResult.postMessage({
    ok: false,
    error: String(e.reason),
  }),
);
window.addEventListener("DOMContentLoaded", () => {
  void (async () => {
    let checks = 0;
    const wait = async (fn, label) => {
      for (let i = 0; i < 200; i++) {
        if (fn()) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw Error("Timeout: " + label);
    };
    const check = (yes, name) => {
      if (!yes) throw Error(name);
      checks++;
    };
    const button = (text, root = document) =>
      [...root.querySelectorAll("button")].find((b) =>
        b.textContent.trim().endsWith(text),
      );
    const click = (element) => {
      check(element, "Missing click target");
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };
    const escape = (element, options = {}) => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
          ...options,
        }),
      );
    };
    await wait(
      () => document.querySelectorAll(".legend-row").length === 2,
      "initial charts",
    );
    check(
      document.querySelectorAll(".chart-scroll").length === 3,
      "three line charts",
    );
    check(
      document
        .querySelector(".pie-layout")
        .compareDocumentPosition(document.querySelector(".chart-scroll")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      "pie before lines",
    );
    check(
      document.documentElement.scrollWidth <= innerWidth + 2,
      "no horizontal page overflow",
    );
    if (
      matchMedia(
        "(max-width: 600px), (max-height: 600px) and (orientation: landscape), (hover: none) and (pointer: coarse)",
      ).matches
    ) {
      check(
        [...document.querySelectorAll("input, select, textarea")].every(
          (control) => parseFloat(getComputedStyle(control).fontSize) >= 16,
        ),
        "phone form controls avoid focus zoom",
      );
      check(
        [...document.querySelectorAll(".app-header button")].every(
          (control) => control.getBoundingClientRect().height >= 44,
        ),
        "phone toolbar buttons have touch-sized targets in both orientations",
      );
    }
    check(
      document
        .querySelector('nav[aria-label="Разделы"]')
        .getBoundingClientRect().top >=
        document.querySelector(".brand").getBoundingClientRect().bottom,
      "sections are below the brand, as in the original layout",
    );
    const pie = document.querySelector(".pie-layout");
    check(
      pie.querySelector(".pie-slice > circle") &&
        pie.querySelector(".pie-percentage").textContent.includes("100,0"),
      "one category fills the circle and shows 100 percent",
    );
    document
      .querySelector(".legend-row")
      .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    check(
      !document.querySelector("dialog[open]"),
      "hover must not open operations",
    );
    click(document.querySelector(".legend-row"));
    await wait(() => document.querySelector("dialog[open]"), "pie click");
    check(
      document.querySelectorAll("dialog tbody tr").length === 1,
      "category drilldown",
    );
    click(button("Готово", document.querySelector("dialog[open]")));
    await wait(
      () => !document.querySelector("dialog[open]"),
      "close legend drilldown",
    );
    click(pie.querySelector(".pie-slice"));
    await wait(() => document.querySelector("dialog[open]"), "sector click");
    click(document.querySelector("dialog .operation-open"));
    await wait(
      () => document.querySelectorAll("dialog[open]").length === 2,
      "operation editor",
    );
    const editor = [...document.querySelectorAll("dialog[open]")].at(-1);
    const select = editor.querySelector("select");
    select.value = "Не учитывать";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(() => window.testSaves.length === 1, "autosave");
    check(
      window.testSaves[0].operations[0].manualKind === true,
      "manual choice preserved",
    );
    escape(editor.querySelector("select"));
    await wait(
      () => document.querySelectorAll("dialog[open]").length === 1,
      "nested close",
    );
    const parentDialog = document.querySelector("dialog[open]");
    escape(parentDialog, { repeat: true });
    await new Promise((r) => setTimeout(r, 50));
    check(parentDialog.open, "held Escape does not close the parent dialog");
    escape(parentDialog);
    await wait(
      () => !document.querySelector("dialog[open]"),
      "close drilldown",
    );
    click(button("Группы и пресет"));
    await wait(() => document.querySelector(".group-row"), "groups");
    click(button("Категория и тип"));
    await wait(() => document.querySelector("dialog[open]"), "preset editor");
    click(button("Готово", document.querySelector("dialog[open]")));
    click(button("Операции"));
    await wait(
      () => document.querySelector(".operations thead"),
      "operations table",
    );
    check(
      getComputedStyle(document.querySelector("thead")).display !== "none",
      "column sorting is visible on desktop and phone",
    );
    const amountHeader = button("Сумма");
    click(amountHeader);
    await wait(
      () =>
        document
          .querySelector("tbody tr td:nth-child(4)")
          .textContent.startsWith("-125"),
      "sort amount ascending",
    );
    click(amountHeader);
    await wait(
      () =>
        document
          .querySelector("tbody tr td:nth-child(4)")
          .textContent.replace(/\s/g, "")
          .startsWith("1000"),
      "sort amount descending",
    );
    check(
      document.documentElement.scrollWidth <= innerWidth + 2,
      "wide table scrolls inside its container",
    );
    click(button("Обзор"));
    await wait(
      () => document.querySelector(".chart-scroll"),
      "back to overview",
    );
    check(
      document.querySelector(".pie-layout").querySelector(".pie-empty") &&
        !document.querySelector(".pie-layout").querySelector("svg"),
      "zero expenses have an empty chart",
    );
    click(button("Добавить выписки"));
    await wait(() => document.querySelector("dialog[open]"), "import result");
    check(
      window.testSaves.at(-1).operations.length === 6,
      "worker XLSX import: " +
        document.querySelector("dialog[open]").textContent,
    );
    check(
      window.testSaves.at(-1).imports.at(-1).filename === "Выписка Альфа.xlsx",
      "iOS file URL keeps the readable statement name",
    );
    click(button("Готово", document.querySelector("dialog[open]")));
    await wait(
      () => !document.querySelector("dialog[open]"),
      "close XLSX result",
    );
    window.testFile = window.testPDF;
    window.testFilename = "file:///private/%D0%A2-%D0%91%D0%B0%D0%BD%D0%BA.pdf";
    click(button("Добавить выписки"));
    await wait(
      () => document.querySelector("dialog[open]"),
      "PDF import result",
    );
    check(
      window.testSaves.at(-1).operations.length === 7,
      "worker PDF import: " +
        document.querySelector("dialog[open]").textContent,
    );
    check(
      window.testSaves.at(-1).operations.at(-1).amount === -92500,
      "PDF uses card currency amount",
    );
    click(button("Готово", document.querySelector("dialog[open]")));
    await wait(
      () => !document.querySelector("dialog[open]"),
      "close PDF result",
    );
    const slices = [
      ...document
        .querySelector(".pie-layout")
        .querySelectorAll(".pie-slice > path"),
    ];
    check(
      slices.length >= 2 &&
        slices.every((p) => !/NaN|Infinity/.test(p.getAttribute("d"))),
      "multiple categories render finite pie sectors",
    );
    const slice = slices[0].parentElement;
    slice.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await wait(
      () => document.querySelector("dialog[open]"),
      "keyboard sector selection",
    );
    check(
      document.querySelector("dialog tbody tr"),
      "sector opens its operations",
    );
    click(button("Готово", document.querySelector("dialog[open]")));
    await wait(
      () => !document.querySelector("dialog[open]"),
      "close sector drilldown",
    );
    check(
      document.documentElement.scrollWidth <= innerWidth + 2,
      "imported descriptions do not overflow the page",
    );
    const chart = document.querySelector(".chart-scroll");
    await wait(
      () =>
        Number(chart.querySelector("svg").getAttribute("width")) >=
        chart.clientWidth,
      "line chart fills the available width",
    );
    const beforeSettings = window.testSaves.at(-1);
    const settingsFile = {
      format: "finance-computer-settings",
      version: 1,
      descriptionRules: [
        {
          id: "settings-rule",
          description: "Оплата в CAFE",
          alternateDescriptions: ["Оплата в CAFE Вторая строка"],
          debit: true,
          category: "Кофе",
          kind: "Расход",
        },
      ],
      phoneNames: { "phone|79991111111": "Анна" },
      transferOwners: { "phone|79992222222": true },
      otherPhonesArePeople: true,
    };
    window.testFilename = "settings.json";
    window.testFile = new TextEncoder().encode(JSON.stringify(settingsFile));
    click(button("Импорт"));
    await wait(() => button("Импортировать настройки"), "settings actions");
    click(button("Импортировать настройки"));
    await wait(
      () => document.querySelector(".settings-summary"),
      "settings preview",
    );
    check(window.testSaves.length === 3, "preview does not modify the ledger");
    check(
      document.querySelector(".settings-import select").value === "current",
      "current settings win by default",
    );
    click(button("Отмена", document.querySelector("dialog[open]")));
    await wait(
      () => !document.querySelector("dialog[open]"),
      "cancel settings",
    );
    check(
      window.testSaves.length === 3,
      "cancelling settings leaves the ledger intact",
    );
    click(button("Импортировать настройки"));
    await wait(
      () => document.querySelector(".settings-summary"),
      "settings preview again",
    );
    click(button("Применить настройки"));
    await wait(
      () =>
        window.testSaves.length === 4 &&
        !document.querySelector("dialog[open]"),
      "settings applied",
    );
    const imported = window.testSaves.at(-1);
    check(
      imported.descriptionRules.length === 1 &&
        imported.phoneNames["phone|79991111111"] === "Анна",
      "rules and names imported",
    );
    check(
      imported.operations[0].kind === "Не учитывать" &&
        imported.operations[0].manualKind,
      "settings respect manual operation type",
    );
    check(
      JSON.stringify(imported.operations.map((o) => [o.id, o.amount])) ===
        JSON.stringify(
          beforeSettings.operations.map((o) => [o.id, o.amount]),
        ) &&
        JSON.stringify(imported.imports) ===
          JSON.stringify(beforeSettings.imports),
      "settings preserve transactions and import history",
    );
    check(
      window.testBackups.at(-1) === true,
      "settings save requests a backup",
    );
    click(button("Экспортировать настройки"));
    await wait(
      () =>
        window.testExports.length === 1 &&
        document.querySelector("dialog[open]"),
      "settings exported",
    );
    const exported = window.testExports[0];
    check(
      exported.format === "finance-computer-settings" &&
        !exported.operations &&
        !exported.imports,
      "settings export contains no transactions",
    );
    check(
      exported.phoneNames["phone|79991111111"] === "Анна" &&
        exported.descriptionRules[0].alternateDescriptions.length === 1,
      "settings export keeps names and aliases",
    );
    click(button("Готово", document.querySelector("dialog[open]")));
    await wait(
      () => !document.querySelector("dialog[open]"),
      "close export confirmation",
    );
    settingsFile.phoneNames["phone|79991111111"] = "Аня";
    window.testFile = new TextEncoder().encode(JSON.stringify(settingsFile));
    click(button("Импортировать настройки"));
    await wait(
      () => document.querySelector(".settings-summary"),
      "conflicting settings preview",
    );
    const preference = document.querySelector(".settings-import select");
    preference.value = "file";
    preference.dispatchEvent(new Event("change", { bubbles: true }));
    click(button("Применить настройки"));
    await wait(
      () =>
        window.testSaves.length === 5 &&
        !document.querySelector("dialog[open]"),
      "file preference applied",
    );
    check(
      window.testSaves.at(-1).phoneNames["phone|79991111111"] === "Аня" &&
        window.testSaves.at(-1).descriptionRules.length === 1,
      "file preference updates matching settings without duplicates",
    );
    click(button("Импортировать настройки"));
    await wait(
      () => document.querySelector(".settings-summary"),
      "final settings preview",
    );
    check(
      document.documentElement.scrollWidth <= innerWidth + 2,
      "settings preview fits the screen",
    );
    escape(button("Готово", document.querySelector("dialog[open]")));
    await wait(
      () => !document.querySelector("dialog[open]"),
      "Escape closes settings preview",
    );
    click(button("Операции"));
    await wait(
      () => document.querySelector(".operation-open"),
      "operations for quick edit",
    );
    click(document.querySelector(".operation-open"));
    await wait(
      () => document.querySelector("dialog[open] .editor"),
      "quick operation editor",
    );
    const operationEditor = document.querySelector("dialog[open]");
    const fields = operationEditor.querySelectorAll("select");
    check(
      fields.length === 2 && !operationEditor.querySelector("input[list]"),
      "one simple selector per category and type",
    );
    let saves = window.testSaves.length;
    fields[1].value = "Продукты";
    fields[1].dispatchEvent(new Event("change", { bubbles: true }));
    await wait(
      () => window.testSaves.length === saves + 1,
      "category saves on selection without blur",
    );
    check(
      window.testSaves
        .at(-1)
        .operations.some((o) => o.category === "Продукты" && o.manualCategory),
      "category choice is an individual override",
    );
    await new Promise(requestAnimationFrame);
    await wait(() => !fields[0].disabled, "category save finished");
    saves = window.testSaves.length;
    fields[0].value = "Откладывание на счета";
    fields[0].dispatchEvent(new Event("change", { bubbles: true }));
    await wait(
      () => window.testSaves.length === saves + 1,
      "type saves on selection",
    );
    check(
      window.testSaves
        .at(-1)
        .operations.some(
          (o) =>
            o.kind === "Откладывание на счета" &&
            o.manualKind &&
            o.category === "Продукты",
        ),
      "type and category both persist",
    );
    await new Promise(requestAnimationFrame);
    await wait(() => !fields[0].disabled, "type save finished");
    operationEditor.dispatchEvent(new Event("cancel", { cancelable: true }));
    await wait(
      () => !document.querySelector("dialog[open]"),
      "native cancel also closes editor",
    );
    click(button("Группы и пресет"));
    await wait(
      () => document.querySelector(".group-row"),
      "groups for quick edit",
    );
    click(button("Категория и тип"));
    await wait(
      () => document.querySelector("dialog[open] .editor"),
      "quick preset editor",
    );
    const presetEditor = document.querySelector("dialog[open]");
    check(
      !presetEditor.querySelector("details"),
      "preset uses one flat editor",
    );
    const applyPreset = button("Применить пресет", presetEditor);
    check(
      applyPreset.getBoundingClientRect().bottom < innerHeight,
      "apply preset is visible on opening",
    );
    const presetType = presetEditor.querySelector(
      ".rule-choices > label > select",
    );
    const categorySearch = presetEditor.querySelector(
      'input[aria-label="Найти категорию"]',
    );
    const categoryOptions = presetEditor.querySelector(".category-options");
    const categoryChoices = () => [
      ...categoryOptions.querySelectorAll('input[type="radio"]'),
    ];
    const searchCategories = (value) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(categorySearch, value);
      categorySearch.dispatchEvent(new Event("input", { bubbles: true }));
    };
    check(
      !presetEditor.querySelector(".rule-category select"),
      "category does not open a system menu",
    );
    check(
      categoryOptions.clientHeight <= 180 &&
        categoryOptions.scrollHeight > categoryOptions.clientHeight,
      "category list has a bounded scroll area",
    );
    saves = window.testSaves.length;
    searchCategories("несуществующая категория");
    await wait(
      () => categoryChoices().length === 0,
      "empty category search result",
    );
    check(
      categoryOptions.querySelector('[role="status"]') &&
        window.testSaves.length === saves,
      "search does not change the preset",
    );
    searchCategories("жИЛЬЕ");
    await wait(
      () =>
        categoryChoices().length === 1 &&
        categoryChoices()[0].value === "Жильё и ЖКХ",
      "category search ignores case and ё",
    );
    searchCategories("  зДОРОВЬЕ  ");
    await wait(
      () =>
        categoryChoices().length === 1 &&
        categoryChoices()[0].value === "Здоровье",
      "category search finds a choice",
    );
    click(categoryChoices()[0]);
    await wait(
      () => window.testSaves.length === saves + 1,
      "preset category saves immediately",
    );
    check(
      window.testSaves
        .at(-1)
        .descriptionRules.some((r) => r.category === "Здоровье"),
      "preset category persisted",
    );
    await new Promise(requestAnimationFrame);
    await wait(() => !presetType.disabled, "preset save finished");
    check(
      presetEditor.querySelector(".category-current").textContent ===
        "Здоровье" && categoryChoices()[0].checked,
      "selected category remains visible and marked",
    );
    searchCategories("");
    await wait(
      () =>
        categoryChoices().some((choice) => choice.value === "Без категории"),
      "clearing search restores all categories",
    );
    check(
      presetEditor.isConnected,
      "preset is connected before composition Escape",
    );
    check(
      new KeyboardEvent("keydown", { key: "Escape", isComposing: true })
        .isComposing,
      "test host supports composing KeyboardEvent",
    );
    escape(presetType, { isComposing: true });
    await new Promise((r) => setTimeout(r, 50));
    check(
      presetEditor.open && presetEditor.isConnected,
      "Escape during text composition is not intercepted",
    );
    const typeFilter = presetEditor.querySelector(
      'select[aria-label="Тип операций группы"]',
    );
    const groupRows = () => [
      ...presetEditor.querySelectorAll(".rule-operations tbody tr"),
    ];
    const allCount = groupRows().length;
    check(allCount > 0, "group editor shows its operations");
    const expectedCounts = [...typeFilter.options].slice(1).map((option) => ({
      type: option.value,
      count: Number(option.textContent.match(/\((\d+)\)/)[1]),
    }));
    check(
      expectedCounts.reduce((sum, item) => sum + item.count, 0) === allCount,
      "type counts cover the whole group",
    );
    for (const { type, count } of expectedCounts) {
      typeFilter.value = type;
      typeFilter.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(
        () =>
          groupRows().length === count &&
          groupRows().every(
            (row) =>
              row.querySelector('[data-label="Тип"]').textContent === type,
          ),
        "filter group by " + type,
      );
    }
    typeFilter.value = "";
    typeFilter.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(
      () => groupRows().length === allCount,
      "all group types restored",
    );
    click(presetEditor.querySelector(".rule-operations .operation-open"));
    await wait(
      () => document.querySelectorAll("dialog[open]").length === 2,
      "operation opens inside preset editor",
    );
    const childEditor = [...document.querySelectorAll("dialog[open]")].at(-1);
    const childType = childEditor.querySelector("select");
    const chosenType =
      childType.value === "Не учитывать" ? "Расход" : "Не учитывать";
    saves = window.testSaves.length;
    childType.value = chosenType;
    childType.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(
      () => window.testSaves.length === saves + 1,
      "individual correction from preset list saves",
    );
    await new Promise(requestAnimationFrame);
    await wait(() => !childType.disabled, "individual correction finished");
    const beforeApply = window.testSaves.at(-1);
    const individualIDs = beforeApply.operations
      .filter((o) => o.manualKind && o.kind === chosenType)
      .map((o) => o.id);
    check(individualIDs.length > 0, "correction is stored as an exception");
    escape(button("Готово", childEditor));
    await wait(
      () => document.querySelectorAll("dialog[open]").length === 1,
      "Escape returns to preset operations",
    );
    typeFilter.value = chosenType;
    typeFilter.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(
      () =>
        groupRows().length > 0 &&
        groupRows().every(
          (row) =>
            row.querySelector('[data-label="Тип"]').textContent === chosenType,
        ),
      "type filter reflects an individual correction",
    );
    saves = window.testSaves.length;
    click(applyPreset);
    await wait(
      () => window.testSaves.length === saves + 1,
      "visible apply button works",
    );
    await new Promise(requestAnimationFrame);
    await wait(
      () => !categorySearch.matches(":disabled"),
      "explicit preset save finished",
    );
    check(
      individualIDs.every(
        (id) =>
          window.testSaves.at(-1).operations.find((o) => o.id === id).kind ===
          chosenType,
      ),
      "applying preset preserves individual types",
    );
    const groupTitle =
      presetEditor.querySelector(".rule-editor > p").textContent;
    escape(button("Готово", presetEditor));
    await wait(
      () => !document.querySelector("dialog[open]"),
      "Escape closes preset editor",
    );
    click(button("Пресет"));
    await wait(
      () =>
        [...document.querySelectorAll(".group-row")].some(
          (row) => row.querySelector("h3").textContent === groupTitle,
        ),
      "saved preset listed",
    );
    const savedRow = [...document.querySelectorAll(".group-row")].find(
      (row) => row.querySelector("h3").textContent === groupTitle,
    );
    click(button("Редактировать", savedRow));
    await wait(
      () => document.querySelector("dialog[open] .rule-operations"),
      "preset opens with its operations too",
    );
    check(
      document.querySelectorAll("dialog[open] .rule-operations tbody tr")
        .length === allCount,
      "group and preset have the same operations",
    );
    check(
      document.documentElement.scrollWidth <= innerWidth + 2,
      "preset editor fits the screen",
    );
    escape(button("Готово", document.querySelector("dialog[open]")));
    await wait(
      () => !document.querySelector("dialog[open]"),
      "close preset before merge",
    );
    click(button("Группы операций"));
    await wait(
      () => document.querySelector(".group-row .toolbar"),
      "groups to merge",
    );
    const sourceRow = [...document.querySelectorAll(".group-row")].find(
      (row) => row.querySelector("h3").textContent === "Накопления",
    );
    click(button("Объединить", sourceRow));
    await wait(
      () =>
        document.querySelector(
          'input[aria-label="Поиск группы для объединения"]',
        ),
      "merge search opens",
    );
    const mergeDialog = document.querySelector("dialog[open]");
    const mergeSearch = mergeDialog.querySelector("input");
    const mergeTarget = mergeDialog.querySelector("select");
    const mergeButton = button("Объединить", mergeDialog);
    const searchMerge = (value) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(mergeSearch, value);
      mergeSearch.dispatchEvent(new Event("input", { bubbles: true }));
    };
    check(
      ![...mergeTarget.options].some((o) =>
        /Зарплата|Накопления/.test(o.textContent),
      ),
      "merge excludes the source and opposite direction",
    );
    saves = window.testSaves.length;
    searchMerge("  зДОРОВЬЕ  ");
    await wait(
      () =>
        mergeTarget.options.length === 2 &&
        mergeTarget.options[1].textContent === groupTitle,
      "merge searches by preset category",
    );
    searchMerge("ВТОРАЯ строка");
    await wait(
      () =>
        mergeTarget.options.length === 2 &&
        mergeTarget.options[1].textContent === groupTitle,
      "merge searches alternative descriptions",
    );
    mergeTarget.value = mergeTarget.options[1].value;
    mergeTarget.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(
      () => !mergeButton.disabled,
      "explicit merge selection enables action",
    );
    searchMerge("несуществующая группа");
    await wait(
      () =>
        mergeTarget.options.length === 1 &&
        mergeButton.disabled &&
        !mergeTarget.value,
      "new query clears hidden selection",
    );
    check(
      mergeDialog
        .querySelector('[role="status"]')
        .textContent.includes("не найдено"),
      "empty merge result is explained",
    );
    check(
      window.testSaves.length === saves,
      "search and selection do not save data",
    );
    searchMerge("cafe");
    await wait(
      () => mergeTarget.options.length === 2,
      "description search restores target",
    );
    mergeTarget.value = mergeTarget.options[1].value;
    mergeTarget.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(() => !mergeButton.disabled, "merge ready");
    const beforeMerge = window.testSaves.at(-1);
    click(mergeButton);
    await wait(
      () =>
        window.testSaves.length === saves + 1 &&
        !document.querySelector("dialog[open]"),
      "selected groups merged",
    );
    const afterMerge = window.testSaves.at(-1);
    check(
      afterMerge.descriptionRules.some(
        (r) =>
          r.category === "Здоровье" &&
          r.alternateDescriptions.includes("Накопления") &&
          r.alternateDescriptions.includes("Оплата в CAFE Вторая строка"),
      ),
      "merge keeps target rule and existing aliases",
    );
    check(
      JSON.stringify(beforeMerge.operations.map((o) => [o.id, o.amount])) ===
        JSON.stringify(afterMerge.operations.map((o) => [o.id, o.amount])),
      "merge preserves operation identities and amounts",
    );
    check(
      beforeMerge.operations.every((before) => {
        const after = afterMerge.operations.find((o) => o.id === before.id);
        return (
          (!before.manualKind ||
            (after.manualKind && before.kind === after.kind)) &&
          (!before.manualCategory ||
            (after.manualCategory && before.category === after.category))
        );
      }),
      "merge preserves individual exceptions",
    );
    click(button("Объединить"));
    await wait(
      () =>
        document.querySelector(
          'input[aria-label="Поиск группы для объединения"]',
        ),
      "merge dialog opens again",
    );
    check(
      document.querySelector("dialog[open] input").value === "" &&
        document.querySelector("dialog[open] select").value === "",
      "new merge starts with a clean query and selection",
    );
    check(
      document.documentElement.scrollWidth <= innerWidth + 2,
      "merge search fits the screen",
    );
    window.webkit.messageHandlers.testResult.postMessage({
      ok: true,
      width: innerWidth,
      saves: window.testSaves.length,
      checks,
    });
  })().catch((e) =>
    window.webkit.messageHandlers.testResult.postMessage({
      ok: false,
      error: String(e),
    }),
  );
});
