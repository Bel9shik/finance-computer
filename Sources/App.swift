import SwiftUI
import Charts

#if !FINANCE_TESTS
@main
struct FinanceComputerApp: App {
    @StateObject private var store = FinanceStore()
    var body: some Scene {
        WindowGroup("Мои финансы") {
            FinanceView().environmentObject(store).frame(minWidth: 1000, minHeight: 700)
        }
        .defaultSize(width: 1250, height: 850)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Добавить выписки…") { store.chooseFiles() }.keyboardShortcut("o")
                    .disabled(store.busy || store.readOnly)
                Button("Сохранить копию данных…") { store.exportBackup() }
            }
        }
    }
}
#endif

struct FinanceView: View {
    @EnvironmentObject var store: FinanceStore
    @State private var tab = "Обзор"
    @State private var month = "Все месяцы"
    @State private var bank = "Все банки"
    @State private var currency = "RUB"
    @State private var search = ""
    @State private var onlyReview = false
    @State private var selectedBreakdown: BreakdownSelection?
    @State private var fromDay = Date()
    @State private var throughDay = Date()
    @State private var showTransferOwners = false
    @State private var confirmReset = false

    init(period: String = "Все месяцы", from: Date = Date(), through: Date = Date(), onlyReview: Bool = false) {
        _onlyReview = State(initialValue: onlyReview)
        _month = State(initialValue: period)
        _fromDay = State(initialValue: from)
        _throughDay = State(initialValue: through)
    }

    private var months: [String] { Array(Set(store.ledger.operations.map { String($0.date.prefix(7)) })).sorted(by: >) }
    private var banks: [String] { Array(Set(store.ledger.operations.map(\.bank))).sorted() }
    private var currencies: [String] { Array(Set(store.ledger.operations.map(\.currency) + ["RUB"])).sorted() }
    private var filtered: [Operation] {
        let from = dayKey(fromDay), through = dayKey(throughDay)
        let query = normalized(search)
        return store.ledger.operations.filter {
            dateMatches($0.date, period: month, from: from, through: through) &&
            (bank == "Все банки" || $0.bank == bank) && $0.currency == currency &&
            (query.isEmpty || normalized($0.details + " " + $0.category + " " + (transferParty($0).flatMap { store.ledger.phoneNames?[$0.id] } ?? "")).contains(query))
        }.sorted { $0.date > $1.date }
    }

    private var filteredOperations: [Operation] {
        filtered.filter { !onlyReview || $0.needsReview }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 14) {
                Image(systemName: "chart.pie.fill").font(.largeTitle).foregroundStyle(.teal)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Мои финансы").font(.title.bold())
                    Label("Офлайн · данные на этом Mac", systemImage: "lock.shield").foregroundStyle(.secondary).font(.caption)
                }
                Spacer()
                if store.busy { ProgressView().controlSize(.small); Text("Читаю выписки…").foregroundStyle(.secondary) }
                Button { store.chooseFiles() } label: { Label("Добавить выписки", systemImage: "plus") }
                    .buttonStyle(.borderedProminent).tint(.teal).disabled(store.busy || store.readOnly)
            }.padding(24)
            HStack {
                Picker("Раздел", selection: $tab) {
                    ForEach(["Обзор", "Операции", "Люди", "Группы и пресет", "Импорт"], id: \.self) { Text($0) }
                }.pickerStyle(.segmented).frame(width: 510)
                Spacer()
                if !store.ledger.operations.isEmpty {
                    Button("Чьи переводы?") { showTransferOwners = true }
                    Button("Сохранить копию…") { store.exportBackup() }
                    Button("Начать заново…") { confirmReset = true }
                        .disabled(store.busy || store.readOnly)
                }
            }.padding(.horizontal, 24).padding(.bottom, 18)
            Divider()
            if tab == "Импорт" {
                importsView
            } else if tab == "Группы и пресет" {
                DescriptionRulesView()
            } else if store.ledger.operations.isEmpty {
                emptyState
            } else {
                filters
                if tab == "Обзор" { dashboard }
                else if tab == "Люди" { PeopleTransfersView(operations: filtered, currency: currency, search: search) }
                else { OperationsView(operations: filteredOperations) }
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .sheet(item: $selectedBreakdown) { selection in
            BreakdownOperationsView(selection: selection, operations: filtered, currency: currency).environmentObject(store)
        }
        .sheet(isPresented: $showTransferOwners) { TransferOwnersView().environmentObject(store) }
        .confirmationDialog("Начать новый разбор?", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Очистить и выбрать файлы", role: .destructive) {
                guard store.resetAnalysis() else { return }
                selectedBreakdown = nil
                month = "Все месяцы"
                bank = "Все банки"
                currency = "RUB"
                search = ""
                onlyReview = false
                tab = "Обзор"
                DispatchQueue.main.async { store.chooseFiles() }
            }
            Button("Отмена", role: .cancel) { }
        } message: {
            Text("Текущие операции, история импорта и правила счетов будут очищены. Пресет категорий и типов, имена владельцев номеров, твои номера телефона и настройка остальных номеров сохранятся. Сначала приложение сохранит резервную копию в папке Backups рядом с базой. Исходные выписки останутся на месте. Затем можно выбрать новые файлы.")
        }
        .alert("Мои финансы", isPresented: Binding(get: { store.message != nil }, set: { if !$0 { store.message = nil } })) {
            Button("Понятно") { store.message = nil }
        } message: { Text(store.message ?? "") }
    }

    private var emptyState: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "tray.and.arrow.down").font(.system(size: 54, weight: .light)).foregroundStyle(.teal)
            Text("Собери все расходы в одном месте").font(.title2.bold())
            Text("Выбери одну или несколько выписок:\nPDF Т‑Банка и XLSX Альфа‑Банка.")
                .multilineTextAlignment(.center).foregroundStyle(.secondary)
            Button("Выбрать файлы…") { store.chooseFiles() }.buttonStyle(.borderedProminent).tint(.teal).disabled(store.readOnly)
            Text("Исходные файлы не меняются. Нераспознанные строки видны в отчёте импорта.")
                .font(.caption).foregroundStyle(.secondary)
            Spacer()
        }.frame(maxWidth: .infinity)
    }

    private var filters: some View {
        VStack(alignment: .leading, spacing: 12) {
        HStack(spacing: 16) {
            Picker("Период", selection: $month) {
                Text("Все месяцы").tag("Все месяцы")
                Text("Один день").tag("Один день")
                Text("Диапазон дат").tag("Диапазон дат")
                ForEach(months, id: \.self) { Text($0) }
            }.frame(width: 210)
            Picker("Банк", selection: $bank) {
                Text("Все банки").tag("Все банки")
                ForEach(banks, id: \.self) { Text($0) }
            }.frame(width: 210)
            Picker("Валюта", selection: $currency) {
                ForEach(currencies, id: \.self) { Text($0) }
            }.frame(width: 130)
            TextField("Магазин, категория или человек", text: $search).textFieldStyle(.roundedBorder)
            if tab == "Операции" {
                Toggle("На разбор", isOn: $onlyReview).toggleStyle(.checkbox)
            }
        }
        if month == "Один день" || month == "Диапазон дат" {
            HStack(spacing: 16) {
                DatePicker(month == "Один день" ? "День" : "С", selection: $fromDay, displayedComponents: .date).frame(width: 220)
                if month == "Диапазон дат" {
                    DatePicker("По", selection: $throughDay, displayedComponents: .date).frame(width: 220)
                    Text(dayKey(fromDay) > dayKey(throughDay) ? "Начало позже конца — выбери другой диапазон" : "Обе даты включены")
                        .font(.caption).foregroundStyle(dayKey(fromDay) > dayKey(throughDay) ? Color.orange : .secondary)
                }
                Spacer()
                Button("Все даты") { month = "Все месяцы" }
            }
        }
        }.padding(.horizontal, 24).padding(.vertical, 16)
            .onChange(of: month) { previous, current in
                if current == "Один день" || current == "Диапазон дат", previous != "Один день", previous != "Диапазон дат" {
                    let formatter = DateFormatter()
                    formatter.locale = Locale(identifier: "en_US_POSIX")
                    formatter.dateFormat = "yyyy-MM-dd"
                    if let last = store.ledger.operations.map(\.date).max(), let date = formatter.date(from: last) {
                        fromDay = date; throughDay = date
                    }
                }
            }
    }

    private func metric(_ title: String, value: String, note: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).foregroundStyle(.secondary)
            Text(value).font(.system(size: 26, weight: .semibold, design: .rounded)).foregroundStyle(color)
                .lineLimit(1).minimumScaleFactor(0.7)
            Text(note).font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(20)
            .background(.background, in: RoundedRectangle(cornerRadius: 16))
    }

    private var dashboard: some View {
        let items = filtered
        let expenses = items.reduce(Int64(0)) { $0 + $1.expenseAmount }
        let income = items.reduce(Int64(0)) { $0 + $1.incomeAmount }
        let savings = items.reduce(Int64(0)) { $0 + $1.savingsAmount }
        let pending = items.filter { $0.needsReview }.count
        let byCategory = groupedExpenses(items, key: { $0.category })
        let bySource = groupedIncome(items, phoneNames: store.ledger.phoneNames ?? [:])
        return ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), alignment: .top)], alignment: .leading, spacing: 16) {
                    metric("Расходы", value: formattedMoney(expenses, currency: currency), note: "Спорные списания включены до проверки", color: .primary)
                    metric("Пополнения", value: formattedMoney(income, currency: currency), note: "Включая возвраты, без переводов себе", color: .teal)
                    metric("На накопления", value: formattedMoney(savings, currency: currency), note: "Исходящие переводы с типом «Откладывание на счета»", color: .blue)
                    metric("Нужно проверить", value: String(pending), note: "Категории, переводы и возможные дубли", color: pending > 0 ? .orange : .secondary)
                }
                if pending > 0 {
                    HStack {
                        Image(systemName: "info.circle").foregroundStyle(.orange)
                        Text("Итоги предварительные: проверь отмеченные операции. Переводы самому себе можно исключить в разделе «Операции».")
                            .font(.callout)
                        Spacer()
                        Button("Разобрать") { onlyReview = true; tab = "Операции" }
                    }.padding(14).background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                }
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 18) {
                        Text("Расходы по категориям").font(.headline)
                        Text("Без категории: \(formattedMoney(byCategory.first { $0.label == "Без категории" }?.amount ?? 0, currency: currency)) · включены в общий итог")
                            .font(.callout).foregroundStyle(.secondary)
                        CategoryPie(groups: byCategory, currency: currency) { group in
                            selectedBreakdown = BreakdownSelection(label: group.label, isIncome: false)
                        }
                        Text("Нажми на сектор или категорию справа, чтобы увидеть расходные операции.")
                            .font(.caption).foregroundStyle(.secondary)
                    }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                        .background(.background, in: RoundedRectangle(cornerRadius: 16))
                    VStack(alignment: .leading, spacing: 18) {
                        Text("Откуда приходят деньги").font(.headline)
                        Text("Доходы за выбранный период: \(formattedMoney(income, currency: currency))")
                            .font(.callout).foregroundStyle(.secondary)
                        CategoryPie(groups: bySource, currency: currency, isIncome: true) { group in
                            selectedBreakdown = BreakdownSelection(label: group.label, isIncome: true)
                        }
                        Text("Доходы, возвраты и переводы от других людей. Однотипные переводы с договоров и кэшбэк объединены; переводы по телефону — по сохранённому имени или номеру отправителя. Нажми источник, чтобы открыть операции.")
                            .font(.caption).foregroundStyle(.secondary)
                    }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                        .background(.background, in: RoundedRectangle(cornerRadius: 16))
                }
                CashFlowCharts(operations: items, currency: currency, byMonth: month == "Все месяцы")
                VStack(alignment: .leading, spacing: 12) {
                    Text("Где трачу больше всего").font(.headline)
                    ForEach(groupedExpenses(items, key: { store.ledger.recipientLabel(for: $0) ?? merchantName($0) }).prefix(10)) { group in
                        HStack {
                            Text(group.label).lineLimit(2).textSelection(.enabled)
                            Spacer()
                            Text(formattedMoney(group.amount, currency: currency)).monospacedDigit()
                        }
                        Divider()
                    }
                }.padding(20).background(.background, in: RoundedRectangle(cornerRadius: 16))
                Text("Показано \(items.count) операций · валюты считаются отдельно · фильтры действуют на все показатели")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding(.horizontal, 24).padding(.bottom, 24)
        }
    }

    private var importsView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("История импорта").font(.title2.bold())
                Text("Исходные файлы не копируются в приложение. Сохраняются операции, имя источника и отчёт разбора.")
                    .foregroundStyle(.secondary)
                if store.ledger.imports.isEmpty { Text("Выписки пока не добавлены.") }
                ForEach(store.ledger.imports.reversed()) { item in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Label(item.filename, systemImage: "doc.text").font(.headline)
                            Spacer()
                            Text("\(item.count) операций").foregroundStyle(.secondary)
                        }
                        Text(item.importedAt, style: .date).font(.caption).foregroundStyle(.secondary)
                        if item.warnings.isEmpty { Label("Все обнаруженные строки операций разобраны", systemImage: "checkmark.circle").foregroundStyle(.teal) }
                        else {
                            ForEach(Array(item.warnings.enumerated()), id: \.offset) { _, warning in
                                Label(warning, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).textSelection(.enabled)
                            }
                        }
                    }.padding(20).background(.background, in: RoundedRectangle(cornerRadius: 16))
                }
                Text("Приложение работает без сети. База JSON хранится в Application Support внутри системной песочницы. Копию можно сохранить через меню приложения.")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding(24)
        }
    }
}

struct OperationEditor: View {
    let operation: Operation
    @EnvironmentObject var store: FinanceStore
    @State private var category: String
    @FocusState private var editingCategory: Bool

    init(operation: Operation) {
        self.operation = operation
        _category = State(initialValue: operation.category)
    }

    private func saveCategory(_ value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let newCategory = trimmed.isEmpty ? "Без категории" : trimmed
        if newCategory == operation.category || store.edit(operation.id, changes: { $0.category = newCategory }) {
            category = newCategory
        } else { category = operation.category }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Детали операции").font(.headline)
                if let recipient = store.ledger.recipientLabel(for: operation) {
                    Text(recipient).font(.headline).textSelection(.enabled)
                }
                Text(operation.details).textSelection(.enabled)
                Text(formattedMoney(operation.amount, currency: operation.currency)).font(.title2).monospacedDigit()
                LabeledContent("Дата", value: operation.date)
                LabeledContent("Банк", value: operation.bank)
                if !operation.account.isEmpty { LabeledContent("Счёт", value: operation.account) }
                Picker("Тип", selection: Binding(get: { operation.kind }, set: { kind in
                    store.edit(operation.id) { $0.kind = kind }
                })) {
                    ForEach(OperationKind.allCases) { Text($0.rawValue).tag($0) }
                }.pickerStyle(.menu)
                if let reason = operation.transferReason { Text(reason).font(.caption).foregroundStyle(.secondary) }
                VStack(alignment: .leading) {
                    Text("Категория")
                    TextField("Своя категория", text: $category).textFieldStyle(.roundedBorder)
                        .focused($editingCategory).onSubmit { saveCategory(category) }
                        .onChange(of: editingCategory) { _, focused in
                            if !focused { saveCategory(category) }
                        }
                    Menu("Выбрать из списка") {
                        ForEach(store.ledger.availableCategories, id: \.self) { value in Button(value) { saveCategory(value) } }
                    }
                }
                if let rule = store.ledger.matchingRule(for: operation) {
                    Text("Пресет: \(rule.category) · \(rule.kind.rawValue)").font(.caption).foregroundStyle(.secondary)
                    if operation.manualCategory == true || operation.manualKind == true {
                        Text("Индивидуальное исключение: \([operation.manualCategory == true ? "категория" : nil, operation.manualKind == true ? "тип" : nil].compactMap { $0 }.joined(separator: ", "))")
                            .font(.caption).foregroundStyle(.orange)
                        Button("Использовать пресет для операции") { store.useDescriptionRule(operation.id) }
                            .disabled(operation.kind == .pending)
                    }
                }
                if operation.possibleDuplicate {
                    Text("Похожая операция уже встречалась в другой выписке. Проверь источник: это может быть другая покупка.")
                        .font(.caption).foregroundStyle(.orange)
                    Button("Это отдельная операция") {
                        store.edit(operation.id) { $0.possibleDuplicate = false }
                    }
                    Button("Исключить дубль") {
                        store.edit(operation.id) { $0.kind = .excluded; $0.possibleDuplicate = false }
                    }
                }
                Text("Выбор сохраняется сразу на этом Mac. Свою категорию закончи вводить нажатием Enter или переходом из поля.")
                    .font(.caption).foregroundStyle(.secondary)
                Divider()
                Text("Источник").font(.subheadline.bold())
                Text(operation.source).textSelection(.enabled)
                Text(operation.sourceRow).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                Text("Свои переводы и откладывание на счета исключаются из расходов и доходов. Переводы другим людям — расходы, поступления от других — доходы. Для долга или возврата выбери подходящий тип вручную.")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding(18)
        }
        .onDisappear { if editingCategory { saveCategory(category) } }
        .onChange(of: operation.category) { _, value in
            if !editingCategory { category = value }
        }
    }
}

struct TransferOwnersView: View {
    @EnvironmentObject var store: FinanceStore
    @Environment(\.dismiss) private var dismiss
    @State private var phone = ""
    @State private var editingPhone: TransferParty?
    var body: some View {
        let rows = store.transferOwnerRows
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Получатели и отправители переводов").font(.title2.bold())
                Spacer()
                Button("Готово") { dismiss() }.keyboardShortcut(.defaultAction)
            }
            VStack(alignment: .leading, spacing: 10) {
                Text("Мой номер телефона").font(.headline)
                HStack {
                    TextField("+7 (999) 123-45-67", text: $phone).textFieldStyle(.roundedBorder)
                        .accessibilityLabel("Мой номер телефона")
                    Button("Сохранить мой номер") {
                        if store.setOwnPhone(phone) { phone = "" }
                    }.disabled(phone.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.readOnly || store.busy)
                }
                Toggle("Все остальные номера — другие люди", isOn: Binding(
                    get: { store.ledger.otherPhonesArePeople == true },
                    set: { store.setOtherPhonesArePeople($0) }
                )).toggleStyle(.checkbox).disabled(store.ledger.ownPhoneIDs.isEmpty || store.readOnly || store.busy)
                Text("Сохранение номера включает это правило. Переводы на твои номера и от них не входят в расходы и доходы; на остальные — расходы, от остальных — доходы. Можно сохранить несколько своих номеров. Отключение правила отменяет его автоматические назначения.")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding(14).background(Color.teal.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
            Text("Правила работают в текущих и новых выписках. Ручные типы операций сохраняются. При включённой настройке номер определяет тип перевода даже при наличии пресета описания; возвраты, накопления и исключённые операции сохраняют свой тип.")
                .foregroundStyle(.secondary)
            if rows.isEmpty { Text("В выписках пока нет полных реквизитов переводов. Тип отдельной операции можно выбрать в её деталях.") }
            List(rows) { row in
                let party = row.party
                HStack {
                    VStack(alignment: .leading, spacing: 6) {
                        if let name = store.ledger.phoneNames?[party.id] { Text(name).font(.headline) }
                        Text(party.label).textSelection(.enabled)
                        Text("\(row.count) операций").font(.caption).foregroundStyle(.secondary)
                        if store.ledger.otherPhonesArePeople == true, party.id.hasPrefix("phone|"), store.ledger.transferOwners?[party.id] == nil {
                            Text("Автоматически: другой человек").font(.caption).foregroundStyle(.teal)
                        }
                        if row.hasStatement {
                            Text("Для этого счёта есть твоя выписка").font(.caption).foregroundStyle(.teal)
                        }
                    }
                    Spacer()
                    if party.id.hasPrefix("phone|") {
                        Button("Имя…") { editingPhone = party }.disabled(store.readOnly || store.busy)
                    }
                    Picker("Принадлежность", selection: Binding(
                        get: { store.ledger.transferOwners?[party.id].map { $0 ? "own" : "other" } ?? "unknown" },
                        set: { store.setTransferOwner(party, own: $0 == "unknown" ? nil : $0 == "own") }
                    )) {
                        Text(store.ledger.otherPhonesArePeople == true && party.id.hasPrefix("phone|") ? "По общему правилу" : "Не задано").tag("unknown")
                        Text("Мои реквизиты").tag("own")
                        Text("Другой человек").tag("other")
                    }.labelsHidden().frame(width: 190).disabled(store.readOnly || store.busy)
                }.padding(.vertical, 8)
            }
            Text("Совпадения только по сумме или последним цифрам телефона недостаточно. Такие переводы остаются на разбор.")
                .font(.caption).foregroundStyle(.secondary)
        }.padding(24).frame(width: 800, height: 720)
            .background(Color(nsColor: .windowBackgroundColor))
            .sheet(item: $editingPhone) { party in
                PhoneNameEditor(party: party, name: store.ledger.phoneNames?[party.id] ?? "").environmentObject(store)
            }
    }
}

struct PhoneNameEditor: View {
    @EnvironmentObject var store: FinanceStore
    @Environment(\.dismiss) private var dismiss
    let party: TransferParty
    @State var name: String
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Кому принадлежит номер").font(.title2.bold())
            Text(party.label).textSelection(.enabled)
            TextField("Имя человека", text: $name).textFieldStyle(.roundedBorder)
            Menu("Выбрать человека") {
                ForEach(Array(Set((store.ledger.phoneNames ?? [:]).values)).sorted(), id: \.self) { value in
                    Button(value) { name = value }
                }
            }
            Text("Одинаковое имя объединяет несколько номеров в одного человека. Для тёзок используй разные подписи. Пустое имя удаляет подпись. Типы операций и принадлежность «свой/чужой» не меняются.")
                .font(.caption).foregroundStyle(.secondary)
            if let error { Text(error).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Отмена") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Сохранить") {
                    if store.setPhoneName(party, name: name) { dismiss() }
                    else { error = store.message; store.message = nil }
                }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(store.readOnly || store.busy)
            }
        }.padding(24).frame(width: 520)
            .background(Color(nsColor: .windowBackgroundColor))
    }
}

struct PeopleTransfersView: View {
    @EnvironmentObject var store: FinanceStore
    let operations: [Operation]
    let currency: String
    var search = ""
    @State private var selected: PhoneContact?
    @State private var editingPhone: TransferParty?

    var body: some View {
        let indexed = transfersByPhone(operations)
        let query = normalized(search)
        let contacts = store.ledger.phoneContacts.filter {
            query.isEmpty || normalized($0.name).contains(query) || $0.phoneIDs.contains(where: { $0.contains(query) || indexed[$0] != nil })
        }
        VStack(alignment: .leading, spacing: 14) {
            Text("Переводы людям и от людей").font(.title2.bold())
            Text("Суммы за период, банк и валюту, выбранные сверху. Движения по номерам включают свои и неразобранные переводы; исключённые операции и ожидания подтверждения не учитываются.")
                .font(.callout).foregroundStyle(.secondary)
            if contacts.isEmpty {
                Text(query.isEmpty ? "В выписках пока нет переводов с полными номерами телефонов." : "По этому поиску людей не найдено.").foregroundStyle(.secondary)
                Spacer()
            } else {
                List(contacts) { contact in
                    let items = contact.phoneIDs.flatMap { indexed[$0] ?? [] }
                    HStack(spacing: 20) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(contact.name).font(.headline)
                            Text(contact.phoneIDs.map { "+" + $0.dropFirst(6) }.joined(separator: ", "))
                                .font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                            Text("\(items.count) операций").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 6) {
                            Text("Отправлено: \(formattedMoney(items.filter { $0.amount < 0 }.reduce(0) { $0 - $1.amount }, currency: currency))")
                            Text("Получено: \(formattedMoney(items.filter { $0.amount > 0 }.reduce(0) { $0 + $1.amount }, currency: currency))").foregroundStyle(.teal)
                        }.monospacedDigit()
                        Menu("Имена номеров") {
                            ForEach(contact.phoneIDs, id: \.self) { id in
                                Button("+" + id.dropFirst(6)) { editingPhone = TransferParty(id: id, label: "Телефон +" + id.dropFirst(6)) }
                            }
                        }.fixedSize().disabled(store.readOnly || store.busy)
                        Button("Операции") { selected = contact }
                    }.padding(.vertical, 8)
                }
            }
        }.padding(24)
        .background(Color(nsColor: .windowBackgroundColor))
        .sheet(item: $selected) { contact in
            PersonTransfersView(contact: contact, operations: operations, currency: currency).environmentObject(store)
        }
        .sheet(item: $editingPhone) { party in
            PhoneNameEditor(party: party, name: store.ledger.phoneNames?[party.id] ?? "").environmentObject(store)
        }
    }
}

struct PersonTransfersView: View {
    @Environment(\.dismiss) private var dismiss
    let contact: PhoneContact
    let operations: [Operation]
    let currency: String
    @State private var direction = "Все переводы"

    var body: some View {
        let all = contact.transfers(in: operations)
        let items = all.filter { direction == "Все переводы" || (direction == "Я отправил" ? $0.amount < 0 : $0.amount > 0) }
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text(contact.name).font(.title2.bold())
                    Text("Отправлено: \(formattedMoney(all.filter { $0.amount < 0 }.reduce(0) { $0 - $1.amount }, currency: currency)) · Получено: \(formattedMoney(all.filter { $0.amount > 0 }.reduce(0) { $0 + $1.amount }, currency: currency))")
                    Text("Сохранены фильтры раздела «Люди». Суммы показывают движения по номерам человека.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Готово") { dismiss() }.keyboardShortcut(.cancelAction)
            }.padding(.horizontal, 16)
            Picker("Направление", selection: $direction) {
                ForEach(["Все переводы", "Я отправил", "Я получил"], id: \.self) { Text($0) }
            }.pickerStyle(.segmented).frame(width: 420).padding(.horizontal, 16)
            if items.isEmpty { Text("Нет переводов по выбранным фильтрам.").padding(); Spacer() }
            else { OperationsView(operations: items) }
        }.padding(.vertical, 20).frame(width: 1050, height: 620)
            .background(Color(nsColor: .windowBackgroundColor))
    }
}

struct OperationsView: View {
    @EnvironmentObject var store: FinanceStore
    let operations: [Operation]
    @State private var selected: UUID?
    @State private var sortOrder = [KeyPathComparator(\Operation.date, order: .reverse)]

    var body: some View {
        HSplitView {
            VStack(alignment: .leading) {
                Text("\(operations.count) операций. Нажми заголовок для сортировки, строку — для исправления.")
                    .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 12)
                Table(operations.sorted(using: sortOrder), selection: $selected, sortOrder: $sortOrder) {
                    TableColumn("Дата", value: \.date).width(85)
                    TableColumn("Банк", value: \.bank).width(85)
                    TableColumn("Описание", value: \.details) { operation in
                        HStack {
                            if operation.possibleDuplicate { Image(systemName: "square.on.square").foregroundStyle(.orange).help("Возможный дубль") }
                            VStack(alignment: .leading, spacing: 3) {
                                if let recipient = store.ledger.recipientLabel(for: operation) {
                                    Text(recipient).fontWeight(.medium).lineLimit(1).help(recipient)
                                    Text(operation.details).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                } else {
                                    Text(operation.details).lineLimit(2)
                                }
                            }
                        }
                    }.width(min: 140, ideal: 250)
                    TableColumn("Сумма", value: \.amount) { operation in
                        Text(formattedMoney(operation.amount, currency: operation.currency)).monospacedDigit()
                            .foregroundStyle(operation.amount < 0 ? Color.primary : .teal)
                    }.width(120)
                    TableColumn("Категория", value: \.category).width(130)
                    TableColumn("Тип", value: \.kindLabel).width(140)
                }
            }
            if let operation = operations.first(where: { $0.id == selected }) {
                OperationEditor(operation: operation).id(operation.id)
                    .frame(minWidth: 245, idealWidth: 280, maxWidth: 320)
                    .disabled(store.readOnly)
            }
        }
    }

}

struct CashFlowCharts: View {
    let operations: [Operation]
    let currency: String
    let byMonth: Bool
    @State var selectedCategory: String? = nil
    @State private var selection: CashFlowSelection?

    var body: some View {
        let categories = Array(Set(operations.filter { $0.expenseAmount != 0 }.map(\.category) + [selectedCategory].compactMap { $0 })).sorted()
        let periods = cashFlow(operations, byMonth: byMonth, expenseCategory: selectedCategory)
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 18) {
                Text(byMonth ? "Расходы по месяцам" : "Расходы по дням").font(.headline)
                Picker("Категория", selection: $selectedCategory) {
                    Text("Все категории").tag(nil as String?)
                    ForEach(categories, id: \.self) { Text($0).tag(Optional($0)) }
                }.frame(maxWidth: 420)
                AmountChart(points: periods.map { ExpenseGroup(label: $0.period, amount: $0.expenses) },
                            currency: currency, byMonth: byMonth, measure: .expenses) { period in
                    selection = CashFlowSelection(period: period, category: selectedCategory)
                }
                Text("Расходы · \(selectedCategory ?? "Все категории")")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                .background(.background, in: RoundedRectangle(cornerRadius: 16))
            VStack(alignment: .leading, spacing: 18) {
                Text(byMonth ? "Поступления по месяцам" : "Поступления по дням").font(.headline)
                AmountChart(points: periods.map { ExpenseGroup(label: $0.period, amount: $0.income) },
                            currency: currency, byMonth: byMonth, measure: .income) { period in
                    selection = CashFlowSelection(period: period, measure: .income)
                }
                Text("Доходы, возвраты и переводы от других людей, без своих переводов и неразобранных поступлений.")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                .background(.background, in: RoundedRectangle(cornerRadius: 16))
            VStack(alignment: .leading, spacing: 18) {
                Text(byMonth ? "На накопления по месяцам" : "На накопления по дням").font(.headline)
                AmountChart(points: periods.map { ExpenseGroup(label: $0.period, amount: $0.savings) },
                            currency: currency, byMonth: byMonth, measure: .savings) { period in
                    selection = CashFlowSelection(period: period, measure: .savings)
                }
                Text("Исходящие переводы с типом «Откладывание на счета». Сумма за каждый период, без повторного учёта зачислений и без вычета снятий. Категория расходов на этот график не влияет.")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                .background(.background, in: RoundedRectangle(cornerRadius: 16))
            Text("Показаны периоды с загруженными операциями по фильтрам обзора. Выписки могут охватывать их не целиком.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .sheet(item: $selection) { selection in
            PeriodOperationsView(selection: selection, operations: operations, currency: currency)
        }
    }
}

struct AmountChart: View {
    let points: [ExpenseGroup]
    let currency: String
    let byMonth: Bool
    let measure: CashFlowMeasure
    var onSelect: (String) -> Void

    var body: some View {
        if points.isEmpty {
            Text("Нет операций по выбранным фильтрам").foregroundStyle(.secondary)
        } else {
            let color: Color = measure == .income ? .teal : measure == .savings ? .purple : .blue
            Chart(points) { point in
                LineMark(x: .value("Период", point.label), y: .value("Сумма", Double(point.amount) / 100))
                    .foregroundStyle(color)
                    .lineStyle(StrokeStyle(lineWidth: 3))
                    .interpolationMethod(.linear)
                    .accessibilityHidden(true)
                PointMark(x: .value("Период", point.label), y: .value("Сумма", Double(point.amount) / 100))
                    .foregroundStyle(color)
                    .symbol(.diamond)
                    .symbolSize(60)
                    .annotation(position: point.amount < 0 ? .bottom : .top) {
                        Text(formattedMoney(point.amount, currency: currency)).font(.caption2).monospacedDigit()
                    }
                    .accessibilityLabel(point.label)
                    .accessibilityValue(formattedMoney(point.amount, currency: currency))
            }
            .chartScrollableAxes(.horizontal)
            .chartXVisibleDomain(length: min(6, points.count))
            .chartYAxisLabel(currency)
            .chartXAxis {
                AxisMarks { value in
                    AxisGridLine()
                    AxisTick()
                    AxisValueLabel {
                        if let period = value.as(String.self) {
                            Text(byMonth ? String(period.suffix(2)) + "." + String(period.prefix(4)) : chartDayLabel(period))
                        }
                    }
                }
            }
            .chartGesture { proxy in
                SpatialTapGesture().onEnded { value in
                    if let period: String = proxy.value(atX: value.location.x), points.contains(where: { $0.label == period }) {
                        onSelect(period)
                    }
                }
            }
            .frame(height: 240)
            .accessibilityLabel("\(measure.rawValue) за выбранный период")
            Text(byMonth ? "Нажми на месяц, чтобы увидеть операции. График можно прокручивать по горизонтали."
                         : "Нажми на день, чтобы увидеть операции. График можно прокручивать по горизонтали.")
                .font(.caption).foregroundStyle(.secondary)
            Menu(byMonth ? "Открыть месяц…" : "Открыть день…") {
                ForEach(points) { point in Button(point.label) { onSelect(point.label) } }
            }.fixedSize()
        }
    }
}

struct PeriodOperationsView: View {
    @Environment(\.dismiss) private var dismiss
    let selection: CashFlowSelection
    let operations: [Operation]
    let currency: String

    var items: [Operation] { selection.operations(in: operations) }
    var amount: Int64 { items.reduce(0) { $0 + selection.measure.amount($1) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(selection.measure.rawValue) за \(selection.period)").font(.title2.bold())
                    Text("Итого: \(formattedMoney(amount, currency: currency))")
                    if selection.measure == .expenses, let category = selection.category { Text("Категория: \(category)") }
                    Text(selection.measure == .savings
                         ? "Сохранены фильтры обзора. Только исходящие операции с типом «Откладывание на счета»."
                         : "Сохранены фильтры обзора. Свои переводы и ожидающие операции исключены.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Готово") { dismiss() }.keyboardShortcut(.cancelAction)
            }.padding(.horizontal, 16)
            if items.isEmpty {
                Text("За этот период операций по выбранным фильтрам нет.").padding()
                Spacer()
            } else {
                OperationsView(operations: items)
            }
        }.padding(.vertical, 20).frame(width: 1050, height: 580)
            .background(Color(nsColor: .windowBackgroundColor))
    }
}

struct BreakdownOperationsView: View {
    @EnvironmentObject var store: FinanceStore
    @Environment(\.dismiss) private var dismiss
    let selection: BreakdownSelection
    let operations: [Operation]
    let currency: String

    var body: some View {
        let items = selection.operations(in: operations, phoneNames: store.ledger.phoneNames ?? [:])
        let amount = items.reduce(Int64(0)) { $0 + (selection.isIncome ? $1.incomeAmount : $1.expenseAmount) }
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(selection.isIncome ? "Доходы" : "Расходы"): \(selection.label)").font(.title2.bold())
                    Text("Итого: \(formattedMoney(amount, currency: currency))")
                    Text("Сохранены период, банк, валюта и поиск из обзора.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Готово") { dismiss() }.keyboardShortcut(.cancelAction)
            }.padding(.horizontal, 16)
            if items.isEmpty {
                Text("Операций по выбранным фильтрам больше нет.").padding()
                Spacer()
            } else { OperationsView(operations: items) }
        }.padding(.vertical, 20).frame(width: 1050, height: 580)
            .background(Color(nsColor: .windowBackgroundColor))
    }
}

struct CategoryPie: View {
    let groups: [ExpenseGroup]
    let currency: String
    var isIncome = false
    var onSelect: (ExpenseGroup) -> Void = { _ in }
    var slices: [ExpenseGroup] { groups.filter { $0.amount > 0 } }
    var total: Int64 { slices.reduce(0) { $0 + $1.amount } }
    private let colors: [Color] = [.purple, .blue, .cyan, .orange, .pink, .green, .indigo, .mint, .red, .brown, .teal, .yellow]

    func share(_ group: ExpenseGroup) -> Double {
        total > 0 && group.amount > 0 ? Double(group.amount) / Double(total) : 0
    }

    func group(at value: Double) -> ExpenseGroup? {
        guard value.isFinite, value >= 0 else { return nil }
        var end: Int64 = 0
        for group in slices {
            end += group.amount
            if value < Double(end) { return group }
        }
        return nil
    }

    func group(at point: CGPoint, in frame: CGRect) -> ExpenseGroup? {
        let x = point.x - frame.midX, y = point.y - frame.midY
        let radius = min(frame.width, frame.height) / 2
        guard radius > 0, hypot(x, y) <= radius, x != 0 || y != 0 else { return nil }
        // Sectors start at twelve o'clock and run clockwise.
        let angle = atan2(x, -y)
        let fraction = (angle < 0 ? angle + 2 * .pi : angle) / (2 * .pi)
        return group(at: fraction * Double(total))
    }

    private func percentage(_ group: ExpenseGroup) -> String {
        let value = share(group)
        return value > 0 && value < 0.001 ? "< 0,1 %" : value.formatted(.percent.precision(.fractionLength(1)).locale(Locale(identifier: "ru_RU")))
    }

    var body: some View {
        HStack(alignment: .center, spacing: 32) {
            if slices.isEmpty {
                Text(isIncome ? "Нет доходов по выбранным фильтрам" : "Нет положительных расходов для круговой диаграммы")
                    .foregroundStyle(.secondary).frame(width: 320, height: 280)
            } else {
                Chart(slices) { group in
                    SectorMark(angle: .value("Сумма", Double(group.amount)), angularInset: 1)
                        .foregroundStyle(by: .value("Категория", group.label))
                        .annotation(position: .overlay) {
                            if share(group) >= 0.05 {
                                Text(percentage(group)).font(.callout.bold()).foregroundStyle(.black)
                                    .padding(.horizontal, 5).padding(.vertical, 3)
                                    .background(.white.opacity(0.9), in: RoundedRectangle(cornerRadius: 5))
                            }
                        }
                        .accessibilityLabel(group.label)
                        .accessibilityValue("\(formattedMoney(group.amount, currency: currency)), \(percentage(group))")
                }
                .chartForegroundStyleScale(domain: groups.map(\.label), range: groups.indices.map { colors[$0 % colors.count] })
                .chartLegend(.hidden)
                .chartOverlay { proxy in
                    GeometryReader { geometry in
                        Color.clear.contentShape(Rectangle())
                            .onTapGesture { point in
                                guard let plotFrame = proxy.plotFrame,
                                      let group = group(at: point, in: geometry[plotFrame]) else { return }
                                onSelect(group)
                            }
                    }
                }
                .frame(width: 320, height: 280)
                .accessibilityLabel(isIncome ? "Источники доходов" : "Доли расходов по категориям")
            }
            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array(groups.enumerated()), id: \.element.id) { index, group in
                    Button { onSelect(group) } label: {
                    HStack(spacing: 10) {
                        Circle().fill(colors[index % colors.count]).frame(width: 10, height: 10)
                        Text(group.label).multilineTextAlignment(.leading).lineLimit(3)
                        Spacer(minLength: 16)
                        Text(formattedMoney(group.amount, currency: currency)).monospacedDigit()
                        Text(group.amount > 0 ? percentage(group) : "—")
                            .monospacedDigit().foregroundStyle(.secondary).frame(width: 72, alignment: .trailing)
                    }.contentShape(Rectangle())
                    }.buttonStyle(.plain).help("Показать операции: " + group.label)
                }
                if isIncome {
                    Text("Доли в общей сумме доходов. Все источники и суммы показаны справа.")
                        .font(.caption).foregroundStyle(.secondary)
                } else if groups.contains(where: { $0.amount <= 0 }) {
                    Text("Доли рассчитаны по категориям с положительным итогом. Нулевые и отрицательные итоги показаны в списке, без сектора.")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("Доли расходов. Возвраты показаны в поступлениях. Мелкие доли подписаны в списке справа.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct DescriptionRulesView: View {
    @EnvironmentObject var store: FinanceStore
    @State private var search = ""
    @State private var mode = "Группы операций"
    @State private var editing: DescriptionRule?
    @State private var deleting: DescriptionRule?
    @State private var merging: DescriptionGroup?

    init(mode: String = "Группы операций") { _mode = State(initialValue: mode) }

    var body: some View {
        let query = normalized(search)
        let allRules = store.ledger.descriptionRules ?? []
        let rulesByKey = Dictionary(grouping: allRules, by: \.key)
        let groups = mode == "Группы операций" ? descriptionGroups(store.ledger.operations, rules: allRules).filter { group in
            query.isEmpty || group.operations.contains { normalized($0.details).contains(query) }
        } : []
        let rules = allRules.filter { query.isEmpty || normalized($0.description + " " + $0.category).contains(query) }
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Picker("Показать", selection: $mode) {
                    Text("Группы операций").tag("Группы операций")
                    Text("Пресет").tag("Пресет")
                }.pickerStyle(.segmented).frame(width: 320)
                TextField("Поиск по описанию", text: $search).textFieldStyle(.roundedBorder)
                Button("Новое правило…") { editing = DescriptionRule(description: "", category: "Без категории", kind: .expense) }
                    .disabled(store.readOnly || store.busy)
            }
            Text("В названиях покупок не учитываются регистр, лишние пробелы, дефисы и подчёркивания. Зарплата группируется по работодателю независимо от порядка частей описания. Другие варианты можно объединить через «Объединить…». Списания и поступления — отдельно.")
                .font(.callout).foregroundStyle(.secondary)
            if mode == "Группы операций" {
                List(groups) { group in
                    HStack {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(descriptionGroupLabel(group.description)).textSelection(.enabled)
                            Text("\(group.debit ? "Списания" : "Поступления") · \(group.operations.count) операций")
                                .font(.caption).foregroundStyle(.secondary)
                            let matchingRules = rulesByKey[group.id] ?? []
                            if matchingRules.count > 1 {
                                Text("Разные старые правила — выбери общее в настройках группы").font(.caption).foregroundStyle(.orange)
                            } else if let rule = matchingRules.first {
                                Text("Пресет: \(rule.category) · \(rule.kind.rawValue)").font(.caption).foregroundStyle(.teal)
                            }
                        }
                        Spacer()
                        Button("Объединить…") { merging = group }.disabled(store.readOnly || store.busy)
                        Button("Настроить группу…") { editing = store.ledger.preset(for: group) }
                            .disabled(store.readOnly || store.busy)
                    }.padding(.vertical, 6)
                }
                if groups.isEmpty { Text("Групп по этому поиску нет.").foregroundStyle(.secondary) }
            } else {
                List(rules) { rule in
                    HStack {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(descriptionGroupLabel(rule.description)).textSelection(.enabled)
                            if (rulesByKey[rule.key]?.count ?? 0) > 1 {
                                Text("Конфликт группы · пока действует только на исходное описание").font(.caption).foregroundStyle(.orange)
                                Text(rule.description).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                            }
                            Text("\(rule.debit ? "Списания" : "Поступления") → \(rule.category) · \(rule.kind.rawValue)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Изменить…") { editing = rule }
                        Button("Удалить…", role: .destructive) { deleting = rule }
                    }.padding(.vertical, 6).disabled(store.readOnly || store.busy)
                }
                if rules.isEmpty { Text("Пресет пуст или нет совпадений. Создай правило из группы операций.").foregroundStyle(.secondary) }
            }
            Text("Правила действуют на существующие и будущие операции и сохраняются после «Начать заново». Индивидуальные правки имеют приоритет. HOLD не изменяются правилом.")
                .font(.caption).foregroundStyle(.secondary)
        }.padding(24)
        .sheet(item: $editing) { rule in DescriptionRuleEditor(rule: rule).environmentObject(store) }
        .sheet(item: $merging) { group in MergeDescriptionGroupsView(source: group).environmentObject(store) }
        .confirmationDialog("Удалить правило?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Удалить правило", role: .destructive) {
                if let rule = deleting { store.deleteRule(rule.id) }
                deleting = nil
            }
            Button("Отмена", role: .cancel) { deleting = nil }
        } message: {
            Text("Автоматические назначения этого правила отменятся. Индивидуальные правки операций сохранятся.")
        }
    }
}

struct MergeDescriptionGroupsView: View {
    @EnvironmentObject var store: FinanceStore
    @Environment(\.dismiss) private var dismiss
    let source: DescriptionGroup
    @State var targetID: String?
    @State private var search = ""
    @State private var error: String?

    var body: some View {
        let candidates = descriptionGroups(store.ledger.operations, rules: store.ledger.descriptionRules ?? [])
            .filter { $0.id != source.id && $0.debit == source.debit }
        let suggestions = Set(candidates.filter { similarPurchaseNames(source.description, $0.description) }.map(\.id))
        let visible = candidates.filter { group in
            search.isEmpty || group.operations.contains { normalized($0.details).contains(normalized(search)) }
        }.sorted {
            if suggestions.contains($0.id) != suggestions.contains($1.id) { return suggestions.contains($0.id) }
            return $0.id < $1.id
        }
        let target = candidates.first { $0.id == targetID }
        VStack(alignment: .leading, spacing: 14) {
            Text("Объединить варианты названия").font(.title2.bold())
            Text("Исходная группа: " + descriptionGroupLabel(source.description)).textSelection(.enabled)
            Text("Похожие названия показаны первыми. Выбери группу, чей пресет нужно использовать. Можно найти любое другое описание того же направления.")
                .font(.callout).foregroundStyle(.secondary)
            TextField("Поиск группы", text: $search).textFieldStyle(.roundedBorder)
            List(visible, selection: $targetID) { group in
                VStack(alignment: .leading, spacing: 5) {
                    Text(descriptionGroupLabel(group.description))
                    let rule = store.ledger.preset(for: group)
                    Text("\(group.operations.count) операций · \(rule.category) · \(rule.kind.rawValue)")
                        .font(.caption).foregroundStyle(.secondary)
                    if suggestions.contains(group.id) { Text("Похожее название — проверь перед объединением").font(.caption).foregroundStyle(.teal) }
                }.padding(.vertical, 4).tag(group.id)
            }
            if let target {
                let rule = store.ledger.preset(for: target)
                Text("Общий пресет: \(rule.category) · \(rule.kind.rawValue). Его получат обе группы и будущие операции с этими вариантами названия. Прежние правила этих групп будут заменены; индивидуальные правки и HOLD сохранятся.")
            } else if visible.isEmpty {
                Text("Подходящих групп нет. Вариант описания можно добавить вручную в настройках правила.").foregroundStyle(.secondary)
            }
            if let error { Text(error).foregroundStyle(.red) }
            HStack {
                Text("Объединение можно изменить в «Настроить группу… → Варианты описания».").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Отмена") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Объединить и применить пресет") {
                    guard let target else { return }
                    if store.mergeDescriptionGroups(sourceID: source.id, targetID: target.id) { dismiss() }
                    else { error = store.message ?? "Изменения сейчас недоступны"; store.message = nil }
                }.buttonStyle(.borderedProminent).disabled(target == nil || store.readOnly || store.busy)
            }
        }.padding(24).frame(width: 1000, height: 650)
            .background(Color(nsColor: .windowBackgroundColor))
    }
}

struct DescriptionRuleEditor: View {
    @EnvironmentObject var store: FinanceStore
    @Environment(\.dismiss) private var dismiss
    @State var rule: DescriptionRule
    @State private var alternateDescription = ""
    @State private var replaceManual = false
    @State private var error: String?

    var body: some View {
        let ruleKeys = rule.keys
        let matches = store.ledger.operations.filter { ruleKeys.contains(descriptionGroupKey($0.details, debit: $0.amount < 0)) }
        let pending = matches.filter { $0.kind == .pending }.count
        let exceptions = matches.filter { $0.kind != .pending && ($0.manualCategory == true || $0.manualKind == true) }.count
        VStack(alignment: .leading, spacing: 14) {
            Text("Правило группы").font(.title2.bold())
            TextField("Пример описания операции", text: $rule.description).textFieldStyle(.roundedBorder)
            HStack {
                Picker("Направление", selection: $rule.debit) {
                    Text("Списания").tag(true)
                    Text("Поступления").tag(false)
                }.frame(width: 240)
                Picker("Тип", selection: $rule.kind) {
                    ForEach(OperationKind.allCases.filter { $0 != .pending }) { Text($0.rawValue).tag($0) }
                }.frame(width: 350)
                TextField("Категория", text: $rule.category).textFieldStyle(.roundedBorder)
                Menu("Категории") {
                    ForEach(store.ledger.availableCategories, id: \.self) { category in Button(category) { rule.category = category } }
                }
            }
            Text("Группа: \(descriptionGroupLabel(rule.description))").font(.callout)
            Text("Для покупок сравниваются названия без различий регистра, пробелов и дефисов; MCC Альфы сохраняется. Для СБП — телефон и направление, для зарплаты — работодатель независимо от порядка частей описания. Подтверждённые варианты названия используют этот же пресет. Исходные описания операций сохраняются.")
                .font(.caption).foregroundStyle(.secondary)
            if (store.ledger.descriptionRules ?? []).filter({ $0.key == rule.key }).count > 1 {
                Text("В этой группе разные старые правила. Сохранение заменит их одним общим правилом. Индивидуальные исключения сохранятся, если флажок ниже выключен.")
                    .font(.callout).foregroundStyle(.orange)
            }
            DisclosureGroup("Варианты описания: \(rule.alternateDescriptions?.count ?? 0)") {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array((rule.alternateDescriptions ?? []).enumerated()), id: \.offset) { index, description in
                            HStack {
                                Text(description).textSelection(.enabled)
                                Spacer()
                                Button("Убрать вариант") { rule.alternateDescriptions?.remove(at: index) }
                            }
                        }
                    }
                }.frame(maxHeight: 100)
                HStack {
                    TextField("Другое полное описание этой группы", text: $alternateDescription).textFieldStyle(.roundedBorder)
                    Button("Добавить вариант") {
                        rule.alternateDescriptions = (rule.alternateDescriptions ?? []) + [alternateDescription]
                        alternateDescription = ""
                    }.disabled(normalized(alternateDescription).isEmpty)
                }
                Text("Изменения вариантов применятся после сохранения правила. Удалённый вариант снова станет отдельной группой.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Text("Совпадений: \(matches.count) · из них ожидают подтверждения: \(pending) · с индивидуальными исключениями: \(exceptions)")
            Toggle("Заменить также индивидуальные категории и типы в этой группе", isOn: $replaceManual)
                .toggleStyle(.checkbox)
            Text("Обычно флажок выключен: изменятся только поля без индивидуальных правок. Категории из старой версии сохранены как исключения, поскольку их происхождение не записывалось.")
                .font(.caption).foregroundStyle(.secondary)
            if let error { Text(error).foregroundStyle(.red) }
            OperationsView(operations: matches)
            HStack {
                Text("Отдельные операции можно править в списке — эти правки сохраняются сразу.")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Закрыть") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Сохранить правило и применить") {
                    if store.saveRule(rule, replaceManual: replaceManual) { dismiss() }
                    else { error = store.message ?? "Изменения сейчас недоступны"; store.message = nil }
                }.buttonStyle(.borderedProminent).disabled(store.readOnly || store.busy || normalized(rule.description).isEmpty || normalized(rule.category).isEmpty)
            }
        }.padding(24).frame(width: 1120, height: 720)
            .background(Color(nsColor: .windowBackgroundColor))
    }
}
