import {
  useEffect,
  useMemo,
  useState,
  useRef,
  useId,
  type ReactNode,
} from "react";
import * as M from "../core/model";
import { decodeSettings } from "../core/codec";
import { applySettings, mergeSettings } from "../core/settings";
import {
  LedgerStore,
  ask,
  pickStatements,
  readStatement,
  parseInWorker,
  filenameFor,
  exportBackup,
  exportSettings,
  importBackup,
  inNativeApp,
} from "../io/platform";
import { Pie, LineChart } from "./Charts";
import { AutomaticRules } from "./AutomaticRules";
import { Categories } from "./Categories";
import { readBrowserBackup } from "../io/browser";
import { PwaStatus } from "./PwaStatus";
type Change = (edit: (l: M.Ledger) => void, backup?: boolean) => Promise<void>;
const tabs = [
  "Обзор",
  "Операции",
  "Люди",
  "Группы и пресет",
  "Импорт",
] as const;
type Tab = (typeof tabs)[number];
type Drill = {
  title: string;
  measure?: M.Measure;
  category?: string;
  period?: string;
  phoneIDs?: string[];
};
const sum = (ops: M.Operation[], measure: M.Measure) =>
  ops.reduce((s, o) => s + M.amountOf(o, measure), 0n);
function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat && !e.nativeEvent.isComposing) close();
      }}
      className="dialog"
      aria-label={title}
    >
      <header>
        <h2>{title}</h2>
        <button autoFocus onClick={close}>
          Готово
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function App({ store }: { store: LedgerStore }) {
  const [ledger, setLedger] = useState(store.ledger),
    [tab, setTab] = useState<Tab>("Обзор"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(store.error),
    [period, setPeriod] = useState("Все месяцы"),
    [from, setFrom] = useState(""),
    [through, setThrough] = useState(""),
    [bank, setBank] = useState("Все банки"),
    [currency, setCurrency] = useState("RUB"),
    [search, setSearch] = useState(""),
    [review, setReview] = useState(false),
    [category, setCategory] = useState(""),
    [drill, setDrill] = useState<Drill | null>(null),
    [owners, setOwners] = useState(false),
    [incomingSettings, setIncomingSettings] = useState<M.Settings | null>(null);
  const change: Change = async (edit, backup = false) => {
    setBusy(true);
    try {
      await store.change(edit, backup);
      setLedger(store.ledger);
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const run = (action: () => Promise<unknown>) => {
    void action().catch((e) => setError(String(e)));
  };
  const months = useMemo(
    () =>
      [...new Set(ledger.operations.map((o) => o.date.slice(0, 7)))]
        .sort()
        .reverse(),
    [ledger],
  );
  const banks = useMemo(
    () => [...new Set(ledger.operations.map((o) => o.bank))].sort(),
    [ledger],
  );
  const currencies = useMemo(
    () =>
      [...new Set(["RUB", ...ledger.operations.map((o) => o.currency)])].sort(),
    [ledger],
  );
  const filtered = useMemo(() => {
    const q = M.normalize(search);
    return ledger.operations
      .filter(
        (o) =>
          (period === "Все месяцы" ||
            (period === "Один день" && o.date === from) ||
            (period === "Диапазон дат" &&
              o.date >= from &&
              o.date <= through) ||
            o.date.startsWith(period)) &&
          (bank === "Все банки" || o.bank === bank) &&
          o.currency === currency &&
          (!q ||
            M.normalize(
              o.details +
                " " +
                o.category +
                " " +
                ((M.transferParty(o) &&
                  ledger.phoneNames?.[M.transferParty(o)!.id]) ||
                  ""),
            ).includes(q)),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [ledger, period, from, through, bank, currency, search]);
  const disabled = busy || store.readOnly;
  async function importFiles() {
    const paths = await pickStatements();
    if (!paths.length) return;
    setBusy(true);
    const messages: string[] = [];
    try {
      for (const path of paths) {
        try {
          const bytes = await readStatement(path);
          let filename = await filenameFor(path);
          if (!/\.(pdf|xlsx)$/i.test(filename))
            filename =
              "Выписка." +
              (new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"
                ? "pdf"
                : "xlsx");
          const parsed = await parseInWorker(bytes, filename);
          await store.change((l) =>
            M.append(l, parsed.result, filename, parsed.digest),
          );
          setLedger(store.ledger);
          messages.push(
            `${filename}: ${parsed.result.operations.length} операций`,
          );
        } catch (e) {
          messages.push(String(e));
        }
      }
    } finally {
      setBusy(false);
      setError(messages.join("\n"));
    }
  }
  async function loadBackup() {
    const source = await importBackup();
    if (source === undefined) return;
    if (
      !(await ask(
        "Заменить текущий разбор резервной копией? Перед заменой будет сохранена копия текущей базы.",
      ))
    )
      return;
    setBusy(true);
    try {
      await store.replace(source);
      setLedger(store.ledger);
      setDrill(null);
    } finally {
      setBusy(false);
    }
  }
  async function loadSettings() {
    setBusy(true);
    try {
      const source = await importBackup("Настройки или резервная копия");
      if (source !== undefined) setIncomingSettings(decodeSettings(source));
    } finally {
      setBusy(false);
    }
  }
  async function startOver() {
    if (
      await ask(
        "Начать новый разбор? Операции и история импорта будут очищены после резервного копирования. Пресеты, имена и свои номера сохранятся.",
      )
    ) {
      await change((l) => Object.assign(l, M.reset(l)), true);
      setPeriod("Все месяцы");
      setBank("Все банки");
      setSearch("");
      setReview(false);
      setDrill(null);
      if (inNativeApp()) await importFiles();
      else
        setError(
          "Разбор очищен. Нажми «Добавить выписки», чтобы выбрать новые файлы.",
        );
    }
  }
  useEffect(() => {
    setCategory((c) => (c ? M.categoryName(ledger, c) : c));
  }, [ledger.categoryRules]);
  const points = M.cashFlow(filtered, period === "Все месяцы", category),
    expenses = sum(filtered, "expenses"),
    income = sum(filtered, "income"),
    savings = sum(filtered, "savings"),
    pending = filtered.filter(M.needsReview).length;
  let drillOps = filtered;
  if (drill) {
    if (drill.phoneIDs) {
      const index = M.transferIndex(filtered);
      drillOps = drill.phoneIDs.flatMap((id) => index.get(id) ?? []);
    } else
      drillOps = filtered.filter(
        (o) =>
          (!drill.period || o.date.startsWith(drill.period)) &&
          M.amountOf(o, drill.measure!) !== 0n &&
          (!drill.category ||
            (drill.measure === "income"
              ? M.normalize(M.incomeSource(o, ledger.phoneNames)) ===
                M.normalize(drill.category)
              : o.category === drill.category)),
      );
  }
  return (
    <div className="app">
      <header className="app-header">
        <div className="topbar">
          <div className="brand">
            <svg className="brand-icon" viewBox="0 0 32 32" aria-hidden="true">
              <circle cx="16" cy="16" r="14" fill="currentColor" />
              <path
                d="M16 2V16L28 9M16 16L25 27"
                fill="none"
                stroke="var(--card)"
                strokeWidth="1.5"
              />
            </svg>
            <div>
              <h1>Мои финансы</h1>
              <small>Офлайн · данные на этом устройстве</small>
            </div>
          </div>
          {busy && (
            <span role="status" className="muted">
              Обрабатываю…
            </span>
          )}
          <button
            className="primary"
            disabled={disabled}
            onClick={() => run(importFiles)}
          >
            ＋ Добавить выписки
          </button>
        </div>
        <div className="navigation-row">
          <span className="navigation-label">Раздел</span>
          <nav className="segmented" aria-label="Разделы">
            {tabs.map((t) => (
              <button
                key={t}
                aria-current={tab === t ? "page" : undefined}
                className={tab === t ? "active" : ""}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          <div className="toolbar app-actions">
            <button disabled={disabled} onClick={() => setOwners(true)}>
              Чьи переводы?
            </button>
            <button
              disabled={disabled}
              onClick={() => run(() => exportBackup(ledger))}
            >
              Сохранить копию
            </button>
            <button disabled={busy} onClick={() => run(loadBackup)}>
              Загрузить копию
            </button>
            <button disabled={disabled} onClick={() => run(startOver)}>
              Начать заново
            </button>
          </div>
        </div>
      </header>
      <main>
        {!inNativeApp() && <PwaStatus />}
        {store.readOnly && (
          <p className="notice danger">
            База доступна только для чтения. Исходный файл не перезаписан.
          </p>
        )}
        {tab !== "Импорт" && tab !== "Группы и пресет" && (
          <section className="filters">
            <label>
              Период
              <select
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  if (!from) {
                    const last =
                      ledger.operations
                        .map((o) => o.date)
                        .sort()
                        .at(-1) ?? new Date().toISOString().slice(0, 10);
                    setFrom(last);
                    setThrough(last);
                  }
                }}
              >
                {["Все месяцы", ...months, "Один день", "Диапазон дат"].map(
                  (p) => (
                    <option key={p}>{p}</option>
                  ),
                )}
              </select>
            </label>
            {["Один день", "Диапазон дат"].includes(period) && (
              <label>
                С
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
            )}
            {period === "Диапазон дат" && (
              <label>
                По
                <input
                  type="date"
                  value={through}
                  onChange={(e) => setThrough(e.target.value)}
                />
              </label>
            )}
            <label>
              Банк
              <select value={bank} onChange={(e) => setBank(e.target.value)}>
                {["Все банки", ...banks].map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
            <label className="currency">
              Валюта
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="search">
              <span className="sr-only">Поиск</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Магазин, категория или человек"
              />
            </label>
            {tab === "Операции" && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={review}
                  onChange={(e) => setReview(e.target.checked)}
                />
                На разбор
              </label>
            )}
          </section>
        )}
        {!ledger.operations.length && tab === "Обзор" ? (
          <section className="card empty">
            <span>⇩</span>
            <h2>Все финансы в одном месте</h2>
            <p>
              Добавь PDF Т‑Банка, Альфы, Пэя или Сбербанка, XLSX Альфы или загрузи
              резервную копию нынешнего Mac-приложения.
            </p>
            <button
              className="primary"
              disabled={disabled}
              onClick={() => run(importFiles)}
            >
              Выбрать выписки
            </button>
          </section>
        ) : (
          tab === "Обзор" && (
            <>
              <section className="metrics">
                {[
                  ["Расходы", expenses, "Спорные списания включены"],
                  ["Пополнения", income, "Доходы и возвраты"],
                  ["На накопления", savings, "Исходящие переводы на счета"],
                  ["Нужно проверить", pending, "Категории и возможные дубли"],
                ].map(([title, value, note]) => (
                  <div className="card metric" key={String(title)}>
                    <p>{title}</p>
                    <strong>
                      {typeof value === "bigint"
                        ? M.formatMoney(value, currency)
                        : String(value)}
                    </strong>
                    <small>{note}</small>
                  </div>
                ))}
              </section>
              {pending > 0 && (
                <div className="notice">
                  Итоги предварительные: {pending} операций требуют проверки.{" "}
                  <button
                    onClick={() => {
                      setReview(true);
                      setTab("Операции");
                    }}
                  >
                    Разобрать
                  </button>
                </div>
              )}
              {(["expenses", "income"] as const).map((measure) => (
                <section className="card" key={measure}>
                  <h2>
                    {measure === "expenses"
                      ? "Расходы по категориям"
                      : "Откуда приходят деньги"}
                  </h2>
                  <p className="muted pie-summary">
                    {measure === "expenses"
                      ? `Без категории: ${M.formatMoney(
                          filtered
                            .filter((o) => o.category === "Без категории")
                            .reduce((sum, o) => sum + M.expenseAmount(o), 0n),
                          currency,
                        )} · включены в общий итог`
                      : `Доходы за выбранный период: ${M.formatMoney(income, currency)}`}
                  </p>
                  <Pie
                    groups={M.breakdown(filtered, measure, ledger.phoneNames)}
                    currency={currency}
                    onSelect={(label) =>
                      setDrill({ title: label, measure, category: label })
                    }
                  />
                  <p className="muted small chart-hint">
                    {measure === "expenses"
                      ? "Нажми на сектор или категорию справа, чтобы увидеть расходные операции. Возвраты показаны в поступлениях."
                      : "Доходы, возвраты и переводы от других людей. Нажми на сектор или источник, чтобы открыть операции."}
                  </p>
                </section>
              ))}
              {(["expenses", "income", "savings"] as const).map(
                (measure, i) => (
                  <section className="card" key={measure}>
                    <h2>
                      {["Расходы", "Поступления", "На накопления"][i]} по{" "}
                      {period === "Все месяцы" ? "месяцам" : "дням"}
                    </h2>
                    {measure === "expenses" && (
                      <label>
                        Категория
                        <select
                          value={category}
                          onChange={(e) => setCategory(e.target.value)}
                        >
                          <option value="">Все категории</option>
                          {[
                            ...new Set(
                              filtered
                                .filter((o) => M.expenseAmount(o) !== 0n)
                                .map((o) => o.category),
                            ),
                          ]
                            .sort()
                            .map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                        </select>
                      </label>
                    )}
                    <LineChart
                      points={points.map((p) => ({
                        label: p.period,
                        amount: p[measure],
                      }))}
                      currency={currency}
                      monthly={period === "Все месяцы"}
                      color={["#008aff", "#00bccc", "#cb2cde"][i]}
                      onSelect={(p) =>
                        setDrill({
                          title: `${["Расходы", "Поступления", "На накопления"][i]} за ${p}`,
                          measure,
                          period: p,
                          category:
                            measure === "expenses" ? category : undefined,
                        })
                      }
                    />
                    {measure === "savings" && (
                      <p className="muted small">
                        Исходящие операции с типом «Откладывание на счета». Это
                        сумма переводов за период, не баланс счёта.
                      </p>
                    )}
                  </section>
                ),
              )}
              <section className="card">
                <h2>Где трачу больше всего</h2>
                {(() => {
                  const sums = new Map<string, bigint>();
                  for (const o of filtered) {
                    const value = M.expenseAmount(o);
                    if (value) {
                      const key = M.recipient(ledger, o) ?? M.merchantName(o);
                      sums.set(key, (sums.get(key) ?? 0n) + value);
                    }
                  }
                  return [...sums]
                    .sort((a, b) => (a[1] > b[1] ? -1 : 1))
                    .slice(0, 10)
                    .map(([label, value]) => (
                      <div className="stat-row" key={label}>
                        <span>{label}</span>
                        <strong>{M.formatMoney(value, currency)}</strong>
                      </div>
                    ));
                })()}
              </section>
              <p className="muted small">
                Показано {filtered.length} операций · фильтры действуют на все
                показатели · валюты считаются отдельно
              </p>
            </>
          )
        )}
        {tab === "Операции" && (
          <Operations
            operations={filtered.filter((o) => !review || M.needsReview(o))}
            ledger={ledger}
            change={change}
            disabled={disabled}
          />
        )}
        {tab === "Люди" && (
          <People
            ledger={ledger}
            operations={filtered}
            currency={currency}
            search={search}
            change={change}
            disabled={disabled}
            open={(c) => setDrill({ title: c.name, phoneIDs: c.phoneIDs })}
          />
        )}
        {tab === "Группы и пресет" && (
          <Rules ledger={ledger} change={change} disabled={disabled} />
        )}
        {tab === "Импорт" && (
          <>
            {!inNativeApp() && (
              <section className="card">
                <h2>Последняя автоматическая копия</h2>
                <p>
                  Сохраняется на этом устройстве перед очисткой, загрузкой копии
                  и импортом настроек. Следующая такая операция заменяет её.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const source = await readBrowserBackup();
                      if (source === null) {
                        setError("Автоматической копии пока нет");
                        return;
                      }
                      if (
                        !(await ask(
                          "Восстановить последнюю автоматическую копию? Текущий разбор займёт её место.",
                        ))
                      )
                        return;
                      setBusy(true);
                      try {
                        await store.replace(source);
                        setLedger(store.ledger);
                        setDrill(null);
                      } finally {
                        setBusy(false);
                      }
                    })
                  }
                >
                  Восстановить автоматическую копию
                </button>
              </section>
            )}
            <section className="card">
              <h2>Перенос настроек между устройствами</h2>
              <p>
                Пресеты категорий и типов, объединённые группы, имена людей,
                свои номера и принадлежность реквизитов. Без операций и истории
                выписок.
              </p>
              <p className="muted small">
                Сейчас пресетов: {ledger.descriptionRules?.length ?? 0} ·
                номеров с именами: {Object.keys(ledger.phoneNames ?? {}).length}{" "}
                · своих номеров: {M.ownPhoneIDs(ledger).length}
              </p>
              <div className="toolbar">
                <button
                  disabled={disabled}
                  onClick={() =>
                    run(async () => {
                      if (await exportSettings(ledger))
                        setError(
                          inNativeApp()
                            ? "Настройки сохранены. Перенеси файл на другое устройство и выбери «Импортировать настройки»."
                            : "Файл настроек передан для сохранения. Сохрани его в «Файлы», затем на другом устройстве выбери «Импортировать настройки».",
                        );
                    })
                  }
                >
                  Экспортировать настройки
                </button>
                <button disabled={disabled} onClick={() => run(loadSettings)}>
                  Импортировать настройки
                </button>
              </div>
              <p className="muted small">
                Можно выбрать файл настроек или полную резервную копию, в том
                числе из прежнего Mac-приложения. Перед применением появится
                предварительный просмотр. Для переноса всего разбора вместе с
                операциями используй «Сохранить копию» и «Загрузить копию»
                сверху.
              </p>
            </section>
            <section className="card">
              <h2>История импорта</h2>
              {!ledger.imports.length && (
                <p className="muted">Выписки пока не добавлены</p>
              )}
              {[...ledger.imports].reverse().map((i) => (
                <article className="import-record" key={i.id}>
                  <strong>{i.filename}</strong>
                  <span>
                    {i.count} операций ·{" "}
                    {new Date((i.importedAt + 978307200) * 1000).toLocaleString(
                      "ru-RU",
                    )}
                  </span>
                  {i.warnings.length ? (
                    i.warnings.map((w, j) => (
                      <p className="notice" key={j}>
                        {w}
                      </p>
                    ))
                  ) : (
                    <p className="muted">Контрольные итоги банка совпали</p>
                  )}
                </article>
              ))}
            </section>
          </>
        )}
      </main>
      {incomingSettings && (
        <Dialog title="Импорт настроек" close={() => setIncomingSettings(null)}>
          <SettingsImport
            incoming={incomingSettings}
            ledger={ledger}
            disabled={disabled}
            change={change}
            close={() => setIncomingSettings(null)}
          />
        </Dialog>
      )}
      {owners && (
        <Dialog
          title="Получатели и отправители переводов"
          close={() => setOwners(false)}
        >
          <Owners ledger={ledger} change={change} disabled={disabled} />
        </Dialog>
      )}
      {drill && (
        <Dialog title={drill.title} close={() => setDrill(null)}>
          {drill.phoneIDs ? (
            <p>
              Отправлено:{" "}
              {M.formatMoney(
                drillOps
                  .filter((o) => o.amount < 0n)
                  .reduce((s, o) => s - o.amount, 0n),
                currency,
              )}{" "}
              · Получено:{" "}
              {M.formatMoney(
                drillOps
                  .filter((o) => o.amount > 0n)
                  .reduce((s, o) => s + o.amount, 0n),
                currency,
              )}
            </p>
          ) : (
            <p>
              Итого: {M.formatMoney(sum(drillOps, drill.measure!), currency)}
            </p>
          )}
          <p className="muted small">Сохранены фильтры обзора</p>
          <Operations
            operations={drillOps}
            ledger={ledger}
            change={change}
            disabled={disabled}
          />
        </Dialog>
      )}
      {error && (
        <Dialog title="Мои финансы" close={() => setError("")}>
          <p className="message" role="alert">
            {error}
          </p>
        </Dialog>
      )}
    </div>
  );
}
function SettingsImport({
  incoming,
  ledger,
  disabled,
  change,
  close,
}: {
  incoming: M.Settings;
  ledger: M.Ledger;
  disabled: boolean;
  change: Change;
  close: () => void;
}) {
  const [preferFile, setPreferFile] = useState(false);
  const { settings, overlaps } = useMemo(
    () => mergeSettings(ledger, incoming, preferFile),
    [ledger, incoming, preferFile],
  );
  const count = (values: object) => Object.keys(values).length;
  return (
    <div className="settings-import">
      <p>
        Новые настройки добавятся к текущим. Выбери, какие значения использовать
        при совпадениях.
      </p>
      <label>
        Если настройка уже есть
        <select
          value={preferFile ? "file" : "current"}
          onChange={(e) => setPreferFile(e.target.value === "file")}
          disabled={disabled}
        >
          <option value="current">Сохранить текущие настройки</option>
          <option value="file">Использовать настройки из файла</option>
        </select>
      </label>
      <p className="muted small">
        При совпадении хотя бы одного описания пресет берётся целиком из
        выбранного источника, вместе с вариантами группы. Остальные пресеты и
        номера сохраняются. Это же правило действует для настройки «Все
        остальные номера — другие люди».
      </p>
      <div className="table-wrap">
        <table className="settings-summary">
          <thead>
            <tr>
              <th>Настройки</th>
              <th>В файле</th>
              <th>Совпадений</th>
              <th>Итог</th>
            </tr>
          </thead>
          <tbody>
            {[
              [
                "Пресеты",
                incoming.descriptionRules.length,
                overlaps.rules,
                settings.descriptionRules.length,
              ],
              [
                "Правила MCC",
                count(incoming.mccCategories),
                overlaps.mcc,
                count(settings.mccCategories),
              ],
              [
                "Изменения категорий",
                count(incoming.categoryRules),
                overlaps.categories,
                count(settings.categoryRules),
              ],
              [
                "Номера с именами",
                count(incoming.phoneNames),
                overlaps.names,
                count(settings.phoneNames),
              ],
              [
                "Правила номеров и счетов",
                count(incoming.transferOwners),
                overlaps.owners,
                count(settings.transferOwners),
              ],
            ].map(([name, ...values]) => (
              <tr key={name}>
                <td>{name}</td>
                {values.map((n, i) => (
                  <td key={i}>{n}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        После импорта своих номеров:{" "}
        {M.ownPhoneIDs({ ...ledger, ...settings }).length}. Все остальные номера
        — другие люди: {settings.otherPhonesArePeople ? "да" : "нет"}.
      </p>
      <p className="muted">
        Правила применятся к существующим и будущим операциям. Индивидуальные
        исправления сохранят приоритет; переименования и удаления категорий
        распространяются и на них. Операции и история импорта останутся на
        месте. Перед сохранением будет создана резервная копия базы.
      </p>
      <div className="toolbar">
        <button
          className="primary"
          disabled={disabled}
          onClick={() => {
            void change((l) => applySettings(l, incoming, preferFile), true)
              .then(close)
              .catch(() => {});
          }}
        >
          Применить настройки
        </button>
        <button disabled={disabled} onClick={close}>
          Отмена
        </button>
      </div>
    </div>
  );
}
export function Operations({
  operations,
  ledger,
  change,
  disabled,
}: {
  operations: M.Operation[];
  ledger: M.Ledger;
  change: Change;
  disabled: boolean;
}) {
  const [sort, setSort] = useState<keyof M.Operation>("date"),
    [reverse, setReverse] = useState(true),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<string | null>(null),
    [direction, setDirection] = useState("Все операции");
  const items = useMemo(
    () =>
      operations
        .filter(
          (o) =>
            direction === "Все операции" ||
            (direction === "Списания" ? o.amount < 0n : o.amount > 0n),
        )
        .sort((a, b) => {
          const x = a[sort],
            y = b[sort];
          return (x === y ? 0 : x! < y! ? -1 : 1) * (reverse ? -1 : 1);
        }),
    [operations, sort, reverse, direction],
  );
  useEffect(() => setPage(0), [operations, direction]);
  const chosen = ledger.operations.find((o) => o.id === selected),
    last = Math.max(0, Math.ceil(items.length / 50) - 1),
    current = Math.min(page, last);
  return (
    <section className="operations">
      <div className="table-tools">
        <span className="muted">
          {items.length} операций. Нажми заголовок для сортировки, строку — для
          исправления.
        </span>
        <select
          aria-label="Направление"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
        >
          {["Все операции", "Списания", "Поступления"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {(
                [
                  ["date", "Дата"],
                  ["bank", "Банк"],
                  ["details", "Описание"],
                  ["amount", "Сумма"],
                  ["category", "Категория"],
                  ["kind", "Тип"],
                ] as const
              ).map(([key, label]) => (
                <th key={key}>
                  <button
                    onClick={() => {
                      if (sort === key) setReverse(!reverse);
                      else {
                        setSort(key);
                        setReverse(false);
                      }
                    }}
                  >
                    {label}
                    {sort === key ? (reverse ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.slice(current * 50, current * 50 + 50).map((o) => (
              <tr key={o.id} onClick={() => setSelected(o.id)}>
                <td data-label="Дата">{o.date}</td>
                <td data-label="Банк">{o.bank}</td>
                <td className="description">
                  <button
                    className="link operation-open"
                    onClick={() => setSelected(o.id)}
                  >
                    {M.recipient(ledger, o) ? (
                      <>
                        <strong>{M.recipient(ledger, o)}</strong>
                        <small>{o.details}</small>
                      </>
                    ) : (
                      o.details
                    )}
                  </button>
                  {o.possibleDuplicate && (
                    <span className="badge">Возможный дубль</span>
                  )}
                </td>
                <td
                  data-label="Сумма"
                  className={o.amount > 0n ? "positive" : "money"}
                >
                  {M.formatMoney(o.amount, o.currency)}
                </td>
                <td data-label="Категория">{o.category}</td>
                <td data-label="Тип">{o.kind}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && (
          <p className="empty muted">Нет операций по выбранным фильтрам</p>
        )}
      </div>
      <div className="pagination">
        <button disabled={!current} onClick={() => setPage((p) => p - 1)}>
          ← Назад
        </button>
        <span>
          {current + 1} / {last + 1}
        </span>
        <button
          disabled={current >= last}
          onClick={() => setPage((p) => p + 1)}
        >
          Далее →
        </button>
      </div>
      {chosen && (
        <Dialog title="Детали операции" close={() => setSelected(null)}>
          <OperationEditor
            key={chosen.id}
            operation={chosen}
            ledger={ledger}
            change={change}
            disabled={disabled}
          />
        </Dialog>
      )}
    </section>
  );
}
function OperationEditor({
  operation: o,
  ledger,
  change,
  disabled,
}: {
  operation: M.Operation;
  ledger: M.Ledger;
  change: Change;
  disabled: boolean;
}) {
  const rule = M.matchingRule(ledger, o);
  const edit = (value: Partial<M.Operation>) =>
    void change((l) => M.editOperation(l, o.id, value)).catch(() => {});
  return (
    <div className="editor">
      <strong>{M.recipient(ledger, o)}</strong>
      <p>{o.details}</p>
      <h2>{M.formatMoney(o.amount, o.currency)}</h2>
      <p className="muted">
        {o.date} · {o.bank} · {o.account}
      </p>
      <label>
        Тип операции
        <select
          disabled={disabled}
          value={o.kind}
          onChange={(e) => edit({ kind: e.target.value as M.Kind })}
        >
          {M.kinds.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <label>
        Категория
        <select
          disabled={disabled}
          value={o.category}
          onChange={(e) => edit({ category: e.target.value })}
        >
          {M.allCategories(ledger).map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {o.transferReason && <p className="muted">{o.transferReason}</p>}
      <p className="muted">Категория: {M.categoryExplanation(ledger, o)}</p>
      {(o.mcc || o.bankCategory) && (
        <p className="muted small">
          {o.mcc && `MCC: ${o.mcc}`}
          {o.mcc && o.bankCategory && " · "}
          {o.bankCategory && `В выписке: ${o.bankCategory}`}
        </p>
      )}
      {rule && (
        <div className="notice">
          Пресет: {rule.category} · {rule.kind}
          {(o.manualCategory || o.manualKind) && (
            <>
              <p>Есть индивидуальное исключение</p>
              <button
                disabled={disabled}
                onClick={() =>
                  void change((l) => {
                    const item = l.operations.find((x) => x.id === o.id)!;
                    item.manualCategory = false;
                    item.manualKind = false;
                    M.reclassify(l);
                  }).catch(() => {})
                }
              >
                Использовать пресет
              </button>
            </>
          )}
        </div>
      )}
      {o.possibleDuplicate && (
        <div className="toolbar">
          <button
            disabled={disabled}
            onClick={() => edit({ possibleDuplicate: false })}
          >
            Это отдельная операция
          </button>
          <button
            disabled={disabled}
            onClick={() =>
              edit({ possibleDuplicate: false, kind: M.K.excluded })
            }
          >
            Исключить дубль
          </button>
        </div>
      )}
      <p className="muted small">
        Выбор сохраняется сразу. Новую категорию можно добавить в разделе
        «Группы и пресет → Категории».
      </p>
      <hr />
      <p>
        Источник: {o.source}
        <br />
        {o.sourceRow}
      </p>
    </div>
  );
}
function NameEditor({
  id,
  ledger,
  change,
  disabled,
}: {
  id: string;
  ledger: M.Ledger;
  change: Change;
  disabled: boolean;
}) {
  const listID = useId();
  const [name, setName] = useState(ledger.phoneNames?.[id] ?? "");
  useEffect(
    () => setName(ledger.phoneNames?.[id] ?? ""),
    [ledger.phoneNames, id],
  );
  return (
    <label className="name-editor">
      Имя владельца
      <input
        disabled={disabled}
        value={name}
        list={listID}
        placeholder="Неизвестный номер"
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name !== (ledger.phoneNames?.[id] ?? ""))
            void change((l) => M.setName(l, id, name)).catch(() => {});
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <datalist id={listID}>
        {[...new Set(Object.values(ledger.phoneNames ?? {}))].map((n) => (
          <option key={n}>{n}</option>
        ))}
      </datalist>
    </label>
  );
}
function People({
  ledger,
  operations,
  currency,
  search,
  change,
  disabled,
  open,
}: {
  ledger: M.Ledger;
  operations: M.Operation[];
  currency: string;
  search: string;
  change: Change;
  disabled: boolean;
  open: (c: M.Contact) => void;
}) {
  const people = useMemo(() => M.contacts(ledger), [ledger]),
    index = useMemo(() => M.transferIndex(operations), [operations]),
    [editing, setEditing] = useState<string | null>(null);
  const q = M.normalize(search);
  return (
    <section className="card">
      <h2>Переводы людям и от людей</h2>
      <p className="muted">
        Суммы по фильтрам сверху. Одинаковое имя объединяет номера. Для тёзок
        используй разные подписи.
      </p>
      {people
        .filter(
          (c) =>
            !q ||
            M.normalize(c.name).includes(q) ||
            c.phoneIDs.some((p) => p.includes(q) || index.has(p)),
        )
        .map((c) => {
          const ops = c.phoneIDs.flatMap((p) => index.get(p) ?? []);
          return (
            <article className="person" key={c.id}>
              <div>
                <h3>{c.name}</h3>
                <p className="muted small">
                  {c.phoneIDs.map((p) => "+" + p.slice(6)).join(", ")} ·{" "}
                  {ops.length} операций
                </p>
              </div>
              <div className="person-totals">
                <span>
                  Отправлено:{" "}
                  <strong>
                    {M.formatMoney(
                      ops
                        .filter((o) => o.amount < 0n)
                        .reduce((s, o) => s - o.amount, 0n),
                      currency,
                    )}
                  </strong>
                </span>
                <span className="positive">
                  Получено:{" "}
                  <strong>
                    {M.formatMoney(
                      ops
                        .filter((o) => o.amount > 0n)
                        .reduce((s, o) => s + o.amount, 0n),
                      currency,
                    )}
                  </strong>
                </span>
              </div>
              <button onClick={() => open(c)}>Операции</button>
              <button
                disabled={disabled}
                onClick={() => setEditing(editing === c.id ? null : c.id)}
              >
                Имена номеров
              </button>
              {editing === c.id && (
                <div className="person-edit">
                  {c.phoneIDs.map((id) => (
                    <div key={id}>
                      <span>+{id.slice(6)}</span>
                      <NameEditor
                        id={id}
                        ledger={ledger}
                        change={change}
                        disabled={disabled}
                      />
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      {!people.length && (
        <p>В выписках пока нет переводов с полными номерами.</p>
      )}
    </section>
  );
}
function Owners({
  ledger,
  change,
  disabled,
}: {
  ledger: M.Ledger;
  change: Change;
  disabled: boolean;
}) {
  const [phone, setPhone] = useState(""),
    [query, setQuery] = useState(""),
    [limit, setLimit] = useState(50);
  const rows = useMemo(() => M.ownerRows(ledger), [ledger]),
    own = M.ownPhoneIDs(ledger);
  return (
    <>
      <section className="notice">
        <h3>Мой номер телефона</h3>
        <div className="toolbar">
          <input
            aria-label="Мой номер телефона"
            placeholder="+7 (999) 123-45-67"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button
            disabled={disabled || !phone.trim()}
            onClick={() =>
              void change((l) => M.setOwnPhone(l, phone))
                .then(() => setPhone(""))
                .catch(() => {})
            }
          >
            Сохранить мой номер
          </button>
        </div>
        <label className="check">
          <input
            type="checkbox"
            disabled={disabled || !own.length}
            checked={ledger.otherPhonesArePeople ?? false}
            onChange={(e) =>
              void change((l) => {
                l.otherPhonesArePeople = e.target.checked;
                M.reclassify(l);
              }).catch(() => {})
            }
          />
          Все остальные номера — другие люди
        </label>
        <p className="small">
          Свои номера исключаются из доходов и расходов. Остальные: на них —
          расходы, от них — доходы. Индивидуальные типы сохраняются.
        </p>
      </section>
      <input
        placeholder="Найти номер или имя"
        aria-label="Поиск реквизитов"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(50);
        }}
      />
      {rows
        .filter((r) =>
          M.normalize(
            r.label + " " + (ledger.phoneNames?.[r.id] ?? ""),
          ).includes(M.normalize(query)),
        )
        .slice(0, limit)
        .map((r) => (
          <article className="owner-row" key={r.id}>
            <div>
              <strong>{r.label}</strong>
              <p className="muted small">
                {r.count} операций{r.hasStatement ? " · Есть твоя выписка" : ""}
              </p>
              {r.id.startsWith("phone|") && (
                <NameEditor
                  id={r.id}
                  ledger={ledger}
                  change={change}
                  disabled={disabled}
                />
              )}
            </div>
            <label>
              Принадлежность
              <select
                disabled={disabled}
                value={
                  ledger.transferOwners?.[r.id] === undefined
                    ? "unknown"
                    : ledger.transferOwners[r.id]
                      ? "own"
                      : "other"
                }
                onChange={(e) =>
                  void change((l) =>
                    M.setOwner(
                      l,
                      r.id,
                      e.target.value === "unknown"
                        ? undefined
                        : e.target.value === "own",
                    ),
                  ).catch(() => {})
                }
              >
                <option value="unknown">
                  {ledger.otherPhonesArePeople && r.id.startsWith("phone|")
                    ? "По общему правилу"
                    : "Не задано"}
                </option>
                <option value="own">Мои реквизиты</option>
                <option value="other">Другой человек</option>
              </select>
            </label>
          </article>
        ))}
      {rows.length > limit && (
        <button onClick={() => setLimit((n) => n + 50)}>Показать ещё</button>
      )}
      <p className="muted small">
        Имена не меняют принадлежность номера. Неполные номера не сопоставляются
        по догадке.
      </p>
    </>
  );
}
function Rules({
  ledger,
  change,
  disabled,
}: {
  ledger: M.Ledger;
  change: Change;
  disabled: boolean;
}) {
  const [mode, setMode] = useState("Группы"),
    [automatic, setAutomatic] = useState(false),
    [categoriesOpen, setCategoriesOpen] = useState(false),
    [query, setQuery] = useState(""),
    [reviewOnly, setReviewOnly] = useState(false),
    [limit, setLimit] = useState(50),
    [editing, setEditing] = useState<M.Rule | null>(null),
    [merging, setMerging] = useState<string | null>(null),
    [mergeQuery, setMergeQuery] = useState(""),
    [target, setTarget] = useState("");
  const groups = useMemo(() => M.descriptionGroups(ledger), [ledger]),
    ruleIndex = useMemo(
      () =>
        new Map((ledger.descriptionRules ?? []).map((r) => [M.ruleKey(r), r])),
      [ledger],
    );
  const mergeSource = groups.find((g) => g.id === merging);
  const mergeCandidates = useMemo(() => {
    if (!mergeSource) return [];
    const query = M.normalize(mergeQuery);
    return groups
      .filter((g) => {
        if (g.id === mergeSource.id || g.debit !== mergeSource.debit)
          return false;
        const rule = ruleIndex.get(g.id);
        return (
          M.normalize(
            [
              g.description,
              rule?.description,
              rule?.category,
              ...(rule?.alternateDescriptions ?? []),
            ].join(" "),
          ).includes(query) ||
          g.operations.some((o) =>
            M.normalize(`${o.details} ${o.category}`).includes(query),
          )
        );
      })
      .sort(
        (a, b) =>
          Number(M.similarNames(mergeSource.description, b.description)) -
          Number(M.similarNames(mergeSource.description, a.description)),
      );
  }, [groups, mergeSource, mergeQuery, ruleIndex]);
  return (
    <section className="card rules">
      <div className="toolbar">
        <button disabled={disabled} onClick={() => setCategoriesOpen(true)}>
          Категории
        </button>
        <button disabled={disabled} onClick={() => setAutomatic(true)}>
          Авторазбор и MCC
        </button>
        <span className="muted small">
          Предварительный просмотр общих правил и изменений
        </span>
      </div>
      <div className="toolbar">
        <span>Показать</span>
        <div className="segmented" role="group" aria-label="Режим списка">
          {["Группы", "Пресет"].map((value) => (
            <button
              key={value}
              className={mode === value ? "active" : ""}
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                setLimit(50);
              }}
            >
              {value === "Группы" ? "Группы операций" : value}
            </button>
          ))}
        </div>
        <input
          placeholder="Поиск по описанию или категории"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(50);
          }}
        />
        {mode === "Группы" && (
          <label className="check">
            <input
              type="checkbox"
              checked={reviewOnly}
              onChange={(e) => setReviewOnly(e.target.checked)}
            />
            На разбор
          </label>
        )}
      </div>
      <p className="muted small">
        Правила применяются к текущим и будущим операциям. Индивидуальные
        исправления имеют приоритет.
      </p>
      {mode === "Группы"
        ? groups
            .filter(
              (g) =>
                (!reviewOnly || g.operations.some(M.needsReview)) &&
                M.normalize(
                  g.description + " " + (ruleIndex.get(g.id)?.category ?? ""),
                ).includes(M.normalize(query)),
            )
            .slice(0, limit)
            .map((g) => (
              <article className="group-row" key={g.id}>
                <div>
                  <h3>{M.groupLabel(g.description)}</h3>
                  <p className="muted small">
                    {g.debit ? "Списания" : "Поступления"} ·{" "}
                    {g.operations.length} операций
                  </p>
                  {ruleIndex.has(g.id) && (
                    <p className="positive small">
                      Пресет: {ruleIndex.get(g.id)!.category} ·{" "}
                      {ruleIndex.get(g.id)!.kind}
                    </p>
                  )}
                </div>
                <div className="toolbar">
                  <button
                    disabled={disabled}
                    onClick={() => setEditing(M.preset(ledger, g))}
                  >
                    Категория и тип
                  </button>
                  <button
                    disabled={disabled}
                    onClick={() => {
                      setMerging(g.id);
                      setTarget("");
                      setMergeQuery("");
                    }}
                  >
                    Объединить
                  </button>
                </div>
              </article>
            ))
        : (ledger.descriptionRules ?? [])
            .filter((r) =>
              M.normalize(r.description + " " + r.category).includes(
                M.normalize(query),
              ),
            )
            .slice(0, limit)
            .map((r) => (
              <article className="group-row" key={r.id}>
                <div>
                  <h3>{M.groupLabel(r.description)}</h3>
                  <p>
                    {r.category} · {r.kind}
                  </p>
                  <small>
                    {(r.alternateDescriptions?.length ?? 0) + 1} вариантов
                    описания
                  </small>
                </div>
                <button disabled={disabled} onClick={() => setEditing(r)}>
                  Редактировать
                </button>
              </article>
            ))}
      {(mode === "Группы"
        ? groups.length
        : (ledger.descriptionRules?.length ?? 0)) > limit && (
        <button onClick={() => setLimit((n) => n + 50)}>Показать ещё</button>
      )}
      {editing && (
        <Dialog title="Пресет группы" close={() => setEditing(null)}>
          <RuleEditor
            rule={editing}
            operations={
              groups.find(
                (g) =>
                  g.id ===
                  M.ruleKey(
                    ledger.descriptionRules?.find((r) => r.id === editing.id) ??
                      editing,
                  ),
              )?.operations ?? []
            }
            ledger={ledger}
            disabled={disabled}
            change={change}
            close={() => setEditing(null)}
          />
        </Dialog>
      )}
      {categoriesOpen && (
        <Dialog title="Категории" close={() => setCategoriesOpen(false)}>
          <Categories ledger={ledger} change={change} disabled={disabled} />
        </Dialog>
      )}
      {automatic && (
        <Dialog title="Авторазбор и MCC" close={() => setAutomatic(false)}>
          <AutomaticRules
            ledger={ledger}
            change={change}
            disabled={disabled}
            close={() => setAutomatic(false)}
          />
        </Dialog>
      )}
      {merging && (
        <Dialog title="Объединение групп" close={() => setMerging(null)}>
          <div className="editor">
            <p>
              Все варианты получат пресет выбранной группы. Индивидуальные
              исправления сохранятся.
            </p>
            <label>
              Поиск группы
              <input
                type="search"
                aria-label="Поиск группы для объединения"
                placeholder="Описание или категория"
                value={mergeQuery}
                onChange={(e) => {
                  setMergeQuery(e.target.value);
                  setTarget("");
                }}
              />
            </label>
            <label>
              Целевая группа
              <select
                aria-label="Целевая группа"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Выбери группу</option>
                {mergeCandidates.map((g) => (
                  <option value={g.id} key={g.id}>
                    {M.groupLabel(g.description)}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small" role="status">
              {mergeCandidates.length
                ? `Найдено групп: ${mergeCandidates.length}`
                : "Подходящих групп не найдено. Измени поиск. Для объединения доступны группы того же направления."}
            </p>
            <button
              className="primary"
              disabled={
                disabled || !mergeCandidates.some((g) => g.id === target)
              }
              onClick={() =>
                void change((l) => M.mergeGroups(l, merging, target))
                  .then(() => setMerging(null))
                  .catch(() => {})
              }
            >
              Объединить
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
function RuleEditor({
  rule,
  operations,
  ledger,
  disabled,
  change,
  close,
}: {
  rule: M.Rule;
  operations: M.Operation[];
  ledger: M.Ledger;
  disabled: boolean;
  change: Change;
  close: () => void;
}) {
  const [draft, setDraft] = useState(structuredClone(rule)),
    [replace, setReplace] = useState(false),
    [categorySearch, setCategorySearch] = useState(""),
    [operationKind, setOperationKind] = useState("");
  const categoryID = useId();
  const categories = M.allCategories(ledger).filter((c) =>
    M.normalize(c).includes(M.normalize(categorySearch)),
  );
  const typeCounts = useMemo(
    () =>
      M.kinds
        .map((kind) => ({
          kind,
          count: operations.filter((o) => o.kind === kind).length,
        }))
        .filter(({ count }) => count > 0),
    [operations],
  );
  useEffect(() => {
    if (operationKind && !typeCounts.some(({ kind }) => kind === operationKind))
      setOperationKind("");
  }, [operationKind, typeCounts]);
  const shownOperations = useMemo(
    () => operations.filter((o) => !operationKind || o.kind === operationKind),
    [operations, operationKind],
  );
  const save = (r: M.Rule) =>
    void change((l) => M.setRule(l, r, replace)).catch(() => {});
  return (
    <div className="editor rule-editor">
      <p>{M.groupLabel(draft.description)}</p>
      <div className="rule-choices">
        <fieldset className="rule-category" disabled={disabled}>
          <legend>Категория</legend>
          <strong className="category-current">{draft.category}</strong>
          <input
            type="search"
            aria-label="Найти категорию"
            placeholder="Найти категорию…"
            value={categorySearch}
            onChange={(e) => setCategorySearch(e.target.value)}
          />
          <div className="category-options">
            {categories.map((c) => (
              <label className="category-option" key={c}>
                <input
                  type="radio"
                  name={categoryID}
                  value={c}
                  checked={draft.category === c}
                  onChange={() => {
                    const r = { ...draft, category: c };
                    setDraft(r);
                    save(r);
                  }}
                />
                {c}
              </label>
            ))}
            {!categories.length && (
              <p className="muted" role="status">
                Категория не найдена
              </p>
            )}
          </div>
        </fieldset>
        <label>
          Тип
          <select
            disabled={disabled}
            value={draft.kind}
            onChange={(e) => {
              const r = { ...draft, kind: e.target.value as M.Kind };
              setDraft(r);
              save(r);
            }}
          >
            {M.kinds
              .filter((k) => k !== M.K.pending)
              .map((k) => (
                <option key={k}>{k}</option>
              ))}
          </select>
        </label>
        <div className="toolbar">
          <button
            className="primary"
            disabled={disabled}
            onClick={() => save(draft)}
          >
            Применить пресет
          </button>
          {ledger.descriptionRules?.some((r) => r.id === rule.id) && (
            <button
              disabled={disabled}
              onClick={() =>
                void ask(
                  "Удалить пресет? Автоматические назначения будут отменены, индивидуальные исправления сохранятся.",
                )
                  .then((ok) =>
                    ok
                      ? change((l) => {
                          l.descriptionRules = l.descriptionRules?.filter(
                            (r) => r.id !== rule.id,
                          );
                          M.reclassify(l);
                        }).then(close)
                      : undefined,
                  )
                  .catch(() => {})
              }
            >
              Удалить правило
            </button>
          )}
        </div>
      </div>
      <p className="muted small">Выбор сохраняется сразу.</p>
      <section className="rule-operations" aria-label="Операции группы">
        <h3>Операции группы</h3>
        <p className="muted small">
          Текущие категории и типы. Индивидуальные исправления сохраняются;
          ожидающие подтверждения операции не меняются пресетом.
        </p>
        <label className="rule-type-filter">
          Показать операции
          <select
            aria-label="Тип операций группы"
            value={operationKind}
            onChange={(e) => setOperationKind(e.target.value)}
          >
            <option value="">Все типы ({operations.length})</option>
            {typeCounts.map(({ kind, count }) => (
              <option key={kind} value={kind}>
                {kind} ({count})
              </option>
            ))}
          </select>
        </label>
        <Operations
          operations={shownOperations}
          ledger={ledger}
          change={change}
          disabled={disabled}
        />
        <p className="muted small">
          Показан текущий состав группы. Изменения описания и направления
          вступят в силу после «Применить пресет».
        </p>
      </section>
      <div className="editor rule-settings">
        <h3>Настройки пресета</h3>
        <label>
          Описание
          <textarea
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
        </label>
        <label>
          Направление
          <select
            value={String(draft.debit)}
            onChange={(e) =>
              setDraft({ ...draft, debit: e.target.value === "true" })
            }
          >
            <option value="true">Списания</option>
            <option value="false">Поступления</option>
          </select>
        </label>
        <label>
          Другие варианты описания (по одному на строку)
          <textarea
            value={(draft.alternateDescriptions ?? []).join("\n")}
            onChange={(e) =>
              setDraft({
                ...draft,
                alternateDescriptions: e.target.value.split("\n"),
              })
            }
          />
        </label>
        {M.merchantKey(draft.description, draft.debit) && (
          <label className="check">
            <input
              type="checkbox"
              checked={draft.matchMerchant ?? false}
              disabled={disabled}
              onChange={(e) => {
                const r = { ...draft, matchMerchant: e.target.checked };
                setDraft(r);
                save(r);
              }}
            />
            Применять к этому продавцу в выписках разных банков и городов
          </label>
        )}
        {draft.matchMerchant && (
          <label className="check">
            <input
              type="checkbox"
              checked={draft.ignoreMCC ?? false}
              disabled={disabled}
              onChange={(e) => {
                const r = { ...draft, ignoreMCC: e.target.checked };
                setDraft(r);
                save(r);
              }}
            />
            Применять при смене MCC у этого продавца
          </label>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
          />
          Заменить также индивидуальные исправления этой группы
        </label>
      </div>
    </div>
  );
}
