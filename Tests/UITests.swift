import SwiftUI
import PDFKit

@main
struct UITests {
    @MainActor static func main() throws {
        _ = NSApplication.shared
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("finance-tests-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("ledger.json")
        if CommandLine.arguments.contains("--transfer-performance") {
            try transferOwnersPerformance(file: file)
            return
        }
        let names = ["Продукты", "Транспорт", "Кафе и рестораны", "Жильё и ЖКХ", "Здоровье", "Без категории"]
        let amounts: [Int64] = [-125050, -63000, -280000, -1000000, -340000, -56250]
        var ledger = Ledger()
        for i in 0..<names.count {
            ledger.operations.append(Operation(date: "2026-10-0\(i + 1)", bank: i % 2 == 0 ? "Т‑Банк" : "Альфа‑Банк", account: "Тестовый счёт",
                details: names[i], amount: amounts[i], currency: "RUB", category: names[i], kind: .expense,
                source: "Синтетический пример", sourceRow: "Тест \(i)"))
        }
        ledger.operations.append(Operation(date: "2026-10-02", bank: "Т‑Банк", account: "Тестовый счёт",
            details: "Зарплата", amount: 2000000, currency: "RUB", category: "Доходы", kind: .income,
            source: "Синтетический пример", sourceRow: "Доход"))
        try JSONEncoder().encode(ledger).write(to: file)
        let store = FinanceStore(location: file)
        precondition(store.ledger.operations.count == names.count + 1)
        var edited = store.ledger.operations[0]
        edited.category = "Своя категория"
        precondition(store.update(edited))
        let reloaded = FinanceStore(location: file)
        precondition(reloaded.ledger.operations[0].category == "Своя категория")
        let editFile = directory.appendingPathComponent("autosave.json")
        try JSONEncoder().encode(ledger).write(to: editFile)
        let editStore = FinanceStore(location: editFile)
        let editID = editStore.ledger.operations[0].id
        precondition(editStore.edit(editID) { $0.kind = .savings })
        precondition(FinanceStore(location: editFile).ledger.operations[0].kind == .savings)
        precondition(editStore.edit(editID) { $0.category = "  Мои накопления  " })
        let autosaved = FinanceStore(location: editFile).ledger.operations[0]
        precondition(autosaved.kind == .savings && autosaved.manualKind == true && autosaved.category == "Мои накопления")
        precondition(editStore.edit(editID) { $0.category = "  " })
        precondition(FinanceStore(location: editFile).ledger.operations[0].category == "Без категории")
        // A failed immediate save must leave the in-memory operation unchanged.
        try FileManager.default.removeItem(at: editFile)
        try FileManager.default.createDirectory(at: editFile, withIntermediateDirectories: false)
        let beforeFailedEdit = editStore.ledger.operations[0]
        precondition(!editStore.edit(editID) { $0.kind = .expense })
        precondition(editStore.ledger.operations[0] == beforeFailedEdit && editStore.message != nil)
        let presetFile = directory.appendingPathComponent("preset.json")
        try JSONEncoder().encode(ledger).write(to: presetFile)
        let presetStore = FinanceStore(location: presetFile)
        var preset = DescriptionRule(description: ledger.operations[0].details, category: "Еда", kind: .expense)
        precondition(presetStore.saveRule(preset))
        let presetID = presetStore.ledger.operations[0].id
        precondition(presetStore.edit(presetID) { $0.category = "Исключение" })
        preset.category = "Еда дома"; preset.kind = .savings
        precondition(presetStore.saveRule(preset))
        let presetReloaded = FinanceStore(location: presetFile)
        precondition(presetReloaded.ledger.operations[0].category == "Исключение" && presetReloaded.ledger.operations[0].kind == .savings)
        precondition(presetReloaded.useDescriptionRule(presetID))
        precondition(presetReloaded.ledger.operations[0].category == "Еда дома" && presetReloaded.ledger.operations[0].manualCategory == false)
        precondition(presetReloaded.deleteRule(preset.id))
        precondition(presetReloaded.ledger.operations[0].category == ledger.operations[0].category && presetReloaded.ledger.operations[0].kind == .expense)
        // A pre-preset database has no classificationVersion key.
        let legacyFile = directory.appendingPathComponent("legacy.json")
        var legacyJSON = try JSONSerialization.jsonObject(with: JSONEncoder().encode(ledger)) as! [String: Any]
        legacyJSON.removeValue(forKey: "classificationVersion")
        try JSONSerialization.data(withJSONObject: legacyJSON).write(to: legacyFile)
        let legacyStore = FinanceStore(location: legacyFile)
        precondition(legacyStore.ledger.operations[0].manualCategory == true)
        precondition(legacyStore.saveRule(preset))
        precondition(legacyStore.ledger.operations[0].category == ledger.operations[0].category)
        precondition(legacyStore.saveRule(preset, replaceManual: true))
        precondition(FinanceStore(location: legacyFile).ledger.operations[0].category == "Еда дома")
        let beforeFailedRule = presetStore.ledger
        try FileManager.default.removeItem(at: presetFile)
        try FileManager.default.createDirectory(at: presetFile, withIntermediateDirectories: false)
        preset.category = "Не сохранить"
        precondition(!presetStore.saveRule(preset))
        precondition(presetStore.ledger.operations == beforeFailedRule.operations && presetStore.ledger.descriptionRules == beforeFailedRule.descriptionRules)
        let permissions = try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as! NSNumber
        precondition(permissions.intValue == 0o600)
        var unresolved = ledger.operations[0]
        unresolved.id = UUID()
        unresolved.kind = .review
        unresolved.details = "Внешний перевод по номеру телефона +79991234567"
        ledger.operations.append(unresolved)
        let ruleFile = directory.appendingPathComponent("rules.json")
        try JSONEncoder().encode(ledger).write(to: ruleFile)
        let ruleStore = FinanceStore(location: ruleFile)
        let party = transferParty(unresolved)!
        ruleStore.setTransferOwner(party, own: true)
        precondition(ruleStore.ledger.operations.last!.kind == .transfer)
        let reloadedRules = FinanceStore(location: ruleFile)
        precondition(reloadedRules.ledger.transferOwners?[party.id] == true)
        var manual = reloadedRules.ledger.operations.last!
        manual.kind = .outgoingTransfer
        precondition(reloadedRules.update(manual))
        reloadedRules.setTransferOwner(party, own: true)
        precondition(reloadedRules.ledger.operations.last!.kind == .outgoingTransfer)
        precondition(FinanceStore(location: ruleFile).ledger.operations.last!.kind == .outgoingTransfer)
        let phoneFile = directory.appendingPathComponent("own-phone.json")
        var foreign = unresolved; foreign.id = UUID(); foreign.details = "Внешний перевод по номеру телефона +79992222222"
        try JSONEncoder().encode(Ledger(operations: [unresolved, foreign])).write(to: phoneFile)
        let phoneStore = FinanceStore(location: phoneFile)
        precondition(!phoneStore.setOwnPhone("123"))
        precondition(phoneStore.ledger.otherPhonesArePeople != true)
        precondition(phoneStore.setOwnPhone("8 (999) 123-45-67"))
        let phoneReloaded = FinanceStore(location: phoneFile)
        precondition(phoneReloaded.ledger.ownPhoneIDs == ["phone|79991234567"])
        precondition(phoneReloaded.ledger.otherPhonesArePeople == true)
        precondition(phoneReloaded.ledger.operations[0].kind == .transfer && phoneReloaded.ledger.operations[1].kind == .outgoingTransfer)
        phoneStore.setOtherPhonesArePeople(false)
        precondition(FinanceStore(location: phoneFile).ledger.operations[1].kind == .review)
        phoneStore.setOtherPhonesArePeople(true)
        let unnamedOperations = phoneStore.ledger.operations
        let foreignParty = transferParty(foreign)!
        precondition(phoneStore.setPhoneName(foreignParty, name: "  Анна   Иванова "))
        precondition(phoneStore.ledger.operations == unnamedOperations)
        precondition(FinanceStore(location: phoneFile).ledger.phoneNames?[foreignParty.id] == "Анна Иванова")
        precondition(!phoneStore.setPhoneName(TransferParty(id: "phone|999***2222", label: "Неполный номер"), name: "Не сохранять"))
        let contact = phoneStore.ledger.phoneContacts.first { $0.name == "Анна Иванова" }!
        try snapshot(PeopleTransfersView(operations: phoneStore.ledger.operations, currency: "RUB").environmentObject(phoneStore),
                     width: 1150, height: 620, file: "build/preview-people.png")
        try snapshot(PersonTransfersView(contact: contact, operations: phoneStore.ledger.operations, currency: "RUB").environmentObject(phoneStore),
                     width: 1050, height: 620, file: "build/preview-person-transfers.png")
        try snapshot(PhoneNameEditor(party: foreignParty, name: "Анна Иванова").environmentObject(phoneStore),
                     width: 520, height: 320, file: "build/preview-phone-name.png")
        precondition(phoneStore.setPhoneName(foreignParty, name: ""))
        precondition(FinanceStore(location: phoneFile).ledger.phoneNames?[foreignParty.id] == nil)
        precondition(phoneStore.setPhoneName(foreignParty, name: "Анна Иванова"))
        try snapshot(TransferOwnersView().environmentObject(phoneStore), width: 800, height: 720, file: "build/preview-own-phone.png")
        precondition(phoneStore.resetAnalysis())
        let phoneReset = FinanceStore(location: phoneFile)
        precondition(phoneReset.ledger.operations.isEmpty && phoneReset.ledger.otherPhonesArePeople == true && phoneReset.ledger.ownPhoneIDs == ["phone|79991234567"])
        precondition(phoneReset.ledger.phoneNames?[foreignParty.id] == "Анна Иванова")
        phoneReset.setTransferOwner(party, own: nil)
        precondition(phoneReset.ledger.ownPhoneIDs.isEmpty && phoneReset.ledger.otherPhonesArePeople == false)
        phoneReset.setOtherPhonesArePeople(true)
        precondition(phoneReset.ledger.otherPhonesArePeople == false)
        try FileManager.default.removeItem(at: phoneFile)
        try FileManager.default.createDirectory(at: phoneFile, withIntermediateDirectories: false)
        precondition(!phoneReset.setOwnPhone("+79991234567"))
        precondition(phoneReset.ledger.ownPhoneIDs.isEmpty && phoneReset.ledger.otherPhonesArePeople == false)
        precondition(!phoneReset.setPhoneName(foreignParty, name: "Не сохранять"))
        precondition(phoneReset.ledger.phoneNames?[foreignParty.id] == "Анна Иванова")
        let resetDirectory = directory.appendingPathComponent("reset")
        try FileManager.default.createDirectory(at: resetDirectory, withIntermediateDirectories: true)
        let resetFile = resetDirectory.appendingPathComponent("ledger.json")
        var beforeReset = reloadedRules.ledger
        beforeReset.transferOwners?["account|Test|00000000000000000001"] = true
        beforeReset.transferOwners?["phone|79990000000"] = false
        beforeReset.descriptionRules = [DescriptionRule(description: "Будущая покупка", category: "Еда", kind: .expense)]
        beforeReset.imports = [ImportRecord(filename: "test.xlsx", digest: "original-digest", count: beforeReset.operations.count, warnings: [])]
        try JSONEncoder().encode(beforeReset).write(to: resetFile)
        let resetStore = FinanceStore(location: resetFile)
        resetStore.busy = true
        precondition(!resetStore.resetAnalysis())
        precondition(resetStore.ledger.operations == beforeReset.operations)
        resetStore.busy = false
        let backups = resetDirectory.appendingPathComponent("Backups")
        try Data("block backup directory".utf8).write(to: backups)
        precondition(!resetStore.resetAnalysis())
        precondition(resetStore.ledger.operations == beforeReset.operations)
        precondition(FinanceStore(location: resetFile).ledger.operations == beforeReset.operations)
        try FileManager.default.removeItem(at: backups)
        precondition(resetStore.resetAnalysis())
        precondition(resetStore.message == nil)
        let afterReset = FinanceStore(location: resetFile).ledger
        precondition(afterReset.operations.isEmpty && afterReset.imports.isEmpty && afterReset.transferOwners == [party.id: true])
        precondition(afterReset.descriptionRules == beforeReset.descriptionRules)
        let copies = try FileManager.default.contentsOfDirectory(at: backups, includingPropertiesForKeys: nil)
        precondition(copies.count == 1)
        let copy = try JSONDecoder().decode(Ledger.self, from: Data(contentsOf: copies[0]))
        precondition(copy.operations == beforeReset.operations && copy.transferOwners == beforeReset.transferOwners)
        precondition(copy.imports.map(\.digest) == beforeReset.imports.map(\.digest))
        let backupPermissions = try FileManager.default.attributesOfItem(atPath: copies[0].path)[.posixPermissions] as! NSNumber
        precondition(backupPermissions.intValue == 0o600)
        var reimport = afterReset
        try reimport.append(ParsedStatement(operations: [unresolved]), filename: "test.xlsx", digest: "original-digest")
        precondition(reimport.operations.count == 1)
        var future = unresolved; future.id = UUID(); future.details = "Будущая покупка"
        try reimport.append(ParsedStatement(operations: [future]), filename: "future.xlsx", digest: "future")
        precondition(reimport.operations.last!.category == "Еда")
        let broken = Data("broken".utf8)
        try broken.write(to: file)
        let corruptStore = FinanceStore(location: file)
        precondition(corruptStore.readOnly && corruptStore.message != nil)
        precondition(!corruptStore.update(edited))
        precondition(!corruptStore.resetAnalysis())
        let unchanged = try Data(contentsOf: file)
        precondition(unchanged == broken)

        let hosting = NSHostingView(rootView: FinanceView().environmentObject(store).frame(width: 1250, height: 850))
        let window = NSWindow(contentRect: CGRect(x: -10000, y: -10000, width: 1250, height: 850), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = hosting
        window.orderFront(nil)
        hosting.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.5))
        guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { throw FinanceError.message("Не удалось создать снимок") }
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        guard let png = bitmap.representation(using: .png, properties: [:]) else {
            throw FinanceError.message("Не удалось отрисовать интерфейс")
        }
        try png.write(to: URL(fileURLWithPath: "build/preview.png"))
        window.orderOut(nil)

        let calendar = Calendar.current
        let start = calendar.date(from: DateComponents(year: 2026, month: 10, day: 1))!
        let end = calendar.date(from: DateComponents(year: 2026, month: 10, day: 3))!
        try snapshot(FinanceView(period: "Диапазон дат", from: start, through: end).environmentObject(store),
                     width: 1250, height: 1200, file: "build/preview-range.png")
        try snapshot(FinanceView(period: "Диапазон дат", from: start, through: end, onlyReview: true).environmentObject(store),
                     width: 1250, height: 1200, file: "build/preview-range-review.png")
        let overviewImage = try Data(contentsOf: URL(fileURLWithPath: "build/preview-range.png"))
        let reviewOverviewImage = try Data(contentsOf: URL(fileURLWithPath: "build/preview-range-review.png"))
        precondition(overviewImage == reviewOverviewImage, "Review filter must not change the overview")
        var savingsDebit = ledger.operations[0]
        savingsDebit.id = UUID(); savingsDebit.kind = .savings; savingsDebit.manualKind = true
        savingsDebit.date = "2026-10-02"; savingsDebit.amount = -1250000
        savingsDebit.details = "Перевод на накопительный счёт"
        var savingsCredit = savingsDebit
        savingsCredit.id = UUID(); savingsCredit.amount = 1250000
        var olderSavings = savingsDebit
        olderSavings.id = UUID(); olderSavings.date = "2026-09-02"
        let savingsFile = directory.appendingPathComponent("savings-overview.json")
        try JSONEncoder().encode(Ledger(operations: ledger.operations + [savingsDebit, savingsCredit, olderSavings])).write(to: savingsFile)
        let savingsStore = FinanceStore(location: savingsFile)
        precondition(savingsStore.ledger.operations.filter { $0.date.hasPrefix("2026-10") }.reduce(Int64(0)) { $0 + $1.savingsAmount } == 1250000)
        try snapshot(FinanceView(period: "2026-10").environmentObject(savingsStore),
                     width: 1000, height: 850, file: "build/preview-savings.png")
        var chartSavings = savingsStore.ledger.operations
        var earlierSaving = savingsDebit; earlierSaving.id = UUID(); earlierSaving.date = "2026-08-15"; earlierSaving.amount = -500000
        chartSavings.append(earlierSaving)
        try snapshot(CashFlowCharts(operations: chartSavings, currency: "RUB", byMonth: true).padding(20)
            .background(Color(nsColor: .windowBackgroundColor)),
                     width: 1100, height: 1360, file: "build/preview-savings-charts.png")
        let savingsDay = PeriodOperationsView(selection: CashFlowSelection(period: "2026-10-02", measure: .savings), operations: chartSavings, currency: "RUB")
        precondition(savingsDay.items.count == 1 && savingsDay.amount == 1250000)
        try snapshot(savingsDay.environmentObject(savingsStore), width: 1050, height: 580, file: "build/preview-savings-day.png")
        let dailyTotals = cashFlow(store.ledger.operations)
        try snapshot(CashFlowCharts(operations: store.ledger.operations, currency: "RUB", byMonth: false)
            .padding(20).background(Color(nsColor: .windowBackgroundColor)),
                     width: 1100, height: 1360, file: "build/preview-daily-charts.png")
        var monthlyOperations = store.ledger.operations
        for month in ["2025-12", "2026-01", "2026-02", "2026-04", "2026-06", "2026-07", "2026-08"] {
            var operation = store.ledger.operations[1]
            operation.id = UUID(); operation.date = month + "-15"
            if month == "2026-02" { operation.kind = .income; operation.amount = 1200000 }
            if month == "2026-04" { operation.kind = .refund; operation.amount = 25000 }
            monthlyOperations.append(operation)
        }
        try snapshot(CashFlowCharts(operations: monthlyOperations, currency: "RUB", byMonth: true).padding(20)
            .background(Color(nsColor: .windowBackgroundColor)),
                     width: 1100, height: 1360, file: "build/preview-monthly-charts.png")
        try snapshot(CashFlowCharts(operations: monthlyOperations, currency: "RUB", byMonth: true, selectedCategory: "Транспорт").padding(20)
            .background(Color(nsColor: .windowBackgroundColor)),
                     width: 1100, height: 1360, file: "build/preview-monthly-category.png")
        try snapshot(CashFlowCharts(operations: [], currency: "RUB", byMonth: true).padding(20),
                     width: 1100, height: 400, file: "build/preview-monthly-empty.png")
        try snapshot(AmountChart(points: [ExpenseGroup(label: "2026-10", amount: 123456)], currency: "RUB", byMonth: true, measure: .expenses) { _ in }.padding(20)
            .background(Color(nsColor: .windowBackgroundColor)),
                     width: 1100, height: 400, file: "build/preview-monthly-single.png")
        let expenseMonth = PeriodOperationsView(selection: CashFlowSelection(period: "2026-10", category: "Транспорт"), operations: monthlyOperations, currency: "RUB")
        precondition(expenseMonth.items.count == 1 && expenseMonth.amount == 63000)
        try snapshot(expenseMonth.environmentObject(store), width: 1050, height: 580, file: "build/preview-category-month.png")
        let incomeDay = PeriodOperationsView(selection: CashFlowSelection(period: "2026-10-02", measure: .income), operations: store.ledger.operations, currency: "RUB")
        let expenseDay = PeriodOperationsView(selection: CashFlowSelection(period: "2026-10-02"), operations: store.ledger.operations, currency: "RUB")
        precondition(incomeDay.items.count == 1 && incomeDay.amount == 2000000)
        precondition(expenseDay.items.count == 1 && expenseDay.amount == 63000)
        precondition(incomeDay.amount == dailyTotals.first { $0.period == "2026-10-02" }?.income)
        precondition(expenseDay.amount == dailyTotals.first { $0.period == "2026-10-02" }?.expenses)
        try snapshot(incomeDay.environmentObject(store), width: 1050, height: 580, file: "build/preview-income-day.png")
        try snapshot(TransferOwnersView().environmentObject(ruleStore), width: 800, height: 720, file: "build/preview-transfers.png")

        try snapshot(OperationsView(operations: store.ledger.operations).environmentObject(store),
                     width: 1050, height: 580, file: "build/preview-operations.png")
        try snapshot(PeriodOperationsView(selection: CashFlowSelection(period: "2026-10-02"), operations: store.ledger.operations, currency: "RUB").environmentObject(store),
                     width: 1050, height: 580, file: "build/preview-day.png")

        try snapshot(OperationEditor(operation: store.ledger.operations[0]).environmentObject(store).background(Color(nsColor: .windowBackgroundColor)),
                     width: 320, height: 720, file: "build/preview-editor.png")

        var housingExpense = store.ledger.operations[3]; housingExpense.amount = -2000000
        var housingShop = housingExpense; housingShop.id = UUID(); housingShop.amount = -259900
        var housingRefund = housingExpense; housingRefund.id = UUID(); housingRefund.amount = 39587; housingRefund.kind = .refund
        var smallRefund = housingRefund; smallRefund.id = UUID(); smallRefund.amount = 2322
        let housing = [housingExpense, housingShop, housingRefund, smallRefund]
        let housingOut = PeriodOperationsView(selection: CashFlowSelection(period: housingExpense.date), operations: housing, currency: "RUB")
        let housingIn = PeriodOperationsView(selection: CashFlowSelection(period: housingExpense.date, measure: .income), operations: housing, currency: "RUB")
        precondition(housingOut.items.count == 2 && housingOut.amount == 2259900)
        precondition(housingIn.items.count == 2 && housingIn.amount == 41909)
        try snapshot(BreakdownOperationsView(selection: BreakdownSelection(label: "Жильё и ЖКХ", isIncome: true), operations: housing, currency: "RUB").environmentObject(store),
                     width: 1050, height: 580, file: "build/preview-refunds-income.png")
        let pieGroups = [ExpenseGroup(label: "Покупки", amount: 3500), ExpenseGroup(label: "Без категории", amount: 6500),
                         ExpenseGroup(label: "Отрицательный итог", amount: -2000), ExpenseGroup(label: "Нулевой итог", amount: 0)]
        let pie = CategoryPie(groups: pieGroups, currency: "RUB")
        precondition(pie.total == 10000 && pie.slices.count == 2)
        precondition(abs(pie.share(pieGroups[0]) - 0.35) < 0.000001 && pie.share(pieGroups[2]) == 0)
        precondition(pie.group(at: 0)?.label == "Покупки")
        precondition(pie.group(at: 3499.9)?.label == "Покупки")
        precondition(pie.group(at: 3500)?.label == "Без категории")
        precondition(pie.group(at: 9999.9)?.label == "Без категории")
        precondition(pie.group(at: 10000) == nil && pie.group(at: -1) == nil && pie.group(at: .nan) == nil && pie.group(at: .infinity) == nil)
        let plotFrame = CGRect(x: 20, y: 10, width: 320, height: 280)
        precondition(pie.group(at: CGPoint(x: 180, y: 20), in: plotFrame)?.label == "Покупки")
        precondition(pie.group(at: CGPoint(x: 310, y: 150), in: plotFrame)?.label == "Покупки")
        precondition(pie.group(at: CGPoint(x: 180, y: 280), in: plotFrame)?.label == "Без категории")
        precondition(pie.group(at: CGPoint(x: 50, y: 150), in: plotFrame)?.label == "Без категории")
        precondition(pie.group(at: CGPoint(x: 25, y: 15), in: plotFrame) == nil)
        precondition(pie.group(at: CGPoint(x: 180, y: 150), in: plotFrame) == nil)
        precondition(pie.group(at: .zero, in: .zero) == nil)
        let emptyPie = CategoryPie(groups: Array(pieGroups.suffix(2)), currency: "RUB")
        precondition(emptyPie.total == 0 && emptyPie.share(pieGroups[2]) == 0)
        precondition(emptyPie.group(at: CGPoint(x: 310, y: 150), in: plotFrame) == nil)
        try snapshot(pie.padding(20).background(Color(nsColor: .windowBackgroundColor)),
                     width: 1100, height: 350, file: "build/preview-pie-nonpositive.png")
        try snapshot(emptyPie.padding(20).background(Color(nsColor: .windowBackgroundColor)),
                     width: 1100, height: 350, file: "build/preview-pie-empty.png")

        try snapshot(DescriptionRulesView().environmentObject(legacyStore).background(Color(nsColor: .windowBackgroundColor)),
                     width: 1250, height: 800, file: "build/preview-groups.png")
        try snapshot(DescriptionRulesView(mode: "Пресет").environmentObject(legacyStore).background(Color(nsColor: .windowBackgroundColor)),
                     width: 1250, height: 800, file: "build/preview-preset.png")
        try snapshot(DescriptionRuleEditor(rule: legacyStore.ledger.descriptionRules![0]).environmentObject(legacyStore),
                     width: 1168, height: 768, file: "build/preview-rule.png")

        var metro = ledger.operations[0]
        metro.details = "Операция по карте: 000000******1111, дата создания транзакции: 10-10-2026, место совершения операции: RU/Novosibirsk/TPP_METRO_NOVOSIBIRSK, MCC: 4131"
        var metro2 = metro; metro2.id = UUID(); metro2.date = "2026-10-11"
        metro2.details = metro.details.replacingOccurrences(of: "10-10-2026", with: "11-10-2026")
        let metroRule1 = DescriptionRule(description: metro.details, category: "Транспорт", kind: .expense)
        let metroRule2 = DescriptionRule(description: metro2.details, category: "Транспорт", kind: .expense)
        let metroFile = directory.appendingPathComponent("metro.json")
        try JSONEncoder().encode(Ledger(operations: [metro, metro2], descriptionRules: [metroRule1, metroRule2])).write(to: metroFile)
        let metroStore = FinanceStore(location: metroFile)
        precondition(!metroStore.readOnly && metroStore.ledger.descriptionRules == [metroRule1])
        precondition(descriptionGroups(metroStore.ledger.operations).count == 1)
        precondition(metroStore.ledger.operations.allSatisfy { $0.category == "Транспорт" })
        let savedMetro = try JSONDecoder().decode(Ledger.self, from: Data(contentsOf: metroFile))
        precondition(savedMetro.descriptionRules == [metroRule1])
        precondition(FinanceStore(location: metroFile).ledger.operations == metroStore.ledger.operations)
        try snapshot(DescriptionRulesView().environmentObject(metroStore).background(Color(nsColor: .windowBackgroundColor)),
                     width: 1250, height: 800, file: "build/preview-metro-group.png")
        var conflictingMetroRule = metroRule2; conflictingMetroRule.category = "Личное"
        let metroConflictFile = directory.appendingPathComponent("metro-conflict.json")
        try JSONEncoder().encode(Ledger(operations: [metro, metro2], descriptionRules: [metroRule1, conflictingMetroRule])).write(to: metroConflictFile)
        let metroConflictStore = FinanceStore(location: metroConflictFile)
        precondition(metroConflictStore.ledger.descriptionRules?.count == 2)
        precondition(metroConflictStore.ledger.operations.map(\.category) == ["Транспорт", "Личное"])
        try snapshot(DescriptionRuleEditor(rule: metroRule1).environmentObject(metroConflictStore),
                     width: 1168, height: 768, file: "build/preview-metro-conflict.png")

        var merchant = ledger.operations[0]; merchant.details = "Оплата в Vilka Lozhka Novosibirsk RUS"
        var variant = merchant; variant.id = UUID(); variant.details = "Оплата в VILKA-LOZKA Novosibirsk RUS"
        let merchantRule = DescriptionRule(description: merchant.details, category: "Кафе и рестораны", kind: .expense)
        let variantFile = directory.appendingPathComponent("variants.json")
        try JSONEncoder().encode(Ledger(operations: [merchant, variant], descriptionRules: [merchantRule])).write(to: variantFile)
        let variantStore = FinanceStore(location: variantFile)
        let variantGroups = descriptionGroups(variantStore.ledger.operations, rules: variantStore.ledger.descriptionRules ?? [])
        let sourceGroup = variantGroups.first { $0.description == variant.details }!
        try snapshot(MergeDescriptionGroupsView(source: sourceGroup, targetID: merchantRule.key).environmentObject(variantStore),
                     width: 1048, height: 698, file: "build/preview-merge-groups.png")
        precondition(variantStore.mergeDescriptionGroups(sourceID: sourceGroup.id, targetID: merchantRule.key))
        let savedVariants = FinanceStore(location: variantFile).ledger
        precondition(savedVariants.descriptionRules?.first?.alternateDescriptions == [variant.details])
        precondition(savedVariants.operations.allSatisfy { $0.category == merchantRule.category })
        precondition(descriptionGroups(savedVariants.operations, rules: savedVariants.descriptionRules ?? []).count == 1)
        try snapshot(DescriptionRulesView().environmentObject(variantStore).background(Color(nsColor: .windowBackgroundColor)),
                     width: 1250, height: 800, file: "build/preview-merged-group.png")
        try snapshot(DescriptionRuleEditor(rule: savedVariants.descriptionRules![0]).environmentObject(variantStore),
                     width: 1168, height: 768, file: "build/preview-variant-rule.png")
        precondition(variantStore.resetAnalysis())
        precondition(variantStore.ledger.descriptionRules == savedVariants.descriptionRules)
        var nextImport = variantStore.ledger
        try nextImport.append(ParsedStatement(operations: [variant]), filename: "next", digest: "next")
        precondition(nextImport.operations.first?.category == merchantRule.category)
        let failedMergeFile = directory.appendingPathComponent("failed-merge.json")
        try JSONEncoder().encode(Ledger(operations: [merchant, variant], descriptionRules: [merchantRule])).write(to: failedMergeFile)
        let failedMergeStore = FinanceStore(location: failedMergeFile)
        let beforeMerge = failedMergeStore.ledger
        try FileManager.default.removeItem(at: failedMergeFile)
        try FileManager.default.createDirectory(at: failedMergeFile, withIntermediateDirectories: false)
        precondition(!failedMergeStore.mergeDescriptionGroups(sourceID: sourceGroup.id, targetID: merchantRule.key))
        precondition(failedMergeStore.ledger.operations == beforeMerge.operations && failedMergeStore.ledger.descriptionRules == beforeMerge.descriptionRules)

        var salary = ledger.operations.first { $0.kind == .income }!; salary.details = "Пополнение. Зарплата. ООО \"Пример.Технологии\""
        var salary2 = salary; salary2.id = UUID(); salary2.details = "Пополнение. ООО «Пример.Технологии». Зарплата"
        let salaryRule = DescriptionRule(description: salary.details, debit: false, category: "Зарплата", kind: .income)
        let salaryRule2 = DescriptionRule(description: salary2.details, debit: false, category: "Зарплата", kind: .income)
        let salaryFile = directory.appendingPathComponent("salary.json")
        try JSONEncoder().encode(Ledger(operations: [salary, salary2], descriptionRules: [salaryRule, salaryRule2])).write(to: salaryFile)
        let salaryStore = FinanceStore(location: salaryFile)
        precondition(!salaryStore.readOnly && salaryStore.ledger.descriptionRules == [salaryRule])
        precondition(descriptionGroups(salaryStore.ledger.operations, rules: salaryStore.ledger.descriptionRules ?? []).count == 1)
        precondition(salaryStore.ledger.operations.allSatisfy { $0.category == "Зарплата" })
        precondition(FinanceStore(location: salaryFile).ledger.descriptionRules == [salaryRule])
        try snapshot(DescriptionRulesView().environmentObject(salaryStore).background(Color(nsColor: .windowBackgroundColor)),
                     width: 1250, height: 800, file: "build/preview-salary-group.png")

        var sbp = ledger.operations[0]; sbp.amount = 5000; sbp.kind = .review
        sbp.details = "Категория: Перевод по СБП.Перевод C1000000000001 через Систему быстрых платежей от +79991234567. Без НДС."
        var sbp2 = sbp; sbp2.id = UUID(); sbp2.details = sbp.details.replacingOccurrences(of: "C1000000000001", with: "C1000000000002")
        let sbpRule = DescriptionRule(description: sbp.details, debit: false, category: "Поступления", kind: .incomingTransfer)
        let sbpRule2 = DescriptionRule(description: sbp2.details, debit: false, category: sbpRule.category, kind: sbpRule.kind)
        let sbpFile = directory.appendingPathComponent("sbp.json")
        try JSONEncoder().encode(Ledger(operations: [sbp, sbp2], descriptionRules: [sbpRule, sbpRule2])).write(to: sbpFile)
        let sbpStore = FinanceStore(location: sbpFile)
        precondition(sbpStore.ledger.descriptionRules == [sbpRule])
        precondition(descriptionGroups(sbpStore.ledger.operations).count == 1)
        precondition(FinanceStore(location: sbpFile).ledger.descriptionRules == [sbpRule])
        try snapshot(DescriptionRulesView().environmentObject(sbpStore).background(Color(nsColor: .windowBackgroundColor)),
                     width: 1250, height: 800, file: "build/preview-sbp-group.png")

        let incomeGroups = groupedIncome(store.ledger.operations)
        var mergedIncomeItems = [Operation]()
        for description in ["Перевод с договора 1234567890", "Перевод с договора 9876543210", "Кэшбэк за обычные покупки", "Кэшбэк за покупки у партнеров", sbp.details, sbp2.details] {
            var operation = sbp; operation.id = UUID(); operation.details = description
            operation.kind = .income; operation.manualKind = true; operation.category = "Доходы"
            mergedIncomeItems.append(operation)
        }
        let mergedIncomeFile = directory.appendingPathComponent("merged-income.json")
        try JSONEncoder().encode(Ledger(operations: mergedIncomeItems, phoneNames: ["phone|79991234567": "Анна Иванова"])).write(to: mergedIncomeFile)
        let mergedIncomeStore = FinanceStore(location: mergedIncomeFile)
        let mergedIncome = groupedIncome(mergedIncomeStore.ledger.operations, phoneNames: mergedIncomeStore.ledger.phoneNames ?? [:])
        precondition(mergedIncome.count == 3)
        try snapshot(CategoryPie(groups: mergedIncome, currency: "RUB", isIncome: true).padding(20).background(Color(nsColor: .windowBackgroundColor)),
                     width: 1100, height: 420, file: "build/preview-merged-income.png")
        try snapshot(BreakdownOperationsView(selection: BreakdownSelection(label: "Переводы · Анна Иванова", isIncome: true), operations: mergedIncomeStore.ledger.operations, currency: "RUB").environmentObject(mergedIncomeStore),
                     width: 1050, height: 580, file: "build/preview-named-income.png")
        try snapshot(CategoryPie(groups: incomeGroups, currency: "RUB", isIncome: true).padding(20).background(Color(nsColor: .windowBackgroundColor)),
                     width: 1100, height: 350, file: "build/preview-income.png")
        try snapshot(CategoryPie(groups: [], currency: "RUB", isIncome: true).padding(20).background(Color(nsColor: .windowBackgroundColor)),
                     width: 1100, height: 350, file: "build/preview-income-empty.png")
        try snapshot(BreakdownOperationsView(selection: BreakdownSelection(label: "Без категории", isIncome: false), operations: store.ledger.operations, currency: "RUB").environmentObject(store),
                     width: 1050, height: 580, file: "build/preview-category-details.png")
        try snapshot(BreakdownOperationsView(selection: BreakdownSelection(label: "Зарплата", isIncome: true), operations: store.ledger.operations, currency: "RUB").environmentObject(store),
                     width: 1050, height: 580, file: "build/preview-income-details.png")

        let largeRules = (0..<240).map { index in
            DescriptionRule(description: "Оплата в PERFORMANCE SHOP \(index) Novosibirsk RUS", category: "Категория \(index % 12)", kind: .expense)
        }
        let largeOperations = (0..<4800).map { index in
            Operation(date: "2026-10-10", bank: "Test", account: "Test", details: largeRules[index % largeRules.count].description,
                      amount: -10000, currency: "RUB", category: "Без категории", kind: .expense, source: "Synthetic", sourceRow: String(index))
        }
        let largeFile = directory.appendingPathComponent("large-presets.json")
        try JSONEncoder().encode(Ledger(operations: largeOperations, descriptionRules: largeRules)).write(to: largeFile)
        let largeStore = FinanceStore(location: largeFile)
        precondition(!largeStore.readOnly)
        var largeEdit = largeRules[0]; largeEdit.category = "Изменено"
        let saveStart = Date()
        precondition(largeStore.saveRule(largeEdit))
        print("Large preset save including JSON (4800 operations, 240 rules): \(String(format: "%.3f", Date().timeIntervalSince(saveStart)))s")
        precondition(FinanceStore(location: largeFile).ledger.operations.filter { $0.category == "Изменено" }.count == 20)
        try snapshot(DescriptionRulesView(mode: "Пресет").environmentObject(largeStore).background(Color(nsColor: .windowBackgroundColor)),
                     width: 1250, height: 800, file: "build/preview-large-presets.png")
        try snapshot(DescriptionRuleEditor(rule: largeEdit).environmentObject(largeStore),
                     width: 1168, height: 768, file: "build/preview-large-rule.png")

        let pdf = try syntheticPDF(directory)
        try pdf.write(to: URL(fileURLWithPath: "build/synthetic.pdf"))
        let parsed = try parseStatement(pdf, filename: "test.pdf")
        precondition(parsed.operations.count == 1)
        precondition(parsed.operations[0].amount == -92500)
        precondition(parsed.operations[0].currency == "RUB")
        precondition(parsed.operations[0].details == "Оплата в CAFE Вторая строка")
        precondition(parsed.warnings.isEmpty)
        let separateTotalsPDF = try syntheticPDF(directory, separateTotals: true)
        let separateTotals = try parseStatement(separateTotalsPDF, filename: "separate-totals.pdf")
        precondition(separateTotals.operations.count == 1 && separateTotals.operations[0].amount == -92500)
        precondition(separateTotals.operations[0].details == parsed.operations[0].details && separateTotals.warnings.isEmpty)
        for invalidPDF in [
            try syntheticPDF(directory, separateTotals: true, totalExpense: "926,00 ₽"),
            try syntheticPDF(directory, separateTotals: true, summaryHasOperation: true)
        ] {
            var rejected = false
            do { _ = try parseStatement(invalidPDF, filename: "invalid-summary.pdf") } catch { rejected = true }
            precondition(rejected, "Invalid totals or a headerless operation page must not be skipped")
        }
        print("PASS: preset persistence, migration, exceptions, reset preservation, failed rule protection, persistence, immediate edits, failed edit protection, edit, reset with backup, backup failure protection, reset guards, reimport, permissions, UI rendering, multiline/foreign-currency PDF")
    }

    @MainActor static func transferOwnersPerformance(file: URL) throws {
        let operations = (0..<1500).map { index in
            Operation(date: "2026-10-10", bank: "Test", account: "test",
                      details: "Внешний перевод по номеру телефона +\(79990000000 + index % 80)",
                      amount: -10000, currency: "RUB", category: "Переводы", kind: .review,
                      source: "test", sourceRow: String(index))
        }
        try JSONEncoder().encode(Ledger(operations: operations)).write(to: file)
        let store = FinanceStore(location: file)
        let start = Date()
        let hosting = NSHostingView(rootView: TransferOwnersView().environmentObject(store))
        let window = NSWindow(contentRect: CGRect(x: -10000, y: -10000, width: 800, height: 720), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = hosting
        window.orderFront(nil)
        hosting.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        let opening = Date().timeIntervalSince(start)
        let party = transferParty(operations[0])!
        precondition(store.transferOwnerRows.count == 80 && store.transferOwnerRows.first { $0.id == party.id }?.count == 19)
        let editStart = Date()
        store.setTransferOwner(party, own: false)
        let saveTime = Date().timeIntervalSince(editStart)
        hosting.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        let editing = Date().timeIntervalSince(editStart)
        window.orderOut(nil)
        print(String(format: "Transfer owners (1500 operations, 80 parties): open %.3fs, edit %.3fs (save %.3fs)", opening, editing, saveTime))
        fflush(stdout)
        precondition(opening < 1.5 && editing < 1, "Transfer owners UI blocks the main thread")
        let repeatStart = Date()
        for _ in 0..<100 { precondition(store.transferOwnerRows.count == 80) }
        precondition(Date().timeIntervalSince(repeatStart) < 0.1, "Typing must reuse the owner list")
        let newParty = TransferParty(id: "phone|79999999999", label: "Телефон +79999999999")
        precondition(store.setPhoneName(newParty, name: "Новый человек"))
        precondition(store.transferOwnerRows.count == 81 && store.transferOwnerRows.first { $0.id == newParty.id }?.count == 0)
        precondition(store.edit(operations[0].id) { $0.details = "Внешний перевод по номеру телефона +79999999999" })
        precondition(store.transferOwnerRows.first { $0.id == newParty.id }?.count == 1)
        precondition(store.transferOwnerRows.first { $0.id == party.id }?.count == 18)
        precondition(store.setOwnPhone("+79998888888"))
        precondition(store.transferOwnerRows.count == 82)
        precondition(store.resetAnalysis())
        precondition(store.transferOwnerRows.count == 2 && store.transferOwnerRows.allSatisfy { $0.count == 0 })
        try FileManager.default.removeItem(at: file)
        try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
        precondition(!store.setPhoneName(TransferParty(id: "phone|79997777777", label: "Новый номер"), name: "Ошибка"))
        precondition(store.transferOwnerRows.count == 2)
    }

    @MainActor static func snapshot<V: View>(_ view: V, width: CGFloat, height: CGFloat, file: String) throws {
        let hosting = NSHostingView(rootView: view.frame(width: width, height: height))
        let window = NSWindow(contentRect: CGRect(x: -10000, y: -10000, width: width, height: height), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = hosting
        window.orderFront(nil)
        hosting.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { throw FinanceError.message("Snapshot failed") }
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        guard let png = bitmap.representation(using: .png, properties: [:]) else { throw FinanceError.message("PNG failed") }
        try png.write(to: URL(fileURLWithPath: file))
        window.orderOut(nil)
    }

    @MainActor static func syntheticPDF(_ directory: URL, separateTotals: Bool = false, totalExpense: String = "925,00 ₽", summaryHasOperation: Bool = false) throws -> Data {
        let url = directory.appendingPathComponent("synthetic.pdf")
        var bounds = CGRect(x: 0, y: 0, width: 595, height: 842)
        guard let context = CGContext(url as CFURL, mediaBox: &bounds, nil) else { throw FinanceError.message("PDF context") }
        context.beginPDFPage(nil)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        func draw(_ value: String, _ x: CGFloat, _ y: CGFloat, size: CGFloat = 9) {
            (value as NSString).draw(at: CGPoint(x: x, y: y), withAttributes: [.font: NSFont(name: "Arial", size: size)!])
        }
        draw("АО ТБанк", 56, 780)
        draw("Справка о движении средств", 56, 750)
        draw("Номер лицевого счета: 00000000000000000001", 56, 720)
        draw("Дата и время", 56, 680)
        draw("Дата", 126, 680)
        draw("Сумма в валюте", 199, 680)
        draw("Сумма операции", 294, 680)
        draw("Описание", 389, 680)
        draw("Номер", 499, 680)
        draw("операции", 56, 668)
        draw("списания", 126, 668)
        draw("операции", 199, 668)
        draw("в валюте карты", 294, 668)
        draw("операции", 389, 668)
        draw("карты", 499, 668)
        draw("01.10.2026", 56, 640)
        draw("12:30", 56, 628)
        draw("02.10.2026", 126, 640)
        draw("-10.00 USD", 199, 640)
        draw("-925.00 ₽", 294, 640)
        draw("Оплата в CAFE", 389, 640)
        draw("Вторая строка", 389, 628)
        draw("1234", 499, 640)
        if separateTotals {
            draw("АО ТБанк универсальная лицензия", 106, 50)
            NSGraphicsContext.restoreGraphicsState()
            context.endPDFPage()
            context.beginPDFPage(nil)
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
            draw("С уважением,", 56, 500)
            if summaryHasOperation {
                draw("02.10.2026", 56, 680)
                draw("-1,00 ₽", 294, 680)
                draw("Оплата в CAFE", 389, 680)
            }
        }
        draw("Пополнения:", 56, 600)
        draw("0,00 ₽", 126, 600)
        draw("Расходы:", 56, 580)
        draw(totalExpense, 126, 580)
        draw("АО ТБанк универсальная лицензия", 106, 50)
        NSGraphicsContext.restoreGraphicsState()
        context.endPDFPage()
        context.closePDF()
        return try Data(contentsOf: url)
    }
}
