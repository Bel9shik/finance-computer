import Foundation

@main
struct Tests {
    static var checks = 0
    static func check(_ condition: @autoclosure () throws -> Bool, _ name: String) throws {
        checks += 1
        if try !condition() { throw FinanceError.message("FAIL: \(name)") }
    }
    static func fails(_ name: String, _ action: () throws -> Void) throws {
        var failed = false
        do { try action() } catch { failed = true }
        try check(failed, name)
    }
    static func sample(_ amount: Int64 = -1000, kind: OperationKind = .expense) -> Operation {
        Operation(date: "2026-10-01", bank: "Test", account: "0001", details: "Магазин", amount: amount,
                  currency: "RUB", category: "Продукты", kind: kind, source: "test", sourceRow: "1")
    }

    static func testPeriodCashFlow() throws {
        var food = sample(-10000); food.date = "2025-12-31"
        var refund = sample(2500, kind: .refund); refund.date = food.date
        var other = sample(-2000); other.date = "2026-01-02"; other.category = "Моя категория"
        var income = sample(100000, kind: .income); income.date = "2026-02-03"
        var refundOnly = sample(3000, kind: .refund); refundOnly.date = "2026-04-01"
        var unknown = sample(-500, kind: .review); unknown.date = other.date; unknown.category = "Без категории"
        var ignored = sample(-90000, kind: .excluded); ignored.date = food.date
        var savings = ignored; savings.kind = .savings
        var own = ignored; own.kind = .transfer
        var hold = ignored; hold.kind = .pending
        let operations = [refundOnly, food, other, income, refund, unknown, ignored, savings, own, hold]
        let months = cashFlow(operations, byMonth: true)
        try check(months.map(\.period) == ["2025-12", "2026-01", "2026-02", "2026-04"], "Monthly expenses sort across years without inventing missing months")
        try check(months.map(\.expenses) == [10000, 2500, 0, 0], "Monthly expenses exclude refunds, income, savings, transfers and HOLD")
        try check(months.reduce(0) { $0 + $1.expenses } == operations.reduce(0) { $0 + $1.expenseAmount }, "Monthly total reconciles with overview")
        try check(cashFlow(operations, byMonth: true, expenseCategory: "Продукты").map(\.expenses) == [10000, 0, 0, 0], "Category history retains available months with no category spending")
        try check(cashFlow(operations, byMonth: true, expenseCategory: "Моя категория").map(\.expenses) == [0, 2000, 0, 0], "Custom category history")
        try check(cashFlow(operations, byMonth: true, expenseCategory: "Без категории").map(\.expenses) == [0, 500, 0, 0], "Uncategorized review expenses remain counted")
        try check(cashFlow(operations.filter { $0.date.hasPrefix("2026-01") }, byMonth: true).map(\.expenses) == [2500], "Monthly graph respects supplied period filter")
        try check(months.map(\.income) == [2500, 0, 100000, 3000], "Monthly income includes refunds and excludes own movements")
        let categoryHistory = cashFlow(operations, byMonth: true, expenseCategory: "Моя категория")
        try check(categoryHistory.map(\.income) == months.map(\.income), "Expense category does not filter income")
        let january = operations.filter { $0.date.hasPrefix("2026-01") }
        let days = cashFlow(january, expenseCategory: "Моя категория")
        try check(days.map(\.period) == ["2026-01-02"] && days.map(\.expenses) == [2000], "Month view uses daily totals for selected category")
        try check(cashFlow(january, expenseCategory: "Нет покупок").map(\.expenses) == [0], "Category without spending retains zero on the timeline")
        for byMonth in [false, true] {
            for category in [nil, "Продукты", "Без категории"] as [String?] {
                for point in cashFlow(operations, byMonth: byMonth, expenseCategory: category) {
                    let expenseItems = CashFlowSelection(period: point.period, category: category).operations(in: operations)
                    let incomeItems = CashFlowSelection(period: point.period, measure: .income, category: category).operations(in: operations)
                    try check(expenseItems.reduce(0) { $0 + $1.expenseAmount } == point.expenses, "Expense drilldown reconciles with day/month and category")
                    try check(incomeItems.reduce(0) { $0 + $1.incomeAmount } == point.income, "Income drilldown ignores expense category and reconciles with chart")
                }
            }
        }
        try check(cashFlow([], byMonth: true, expenseCategory: "Продукты").isEmpty, "Empty monthly history")
    }

    static func testSavingsHistory() throws {
        var december = sample(-10000, kind: .savings); december.date = "2025-12-31"
        var january = sample(-25000, kind: .savings); january.date = "2026-01-03"
        var second = sample(-5000, kind: .savings); second.date = january.date
        var receipt = january; receipt.amount = 25000
        var expense = sample(-2000); expense.date = "2026-02-01"
        var foreign = january; foreign.currency = "USD"
        var otherBank = january; otherBank.bank = "Other"
        let all = [december, january, second, receipt, expense, foreign, otherBank]
        let filtered = all.filter { $0.currency == "RUB" && $0.bank == "Test" }
        let months = cashFlow(filtered, byMonth: true, expenseCategory: "Нет такой категории")
        try check(months.map(\.period) == ["2025-12", "2026-01", "2026-02"], "Savings history sorts years and retains loaded months with zero savings")
        try check(months.map(\.savings) == [10000, 30000, 0], "Savings history ignores expense category and receipt counterpart")
        try check(months.reduce(0) { $0 + $1.savings } == filtered.reduce(0) { $0 + $1.savingsAmount }, "Savings history reconciles with overview after bank/currency filters")
        let januaryItems = filtered.filter { $0.date.hasPrefix("2026-01") }
        let days = cashFlow(januaryItems)
        try check(days.count == 1 && days[0].period == "2026-01-03" && days[0].savings == 30000, "Savings aggregate multiple transfers within a day")
        for monthly in [false, true] {
            for point in cashFlow(filtered, byMonth: monthly) {
                let selection = CashFlowSelection(period: point.period, measure: .savings, category: "Не влияет")
                let items = selection.operations(in: filtered)
                try check(items.reduce(0) { $0 + $1.savingsAmount } == point.savings, "Savings click-through reconciles with point")
                try check(items.allSatisfy { $0.kind == .savings && $0.amount < 0 }, "Savings click-through includes only outgoing savings")
            }
        }
        try check(CashFlowSelection(period: "2026-02", measure: .savings).operations(in: filtered).isEmpty, "Zero savings point opens empty list")
        try check(cashFlow([]).isEmpty, "Empty savings history")
    }

    static func testReviewStatus() throws {
        var operation = sample(2200, kind: .excluded)
        operation.details = "Пополнение. Система быстрых платежей"
        operation.category = "Без категории"
        try check(!operation.needsReview, "Excluded uncategorized receipt is already resolved")
        operation.possibleDuplicate = true
        try check(!operation.needsReview, "Excluded duplicate does not need another review")
        operation.kind = .income
        try check(operation.needsReview, "Active duplicate or uncategorized receipt still needs review")
        operation.possibleDuplicate = false
        operation.category = "Зарплата"
        try check(!operation.needsReview, "Categorized income is resolved")
        operation.kind = .review
        try check(operation.needsReview, "Review kind still requires review despite category")
        operation.kind = .expense; operation.possibleDuplicate = true
        try check(operation.needsReview, "Active categorized duplicate still requires review")
        operation.category = "Без категории"; operation.possibleDuplicate = false
        for kind in [OperationKind.transfer, .savings] {
            operation.kind = kind
            try check(!operation.needsReview, "Own transfers and savings do not require an expense category")
            operation.possibleDuplicate = true
            try check(operation.needsReview, "Possible duplicate remains reviewable even for own transfers")
            operation.possibleDuplicate = false
        }
        operation.kind = .outgoingTransfer
        try check(operation.needsReview, "Outgoing personal transfers still need a category")
        operation.kind = .review
        try check(operation.needsReview, "Unresolved transfer must remain reviewable")
    }

    static func testPhoneContacts() throws {
        var sent = sample(-1000, kind: .outgoingTransfer); sent.date = "2026-01-01"
        sent.details = "Внешний перевод по номеру телефона +79991111111"
        var received = sent; received.id = UUID(); received.amount = 400; received.kind = .incomingTransfer
        received.details = "Перевод через Систему быстрых платежей от 8 (999) 111-11-11. Без НДС."
        var second = sent; second.id = UUID(); second.amount = -700; second.bank = "Other"
        second.details = "Внешний перевод по номеру телефона +79992222222"
        var refund = received; refund.id = UUID(); refund.amount = 100; refund.kind = .refund
        var excluded = received; excluded.id = UUID(); excluded.kind = .excluded
        var hold = sent; hold.id = UUID(); hold.kind = .pending
        var foreign = received; foreign.id = UUID(); foreign.currency = "USD"
        var later = received; later.id = UUID(); later.date = "2026-02-01"
        var unnamed = sent; unnamed.id = UUID(); unnamed.details = "Внешний перевод по номеру телефона +79993333333"
        var masked = sent; masked.id = UUID(); masked.details = "Внешний перевод по номеру телефона 999***1111"
        let items = [sent, received, second, refund, excluded, hold, foreign, later, unnamed, masked]
        var ledger = Ledger(operations: items, phoneNames: ["phone|79991111111": "Анна", "phone|79992222222": " анна ", "phone|79994444444": "Борис"])
        let contacts = ledger.phoneContacts
        try check(contacts.count == 3, "Names combine phones, unnamed phones and saved contacts remain visible")
        try check(contacts.map(\.id) == ["name|анна", "name|борис", "phone|79993333333"], "Named contacts sort alphabetically before unknown phones")
        try check(ledger.recipientLabel(for: sent) == "Кому: Анна · +79991111111", "Expense recipient includes saved name and actual destination phone")
        try check(ledger.recipientLabel(for: second) == "Кому: анна · +79992222222", "Grouped person's second number keeps actual transfer destination")
        try check(ledger.recipientLabel(for: unnamed) == nil && ledger.recipientLabel(for: masked) == nil, "Unknown and masked recipients are not guessed")
        try check(ledger.recipientLabel(for: received) == nil && ledger.recipientLabel(for: sample()) == nil, "Incoming transfers and purchases are not labeled as outgoing recipients")
        let anna = contacts.first { $0.id == "name|анна" }!
        try check(anna.phoneIDs == ["phone|79991111111", "phone|79992222222"], "Same normalized name combines two phone numbers")
        let filtered = items.filter { $0.currency == "RUB" && dateMatches($0.date, period: "2026-01", from: "", through: "") }
        let transfers = anna.transfers(in: filtered)
        try check(Set(transfers.map(\.id)) == Set([sent.id, received.id, second.id, refund.id]), "Person report excludes masked, other contacts, hold, excluded, other currency and period")
        try check(transfers.filter { $0.amount < 0 }.reduce(0) { $0 - $1.amount } == 1700, "Person sent total uses all matching numbers")
        try check(transfers.filter { $0.amount > 0 }.reduce(0) { $0 + $1.amount } == 500, "Person received total includes actual refund")
        try check(anna.transfers(in: filtered.filter { $0.bank == "Test" }).count == 3, "Person report respects bank filter")
        try check(contacts.first { $0.id == "name|борис" }!.transfers(in: items).isEmpty, "Saved person without operations has an empty report")
        ledger.phoneNames?["phone|79992222222"] = "Борис"
        try check(ledger.recipientLabel(for: second) == "Кому: Борис · +79992222222", "Recipient label follows name edits")
        try check(ledger.phoneContacts.first { $0.id == "name|анна" }!.phoneIDs.count == 1, "Renaming a number moves it to another person")
        ledger.phoneNames?["phone|79991111111"] = nil
        try check(ledger.recipientLabel(for: sent) == nil && ledger.phoneContacts.first?.name == "Борис", "Removing name clears recipient label and moves unknown phone below named people")
        try check(ledger.phoneContacts.contains { $0.id == "phone|79991111111" }, "Removing a name keeps the phone and its history")
        let restored = try JSONDecoder().decode(Ledger.self, from: JSONEncoder().encode(ledger))
        try check(restored.phoneNames == ledger.phoneNames && restored.operations == items, "Contact names persist without changing operations")
        let old = try JSONDecoder().decode(Ledger.self, from: JSONEncoder().encode(Ledger(operations: [sent])))
        try check(old.phoneNames == nil && old.phoneContacts.count == 1, "Legacy ledger without names still exposes phone history")
    }

    static func testPhonePolicy() throws {
        try check(normalizedPhoneNumber(" 8 (999) 111-11-11 ") == "79991111111", "Own phone normalizes 8 and formatting")
        try check(normalizedPhoneNumber("+79991111111") == "79991111111", "Own phone accepts +7")
        for invalid in ["", "9991111111", "+7999***1111", "+799911111111", "text79991111111", "+79991111111ext"] {
            try check(normalizedPhoneNumber(invalid) == nil, "Invalid own phone rejected")
        }
        var mine = sample(-1000, kind: .review); mine.category = "Без категории"
        mine.details = "Внешний перевод по номеру телефона +79991111111"
        var other = mine; other.id = UUID(); other.details = "Внешний перевод по номеру телефона +79992222222"
        var incoming = other; incoming.id = UUID(); incoming.amount = 2000
        incoming.details = "Перевод через Систему быстрых платежей от +79992222222. Без НДС."
        var masked = other; masked.id = UUID(); masked.details = "Внешний перевод по номеру телефона 999***2222"
        var contract = other; contract.id = UUID(); contract.details = "Внутренний перевод на договор 1234567890"
        var gift = other; gift.id = UUID(); gift.category = "Подарки"; gift.manualCategory = true
        var manual = other; manual.id = UUID(); manual.kind = .transfer; manual.manualKind = true
        var protected = [Operation]()
        for kind in [OperationKind.refund, .excluded, .savings, .pending] {
            var item = other; item.id = UUID(); item.kind = kind; protected.append(item)
        }
        var ledger = Ledger(operations: [mine, other, incoming, masked, contract, gift, manual] + protected,
                            transferOwners: ["phone|79991111111": true])
        ledger.reclassify()
        let original = ledger.operations
        try check(ledger.operations[1].kind == .review, "Other phones remain unresolved by default")
        ledger.otherPhonesArePeople = true
        ledger.reclassify()
        try check(ledger.operations[0].kind == .transfer && ledger.operations[1].kind == .outgoingTransfer && ledger.operations[2].kind == .incomingTransfer, "Own phone and all other phone directions")
        try check(ledger.operations[1].category == "Переводы людям" && ledger.operations[2].category == "Переводы от людей", "Automatic phone categories resolve review")
        try check(!ledger.operations[1].needsReview && !ledger.operations[2].needsReview, "Recognized phone transfers need no category review")
        try check(ledger.operations[3].kind == .review && ledger.operations[4].kind == .review, "Masked phones and contracts stay unresolved")
        try check(ledger.operations[5].category == "Подарки" && ledger.operations[6].kind == .transfer, "Manual fields keep priority over phone policy")
        try check(Array(ledger.operations.suffix(4)) == protected, "Refunds, excluded, savings and pending retain exact state")
        let once = ledger.operations
        ledger.reclassify()
        try check(ledger.operations == once, "Phone policy is idempotent")
        var reloaded = try JSONDecoder().decode(Ledger.self, from: JSONEncoder().encode(ledger))
        reloaded.reclassify()
        try check(reloaded.operations == once && reloaded.otherPhonesArePeople == true, "Phone policy and rollback base survive reload")
        ledger.otherPhonesArePeople = false; ledger.reclassify()
        try check(ledger.operations == original, "Disabling phone policy restores previous automatic classification")
        try ledger.setDescriptionRule(DescriptionRule(description: other.details, category: "Без категории", kind: .transfer))
        ledger.otherPhonesArePeople = true; ledger.reclassify()
        try check(ledger.operations[1].kind == .outgoingTransfer, "Enabled phone policy overrides conflicting transfer preset")
        ledger.otherPhonesArePeople = false; ledger.reclassify()
        try check(ledger.operations[1].kind == .transfer, "Disabling policy restores conflicting preset")
        ledger.otherPhonesArePeople = true
        var future = other; future.id = UUID(); future.details = "Внешний перевод по номеру телефона +79993333333"
        try ledger.append(ParsedStatement(operations: [future]), filename: "phone-policy", digest: "phone-policy")
        try check(ledger.operations.last!.kind == .outgoingTransfer && !ledger.operations.last!.needsReview, "Future unknown numbers are classified without new presets")
        var unsafe = Ledger(operations: [other], otherPhonesArePeople: true)
        unsafe.reclassify()
        try check(unsafe.operations[0].kind == .review, "Policy cannot classify everybody as foreign without an own phone")
    }

    static func testDescriptionRules() throws {
        var categorized = sample(); categorized.category = "Внутрибанковские переводы"
        let catalog = Ledger(operations: [categorized, categorized], descriptionRules: [
            DescriptionRule(description: "Будущая операция", category: "Возвраты", kind: .refund),
            DescriptionRule(description: "Пустая категория", category: "  ", kind: .income)
        ])
        try check(catalog.availableCategories.contains("Внутрибанковские переводы"), "Operation custom categories are selectable")
        try check(catalog.availableCategories.contains("Возвраты"), "Preset categories without operations are selectable")
        try check(catalog.availableCategories.filter { $0 == "Внутрибанковские переводы" }.count == 1 && !catalog.availableCategories.contains("  "), "Category menu omits duplicates and blanks")
        try check(Array(catalog.availableCategories.prefix(categories.count)) == categories, "Built-in category order stays unchanged")
        var a = sample(-1000, kind: .review)
        a.details = "Оплата в YANDEX*5411*LAVKA Moskva RUS"
        var b = a; b.id = UUID(); b.bank = "Другой банк"; b.details = "  оплата   в yandex*5411*lavka moskva rus  "
        var incoming = a; incoming.id = UUID(); incoming.amount = 1000; incoming.kind = .income
        var pending = a; pending.id = UUID(); pending.kind = .pending
        var other = a; other.id = UUID(); other.details += " OTHER"
        let groups = descriptionGroups([a, b, incoming, pending, other])
        try check(groups.count == 3 && groups[0].operations.count == 3, "Group by exact normalized description and direction")
        var ledger = Ledger(operations: [a, b, incoming, pending, other])
        var rule = DescriptionRule(description: a.details, category: "Еда", kind: .expense)
        try ledger.setDescriptionRule(rule)
        try check(ledger.operations[0].category == "Еда" && ledger.operations[1].kind == .expense, "Rule applies to all matching debits")
        try check(ledger.operations[2].kind == .income && ledger.operations[2].category == "Продукты", "Rule does not turn incoming money into expenses")
        try check(ledger.operations[3].kind == .pending && ledger.operations[3].ruleBase == nil, "Rule never confirms HOLD")
        try check(ledger.operations[4].kind == .review, "Rule does not match a substring")
        ledger.operations[0].category = "Подарок"; ledger.operations[0].manualCategory = true
        ledger.operations[1].kind = .excluded; ledger.operations[1].manualKind = true
        rule.category = "Запасы"; rule.kind = .savings
        try ledger.setDescriptionRule(rule)
        try check(ledger.operations[0].category == "Подарок" && ledger.operations[0].kind == .savings, "Manual category overrides only category")
        try check(ledger.operations[1].category == "Запасы" && ledger.operations[1].kind == .excluded, "Manual kind overrides only kind")
        let once = ledger.operations
        ledger.reclassify()
        try check(ledger.operations == once, "Reapplying rules is idempotent, including original values")
        var later = a; later.id = UUID()
        try ledger.append(ParsedStatement(operations: [later]), filename: "later", digest: "later")
        try check(ledger.operations[0].category == "Подарок" && ledger.operations[1].kind == .excluded && ledger.operations.last!.category == "Запасы",
                  "Import applies current preset to new rows without overwriting old exceptions")
        let restored = try JSONDecoder().decode(Ledger.self, from: JSONEncoder().encode(ledger))
        try check(restored.descriptionRules == [rule] && restored.operations == ledger.operations, "Preset and exceptions survive JSON round trip")
        ledger.removeDescriptionRule(rule.id)
        try check(ledger.operations[0].category == "Подарок" && ledger.operations[0].kind == .review, "Deleting rule restores automatic kind and preserves manual category")
        try check(ledger.operations[1].category == "Продукты" && ledger.operations[1].kind == .excluded, "Deleting rule preserves manual kind")
        try ledger.setDescriptionRule(rule, replaceManual: true)
        try check(ledger.operations.prefix(2).allSatisfy { $0.category == "Запасы" && $0.kind == .savings && $0.manualCategory != true && $0.manualKind != true }, "Explicit bulk replacement clears exceptions only in matching group")
        rule.description = other.details
        try ledger.setDescriptionRule(rule)
        try check(ledger.operations[0].category == "Подарок" && ledger.operations[0].kind == .review && ledger.operations[4].kind == .savings, "Changing group description restores former group and applies new group")
        var duplicate = rule; duplicate.id = UUID(); duplicate.description = "  " + rule.description.lowercased()
        try fails("Duplicate normalized rule rejected") { try ledger.setDescriptionRule(duplicate) }
        var invalid = rule; invalid.description = "  "
        try fails("Empty description rejected") { try ledger.setDescriptionRule(invalid) }
        invalid = rule; invalid.kind = .pending
        try fails("Preset cannot assign pending status") { try ledger.setDescriptionRule(invalid) }
        var imported = Ledger(descriptionRules: [DescriptionRule(description: a.details, category: "Еда", kind: .expense)])
        try imported.append(ParsedStatement(operations: [a, pending]), filename: "new", digest: "new")
        try check(imported.operations[0].category == "Еда" && imported.operations[1].kind == .pending, "New imports automatically use preset")
        var old = Ledger(operations: [a, b]); old.classificationVersion = nil; old.operations[1].category = "Без категории"
        old.migrateClassification()
        try check(old.operations[0].manualCategory == true && old.operations[1].manualCategory == nil, "Legacy assigned categories are preserved, unknown categories remain automatic")
        let migrated = old.operations; old.migrateClassification()
        try check(old.operations == migrated, "Legacy migration is one-time")
        var transfer = sample(-2000, kind: .review); transfer.details = "Внешний перевод по номеру телефона +79991234567"
        let transferRule = DescriptionRule(description: transfer.details, category: "Личное", kind: .savings)
        var combined = Ledger(operations: [transfer], transferOwners: [transferParty(transfer)!.id: true])
        try combined.setDescriptionRule(transferRule)
        combined.reclassify()
        try check(combined.operations[0].kind == .savings, "Description preset takes precedence over automatic transfer classification")
        combined.removeDescriptionRule(transferRule.id)
        try check(combined.operations[0].kind == .transfer, "Removing preset restores transfer ownership classification")
    }

    static func testMerchantGrouping() throws {
        var first = sample(-4000)
        first.details = "Операция по карте: 000000******1111, дата создания транзакции: 10-10-2026, место совершения операции: RU/Novosibirsk/TPP_METRO_NOVOSIBIRSK, MCC: 4131"
        var second = first; second.id = UUID(); second.date = "2026-10-11"
        second.details = first.details.replacingOccurrences(of: "10-10-2026", with: "11-10-2026").replacingOccurrences(of: "000000******1111", with: "000000******2222")
        let groups = descriptionGroups([first, second])
        try check(groups.count == 1 && groups[0].operations.count == 2, "Metro purchases across transaction dates and cards form one group")
        try check(descriptionGroupLabel(first.details) == "RU/Novosibirsk/TPP_METRO_NOVOSIBIRSK · MCC 4131", "Group label shows merchant without card or date")
        var shop = second; shop.id = UUID(); shop.details = second.details.replacingOccurrences(of: "TPP_METRO_NOVOSIBIRSK", with: "OTHER_SHOP")
        var differentMCC = second; differentMCC.id = UUID(); differentMCC.details = second.details.replacingOccurrences(of: "4131", with: "5411")
        var refund = second; refund.id = UUID(); refund.amount = 4000; refund.kind = .refund
        try check(descriptionGroups([first, shop, differentMCC, refund]).count == 4, "Merchant, MCC and direction remain significant")
        try check(cardPurchaseIdentity("Перевод другу от 10-10-2026") == nil, "No broad date stripping in unrelated operations")
        try check(cardPurchaseIdentity(first.details.replacingOccurrences(of: ", MCC: 4131", with: "")) == nil, "Incomplete bank template keeps full description")
        var varied = second
        varied.details = "  " + second.details.lowercased().replacingOccurrences(of: "11-10-2026", with: "11.10.2026").replacingOccurrences(of: "место совершения", with: "место  совершения")
        try check(descriptionGroups([first, varied]).count == 1, "Card grouping handles case, spaces and dot date format")
        let rule1 = DescriptionRule(description: first.details, category: "Транспорт", kind: .expense)
        let rule2 = DescriptionRule(description: second.details, category: "Транспорт", kind: .expense)
        var ledger = Ledger(operations: [first, second], descriptionRules: [rule1, rule2])
        ledger.mergeEquivalentDescriptionRules()
        try check(ledger.descriptionRules == [rule1], "Equivalent legacy rules merge while retaining first ID")
        ledger.reclassify()
        var future = first; future.id = UUID(); future.date = "2026-10-12"
        future.details = first.details.replacingOccurrences(of: "10-10-2026", with: "12-10-2026")
        try ledger.append(ParsedStatement(operations: [future]), filename: "metro", digest: "metro")
        try check(ledger.operations.allSatisfy { $0.category == "Транспорт" }, "Merged rule applies to all dates including future imports")
        ledger.operations[0].category = "Личное"; ledger.operations[0].manualCategory = true
        ledger.reclassify()
        try check(ledger.operations[0].category == "Личное", "Smart grouping preserves individual exceptions")
        var conflict = rule2; conflict.category = "Подарок"; conflict.kind = .excluded
        var conflicting = Ledger(operations: [first, second, future], descriptionRules: [rule1, conflict])
        conflicting.mergeEquivalentDescriptionRules()
        conflicting.reclassify()
        try check(conflicting.descriptionRules?.count == 2, "Conflicting old rules are retained")
        try check(conflicting.operations[0].category == "Транспорт" && conflicting.operations[1].kind == .excluded,
                  "Conflicting old rules preserve their exact previous matches")
        try check(conflicting.matchingRule(for: future) == nil && conflicting.operations[2].category == future.category,
                  "Conflict does not arbitrarily classify a new date")
        try check(conflicting.matchingRule(for: second)?.id == conflict.id, "Editor shows the effective conflicting rule")
        conflicting.operations[1].manualKind = true
        try conflicting.setDescriptionRule(rule1)
        try check(conflicting.descriptionRules == [rule1] && conflicting.operations[2].category == "Транспорт" && conflicting.operations[1].kind == .excluded,
                  "Saving a common rule resolves conflict and preserves manual exception")
        var pending = future; pending.id = UUID(); pending.kind = .pending
        try conflicting.append(ParsedStatement(operations: [pending]), filename: "pending-metro", digest: "pending-metro")
        try check(conflicting.operations.last?.kind == .pending, "Smart matching does not confirm pending payments")

    }

    static func testPurchaseNameGrouping() throws {
        var first = sample(); first.details = "Оплата в Vilka Lozhka Novosibirsk RUS"
        var second = first; second.id = UUID(); second.details = "Оплата в VILKA-LOZKA Novosibirsk RUS"
        try check(descriptionGroups([first, second]).count == 2, "Different spelling requires confirmation, never a brand exception")
        try check(similarPurchaseNames(first.details, second.details), "Generic similarity suggests the user's merchant example")
        try check(similarPurchaseNames("Оплата в BERYOZKA Moskva RUS", "Оплата в BEREZKA Moskva RUS"), "Similarity works for unrelated merchants too")
        var punctuation = first; punctuation.id = UUID(); punctuation.details = "  Оплата в  VILKA—LOZHKA   Novosibirsk RUS  "
        try check(descriptionGroups([first, punctuation]).count == 1, "Purchase grouping handles Unicode dashes and whitespace")
        var generic = first; generic.details = "Оплата в COFFEE-HOUSE 12 Moskva RUS"
        var genericVariant = generic; genericVariant.details = "Оплата в Coffee_House 12 Moskva RUS"
        try check(descriptionGroups([generic, genericVariant]).count == 1, "Separator normalization works for other merchants")
        var otherCity = second; otherCity.details = second.details.replacingOccurrences(of: "Novosibirsk", with: "Moskva")
        var differentName = first; differentName.details = first.details.replacingOccurrences(of: "Vilka", with: "Pilka")
        var refund = first; refund.amount = 1000
        try check(descriptionGroups([first, otherCity, differentName, refund]).count == 4, "Location, different merchant and direction remain separate")
        var differentNumber = generic; differentNumber.details = generic.details.replacingOccurrences(of: "12", with: "13")
        try check(!similarPurchaseNames(generic.details, differentNumber.details), "Different merchant numbers are not suggested")
        try check(descriptionGroupKey("Перевод A-B", debit: true) != descriptionGroupKey("Перевод A B", debit: true), "No normalization of unrelated transfers")
        try check(!similarPurchaseNames("Перевод A-B", "Перевод A B"), "No fuzzy suggestions for transfers")
        try check(first.fingerprint != second.fingerprint, "Grouping never collapses operation fingerprints")
        let rule = DescriptionRule(description: first.details, category: "Кафе и рестораны", kind: .expense)
        var ledger = Ledger(operations: [first, second, refund], descriptionRules: [rule])
        let sourceID = descriptionGroupKey(second.details, debit: true)
        try ledger.mergeDescriptionGroups(sourceID: sourceID, targetID: rule.key)
        try check(ledger.operations.prefix(2).allSatisfy { $0.category == rule.category }, "Confirmed variants receive shared preset")
        try check(descriptionGroups(ledger.operations, rules: ledger.descriptionRules ?? []).count == 2, "Confirmed variants group together; incoming money stays separate")
        try check(ledger.descriptionRules?.first?.alternateDescriptions == [second.details], "Confirmed spelling saved as editable preset variant")
        var future = second; future.id = UUID(); future.date = "2026-11-01"
        try ledger.append(ParsedStatement(operations: [future]), filename: "future", digest: "future")
        try check(ledger.operations.last?.category == rule.category, "Future imports use confirmed variant")
        var detached = ledger
        var detachedRule = detached.descriptionRules![0]; detachedRule.alternateDescriptions = nil
        try detached.setDescriptionRule(detachedRule)
        try check(detached.operations[1].category == second.category && detached.matchingRule(for: second) == nil, "Removing variant restores previous classification")
        var duplicate = DescriptionRule(description: "Оплата в Other Cafe", category: "Другое", kind: .expense)
        duplicate.alternateDescriptions = [second.details]
        try fails("Overlapping variant presets rejected") { try ledger.setDescriptionRule(duplicate) }
        ledger.operations[1].manualCategory = true; ledger.operations[1].category = "Личное"
        ledger.operations[1].manualKind = true; ledger.operations[1].kind = .savings
        ledger.reclassify()
        try check(ledger.operations[1].category == "Личное" && ledger.operations[1].kind == .savings, "Manual category and kind override variant preset")
        var hold = second; hold.id = UUID(); hold.kind = .pending
        try ledger.append(ParsedStatement(operations: [hold]), filename: "hold", digest: "hold")
        try check(ledger.operations.last?.kind == .pending, "Variants never confirm HOLD")
        try fails("Cannot merge credit with debit") {
            try ledger.mergeDescriptionGroups(sourceID: descriptionGroupKey(refund.details, debit: false), targetID: rule.key)
        }
        var third = first; third.id = UUID(); third.details = "Оплата в VILKA LOZHKA CAFE Novosibirsk RUS"
        try ledger.append(ParsedStatement(operations: [third]), filename: "third", digest: "third")
        try ledger.mergeDescriptionGroups(sourceID: descriptionGroupKey(third.details, debit: true), targetID: rule.key)
        try check(ledger.descriptionRules?.first?.keys.count == 3 && ledger.matchingRule(for: second) != nil && ledger.matchingRule(for: third) != nil,
                  "Merging another group retains all previously confirmed variants")
        let roundtrip = try JSONDecoder().decode(Ledger.self, from: JSONEncoder().encode(ledger))
        try check(roundtrip.descriptionRules == ledger.descriptionRules && roundtrip.matchingRule(for: future)?.id == rule.id, "Variants persist through JSON backup")
        var sameRule = rule; sameRule.id = UUID(); sameRule.description = punctuation.details
        sameRule.alternateDescriptions = [second.details]
        var migrated = Ledger(operations: [first, second], descriptionRules: [rule, sameRule])
        migrated.mergeEquivalentDescriptionRules(); migrated.reclassify()
        try check(migrated.descriptionRules?.count == 1 && migrated.operations[1].category == rule.category, "Equivalent legacy presets merge without losing variants")
        var conflictRule = sameRule; conflictRule.category = "Другое"; conflictRule.kind = .excluded
        var conflict = Ledger(operations: [first, punctuation, second], descriptionRules: [rule, conflictRule])
        conflict.mergeEquivalentDescriptionRules(); conflict.reclassify()
        try check(conflict.descriptionRules?.count == 2 && conflict.operations[0].category == rule.category && conflict.operations[1].kind == .excluded, "Conflicting normalized presets preserve exact assignments")
        try check(conflict.operations[2].kind == .excluded, "Conflicting presets preserve an exact alternate description assignment")
    }

    static func testCachedDescriptionMatching() throws {
        var operation = sample()
        operation.details = "Оплата в CACHE SHOP Novosibirsk RUS"
        var rule = DescriptionRule(description: operation.details, category: "Еда", kind: .expense)
        for _ in 0..<10 { try check(rule.matches(operation), "Repeated description lookup stays consistent") }
        let firstKey = rule.key
        rule.description = "Оплата в ANOTHER SHOP Novosibirsk RUS"
        try check(rule.key != firstKey && !rule.matches(operation), "Renaming a preset immediately changes cached matching")
        rule.alternateDescriptions = [operation.details]
        try check(rule.matches(operation), "Adding variant is visible after cache warmup")
        rule.alternateDescriptions = nil
        try check(!rule.matches(operation), "Removing variant is visible after cache warmup")
        operation.details = rule.description
        try check(rule.matches(operation), "Editing operation description uses its new key")
        operation.amount = 1000
        try check(!rule.matches(operation), "Direction remains part of cached key")
        rule.debit = false
        try check(rule.matches(operation), "Changing preset direction immediately updates matching")
        rule.category = "Новое назначение"; rule.kind = .excluded
        var ledger = Ledger(operations: [operation], descriptionRules: [rule])
        ledger.reclassify()
        try check(ledger.operations[0].category == rule.category && ledger.operations[0].kind == .excluded, "Classification results are never cached")
    }

    static func testSalaryGrouping() throws {
        var first = sample(100000, kind: .income)
        first.category = "Доходы"
        first.details = "Пополнение. Зарплата. ООО \"ЯНДЕКС.ТЕХНОЛОГИИ\""
        var second = first; second.id = UUID()
        second.details = "Пополнение. ООО \"ЯНДЕКС.ТЕХНОЛОГИИ\". Зарплата"
        try check(descriptionGroups([first, second]).count == 1, "Salary groups by employer regardless of field order")
        var quoted = second; quoted.id = UUID()
        quoted.details = "  ПОПОЛНЕНИЕ . ООО «Яндекс.Технологии» . ЗАРПЛАТА. "
        try check(descriptionGroups([first, quoted]).count == 1, "Salary grouping normalizes whitespace, case and quotation marks")
        var other = first; other.details = "Пополнение. Зарплата. АО Пример 123"
        var reorderedOther = other; reorderedOther.details = "Пополнение. АО Пример 123. Зарплата."
        try check(descriptionGroups([other, reorderedOther]).count == 1, "Salary grouping is generic across employers")
        var otherEmployer = first; otherEmployer.details = first.details.replacingOccurrences(of: "ТЕХНОЛОГИИ", with: "ДОСТАВКА")
        var legalForm = first; legalForm.details = first.details.replacingOccurrences(of: "ООО", with: "ПАО")
        var bonus = first; bonus.details = first.details.replacingOccurrences(of: "Зарплата", with: "Премия")
        var debit = first; debit.amount = -100000
        try check(descriptionGroups([first, otherEmployer, legalForm, bonus, debit]).count == 5, "Employer, legal form, purpose and direction stay significant")
        var extraPurpose = first; extraPurpose.details += ". Возврат долга"
        try check(descriptionGroups([first, extraPurpose]).count == 2, "Additional payment purpose is preserved")
        try check(descriptionGroupKey("Пополнение. Зарплата.", debit: false) != descriptionGroupKey(first.details, debit: false), "Missing employer is not inferred")
        try check(first.fingerprint != second.fingerprint, "Salary grouping does not alter operation identity")
        try check(groupedIncome([first, second, quoted]).count == 1 && groupedIncome([first, second, quoted]).first?.amount == 300000, "Salary source chart also combines reordered descriptions")
        let rule = DescriptionRule(description: first.details, debit: false, category: "Зарплата", kind: .income)
        var anotherRule = rule; anotherRule.id = UUID(); anotherRule.description = second.details
        var ledger = Ledger(operations: [first, second], descriptionRules: [rule, anotherRule])
        ledger.mergeEquivalentDescriptionRules(); ledger.reclassify()
        try check(ledger.descriptionRules == [rule] && ledger.operations.allSatisfy { $0.category == "Зарплата" }, "Equivalent salary presets migrate to shared rule")
        ledger.operations[1].manualCategory = true; ledger.operations[1].category = "Личное"
        ledger.reclassify()
        try check(ledger.operations[1].category == "Личное", "Manual salary classification survives grouping")
        try ledger.append(ParsedStatement(operations: [quoted]), filename: "salary", digest: "salary")
        try check(ledger.operations.last?.category == "Зарплата", "Future reordered salary uses existing preset")
        anotherRule.kind = .excluded
        var conflict = Ledger(operations: [first, second, quoted], descriptionRules: [rule, anotherRule])
        conflict.mergeEquivalentDescriptionRules(); conflict.reclassify()
        try check(conflict.descriptionRules?.count == 2 && conflict.operations[0].kind == .income && conflict.operations[1].kind == .excluded && conflict.matchingRule(for: quoted) == nil, "Conflicting salary presets remain explicit, new variants do not pick one arbitrarily")
    }

    static func testSBPGrouping() throws {
        var a = sample(5000, kind: .review)
        a.details = "Категория: Перевод по СБП.Перевод C1000000000001 через Систему быстрых платежей от +79991234567. Без НДС."
        var b = a; b.id = UUID(); b.details = a.details.replacingOccurrences(of: "C1000000000001", with: "C1000000000002")
        try check(descriptionGroups([a, b]).count == 1, "SBP transfers from same phone group despite different transaction IDs")
        try check(descriptionGroupLabel(a.details) == "СБП · от +79991234567", "SBP label omits transaction metadata")
        var formatted = b; formatted.id = UUID()
        formatted.details = "Перевод С1000000000003 через Систему быстрых платежей от 8 (999) 123-45-67. Без НДС."
        try check(descriptionGroups([a, b, formatted]).count == 1, "SBP grouping normalizes phone format, 8/7 and Latin/Cyrillic transfer prefix")
        var other = b; other.id = UUID(); other.details = b.details.replacingOccurrences(of: "79991234567", with: "79997654321")
        var debit = b; debit.id = UUID(); debit.amount = -5000
        var recipient = b; recipient.id = UUID(); recipient.details = b.details.replacingOccurrences(of: " от ", with: " на ")
        try check(descriptionGroups([a, other, debit, recipient]).count == 4, "Different phones, debit/credit and from/to remain separate")
        try check(sbpTransferIdentity(a.details.replacingOccurrences(of: "79991234567", with: "7999***4567")) == nil, "Masked phones do not identify a group")
        try check(sbpTransferIdentity(a.details.replacingOccurrences(of: "79991234567", with: "799912345678")) == nil, "Wrong phone length rejected")
        try check(sbpTransferIdentity(a.details + " Возврат долга") == nil, "Meaningful extra description is not discarded")
        try check(sbpTransferIdentity("Оплата QR СБП C2B +79991234567") == nil, "Merchant SBP payments are not personal transfers")
        let ruleA = DescriptionRule(description: a.details, debit: false, category: "Поступления от семьи", kind: .incomingTransfer)
        let ruleB = DescriptionRule(description: b.details, debit: false, category: ruleA.category, kind: ruleA.kind)
        var ledger = Ledger(operations: [a, b], descriptionRules: [ruleA, ruleB])
        ledger.mergeEquivalentDescriptionRules(); ledger.reclassify()
        try check(ledger.descriptionRules == [ruleA] && ledger.operations.allSatisfy { $0.category == ruleA.category }, "Old SBP preset rules merge and still apply")
        ledger.operations[0].manualCategory = true; ledger.operations[0].category = "Личное"
        try ledger.append(ParsedStatement(operations: [formatted]), filename: "sbp", digest: "sbp")
        try check(ledger.operations[0].category == "Личное" && ledger.operations.last?.kind == .incomingTransfer, "SBP preset applies to new IDs without overwriting individual exception")
        var conflict = ruleB; conflict.kind = .transfer
        var conflicting = Ledger(operations: [a, b, formatted], descriptionRules: [ruleA, conflict])
        conflicting.mergeEquivalentDescriptionRules(); conflicting.reclassify()
        try check(conflicting.descriptionRules?.count == 2 && conflicting.operations[0].kind == .incomingTransfer && conflicting.operations[1].kind == .transfer,
                  "Conflicting SBP rules retain exact original assignments")
        try check(conflicting.matchingRule(for: formatted) == nil, "Unknown SBP ID is not assigned an arbitrary conflicting rule")

    }

    static func testIncomeBreakdown() throws {
        var salary = sample(100000, kind: .income); salary.category = "Зарплата"; salary.details = "Начисление"
        var transfer = sample(5000, kind: .incomingTransfer); transfer.category = "Переводы людям"
        transfer.details = "Перевод C1000000000001 через Систему быстрых платежей от +79991234567. Без НДС."
        var transfer2 = transfer; transfer2.id = UUID()
        transfer2.details = transfer.details.replacingOccurrences(of: "C1000000000001", with: "C1000000000002")
        var other = transfer; other.id = UUID(); other.details = transfer.details.replacingOccurrences(of: "79991234567", with: "79997654321")
        var refund = sample(300, kind: .refund); refund.category = "Зарплата"
        var expense = sample(-1000); expense.category = "Зарплата"
        let items = [salary, transfer, transfer2, other, refund, expense,
                     sample(40000, kind: .transfer), sample(30000, kind: .savings), sample(20000, kind: .review),
                     sample(10000, kind: .pending), sample(50000, kind: .excluded)]
        let sources = groupedIncome(items)
        try check(sources.count == 3 && sources.reduce(0, { $0 + $1.amount }) == 115300, "Income chart includes income, incoming transfers and refunds")
        try check(sources.first?.label == "Зарплата" && sources.first?.amount == 100300, "Assigned income category identifies source")
        try check(sources.first(where: { $0.label == "СБП · от +79991234567" })?.amount == 10000, "Income source groups SBP transaction IDs by sender")
        let incomeSelection = BreakdownSelection(label: "СБП · от +79991234567", isIncome: true)
        try check(incomeSelection.operations(in: items).map(\.id) == [transfer.id, transfer2.id], "Income drilldown contains only selected source")
        let expenseSelection = BreakdownSelection(label: "Зарплата", isIncome: false)
        try check(expenseSelection.operations(in: items).map(\.id) == [expense.id], "Expense drilldown excludes refunds and income with same category name")
        try check(expenseSelection.operations(in: items).reduce(0, { $0 + $1.expenseAmount }) == 1000, "Expense drilldown total reconciles with chart")
        var filteredOut = salary; filteredOut.id = UUID(); filteredOut.date = "2026-11-01"; filteredOut.currency = "USD"
        let filtered = (items + [filteredOut]).filter { $0.currency == "RUB" && dateMatches($0.date, period: "2026-10", from: "", through: "") }
        let salaries = BreakdownSelection(label: "Зарплата", isIncome: true).operations(in: filtered)
        try check(salaries.map(\.id) == [salary.id, refund.id], "Income drilldown includes refund and respects supplied overview filters")
        try check(groupedIncome([]).isEmpty, "Empty income period")
        let descriptions = ["Перевод с договора 0000000001", "Перевод с договора 0000000002", "Перевод со договора № 0000000003.",
                            "Кэшбэк за обычные покупки", "Кешбэк за покупки у партнеров", "Начисление кэшбэка"]
        let similar = descriptions.map { text -> Operation in
            var operation = sample(1000, kind: .income)
            operation.category = "Доходы"; operation.details = text
            return operation
        }
        let combined = groupedIncome(similar)
        try check(combined.count == 2 && combined.allSatisfy { $0.amount == 3000 }, "Contract numbers and cashback variants collapse into separate income sources")
        for group in combined {
            let matches = BreakdownSelection(label: group.label, isIncome: true).operations(in: similar)
            try check(matches.count == 3 && matches.reduce(0) { $0 + $1.incomeAmount } == group.amount, "Combined source click-through reconciles with chart")
        }
        var custom = similar[0]; custom.category = "Подарок"
        try check(incomeSource(custom) == "Подарок", "Explicit category keeps contract income separate")
        custom = similar[0]; custom.details += " Возврат долга"
        try check(incomeSource(custom) != "Переводы с договоров", "Meaningful contract description suffix is retained")
        let names = ["phone|79991234567": "Анна", "phone|79997654321": " анна "]
        let named = groupedIncome([transfer, transfer2, other], phoneNames: names)
        try check(named.count == 1 && named[0].label == "Переводы · Анна" && named[0].amount == 15000, "Saved name combines income from the person's multiple phones")
        let namedSelection = BreakdownSelection(label: named[0].label, isIncome: true)
        try check(namedSelection.operations(in: items, phoneNames: names).count == 3, "Named sender click-through uses the same grouping")
        try check(groupedIncome([transfer, other], phoneNames: ["phone|79991234567": "Анна"]).count == 2, "Unknown sender is not merged into named sender")
        try check(groupedIncome([transfer, other], phoneNames: ["phone|79991234567": "Анна", "phone|79997654321": "Борис"]).count == 2, "Different named senders remain separate")
        try check(groupedIncome(items, phoneNames: names).reduce(0) { $0 + $1.amount } == items.reduce(0) { $0 + $1.incomeAmount }, "Income grouping never changes total or includes own/excluded/pending movements")
        let housing = [sample(-2000000), sample(-259900), sample(39587, kind: .refund), sample(2322, kind: .refund)]
        let housingFlow = cashFlow(housing)[0]
        try check(housingFlow.expenses == 2259900 && housingFlow.income == 41909, "Housing example shows full spending and both refunds as income")
        try check(housingFlow.income - housingFlow.expenses == -2217991, "Refund presentation does not change net cash balance")
        try check(groupedExpenses([sample(200, kind: .refund)], key: { $0.category }).isEmpty, "Refund-only category does not appear in expense pie")
    }

    static func main() throws {
        try check(money("−1\u{00a0}234,56 RUR") == -123456, "Russian money, NBSP and unicode minus")
        try check(money("+22 128.00 ₽") == 2212800, "PDF money")
        try check(money("1,234.56 USD") == 123456, "US grouping")
        try check(money("1.234,56 EUR") == 123456, "European grouping")
        try check(money("0,01") == 1, "One kopeck")
        try fails("Invalid amount must fail") { _ = try money("100 or 200") }
        try fails("Fractions of a kopeck must fail") { _ = try money("1.001") }
        try fails("Huge amount must fail") { _ = try money("99999999999999999999") }
        try check(operationDate("29.02.2024") == "2024-02-29", "Leap day")
        try fails("Invalid date must fail") { _ = try operationDate("31.02.2026") }
        try check(suggest(details: "Пополнение. Зарплата.", amount: 100).0 == .income, "Salary isn't a transfer")
        try check(suggest(details: "Перевод себе", amount: 100).0 == .transfer, "Own transfer")
        try check(suggest(details: "Пополнение Инвесткопилки", amount: -100).0 == .transfer, "Own savings")
        try check(suggest(details: "Перевод другу", amount: -100).0 == .review, "Unknown transfer must be reviewed")
        try check(suggest(details: "Возврат покупки", amount: 100).0 == .refund, "Refund")
        try check(suggest(details: "Платеж QR по СБП C2B в магазин", amount: -100).0 == .expense, "SBP merchant is an expense")
        try check(suggest(details: "Операция по карте, MCC: 5814", amount: -100).1 == "Кафе и рестораны", "MCC classification")
        try check(sample(-1000, kind: .transfer).expenseAmount == 0, "Transfers excluded")
        try check(sample(200, kind: .refund).expenseAmount == 0 && sample(200, kind: .refund).incomeAmount == 200, "Refund belongs to income only")
        try check(sample(-1000, kind: .review).expenseAmount == 1000, "Ambiguous debit remains visible")
        try check(sample(-1000, kind: .pending).expenseAmount == 0, "Hold excluded")
        try check(groupedExpenses([sample(), sample(200, kind: .refund)], key: { $0.category }).first?.amount == 1000, "Category expenses are not reduced by refunds")
        try check(categories.contains("Оплата Codex"), "Codex is available for manual categorization")
        try check(suggest(details: "Оплата в OPENAI CODEX", amount: -2000, bankCategory: "Прочее").1 == "Оплата Codex", "Explicit Codex payment overrides generic bank category")
        try check(suggest(details: "Оплата в OPENAI CHATGPT", amount: -2000).1 != "Оплата Codex", "OpenAI alone does not identify Codex")
        try check(suggest(details: "Перевод другу на Codex", amount: -2000).0 == .review, "Codex mention does not override uncertain transfer")
        var nextDay = sample(300, kind: .income); nextDay.date = "2026-10-02"
        let cash = cashFlow([nextDay, sample(), sample(200, kind: .refund), sample(-500, kind: .outgoingTransfer),
                                 sample(700, kind: .incomingTransfer), sample(-100, kind: .review), sample(999, kind: .review),
                                 sample(-999, kind: .transfer), sample(999, kind: .transfer), sample(-999, kind: .pending),
                                 sample(999, kind: .excluded)])
        try check(cash.map(\.period) == ["2026-10-01", "2026-10-02"], "Cash flow days are ordered")
        try check(cash[0].expenses == 1600 && cash[0].income == 900 && cash[1].expenses == 0 && cash[1].income == 300,
                  "Daily expenses and topups respect refunds, transfers, review and hold")
        try check(cashFlow([sample(200, kind: .refund)]).first?.income == 200, "Refund-only day remains visible as income")
        try check(cashFlow([]).isEmpty, "Empty period has no chart rows")
        let sortable = [sample(-100), sample(-2000), sample(30, kind: .income)]
        try check(sortable.sorted(using: [KeyPathComparator(\Operation.amount)]).map(\.amount) == [-2000, -100, 30], "Amount sorting is numeric")
        try check(sortable.sorted(using: [KeyPathComparator(\Operation.amount, order: .reverse)]).map(\.amount) == [30, -100, -2000], "Amount sorting reverses")
        var uncategorized = sample(-12345); uncategorized.category = "Без категории"
        var undecided = sample(-300, kind: .review); undecided.category = "Без категории"
        let unknownItems = [uncategorized, undecided, sample(900, kind: .review), sample(-200, kind: .pending)]
        try check(groupedExpenses(unknownItems, key: { $0.category }).first { $0.label == "Без категории" }?.amount == 12645,
                  "Uncategorized purchases and undecided debits are present in category chart")
        try check(cashFlow(unknownItems).first?.expenses == 12645, "Uncategorized expenses are present in daily chart")
        try check(sample(-5000, kind: .savings).expenseAmount == 0 && sample(5000, kind: .savings).incomeAmount == 0,
                  "Savings are movements of own money, not expenses or income")
        try check(cashFlow([sample(-5000, kind: .savings)]).allSatisfy { $0.expenses == 0 && $0.income == 0 && $0.savings == 5000 }, "Savings have their own series, separate from expenses and income")
        try check(sample(-5000, kind: .savings).savingsAmount == 5000, "Savings count outgoing transfers")
        try check([sample(-5000, kind: .savings), sample(5000, kind: .savings)].reduce(Int64(0)) { $0 + $1.savingsAmount } == 5000, "Both sides of a savings transfer are counted only once")
        try check(sample(0, kind: .savings).savingsAmount == 0 && sample(5000, kind: .savings).savingsAmount == 0, "Savings receipts and zero amounts do not inflate saved total")
        try check(OperationKind.allCases.filter { $0 != .savings }.allSatisfy { sample(-5000, kind: $0).savingsAmount == 0 }, "Other kinds do not count as savings")
        var oldSaving = sample(-5000, kind: .savings); oldSaving.date = "2026-09-10"
        let selectedSavings = [oldSaving, sample(-2500, kind: .savings)].filter { dateMatches($0.date, period: "2026-10", from: "", through: "") }
        try check(selectedSavings.reduce(Int64(0)) { $0 + $1.savingsAmount } == 2500, "Savings total respects selected period")
        let savingsRoundTrip = try JSONDecoder().decode(Operation.self, from: JSONEncoder().encode(sample(-5000, kind: .savings)))
        try check(savingsRoundTrip.kind == .savings, "Savings type persists")
        try check(chartDayLabel("2026-10-22") == "22.10", "Day axis omits year")
        var nextYear = uncategorized; nextYear.date = "2027-10-01"
        try check(cashFlow([uncategorized, nextYear]).count == 2, "Same day and month in different years stay separate")
        try fails("Overflow is rejected") { try validateAmounts([sample(Int64.max), sample()]) }
        try fails("Int64.min is rejected") { try validateAmounts([sample(Int64.min)]) }
        var ledger = Ledger()
        try ledger.append(ParsedStatement(operations: [sample(), sample()]), filename: "one", digest: "one")
        try check(ledger.operations.count == 2, "Identical purchases within a statement survive")
        try fails("Same file import blocked") { try ledger.append(ParsedStatement(operations: [sample()]), filename: "copy", digest: "one") }
        try ledger.append(ParsedStatement(operations: [sample()]), filename: "two", digest: "two")
        try check(ledger.operations.count == 3 && ledger.operations.last!.possibleDuplicate, "Overlap without ID is flagged, not dropped")
        var identified = sample(); identified.bankID = "operation-1"
        var withIDs = Ledger()
        try withIDs.append(ParsedStatement(operations: [identified]), filename: "a", digest: "a")
        try withIDs.append(ParsedStatement(operations: [identified]), filename: "b", digest: "b")
        try check(withIDs.operations.count == 1, "Same bank operation ID deduplicated")
        identified.amount = -2000
        try fails("Conflicting bank ID must fail") { try withIDs.append(ParsedStatement(operations: [identified]), filename: "c", digest: "c") }
        let roundTrip = try JSONDecoder().decode(Ledger.self, from: JSONEncoder().encode(ledger))
        try check(roundTrip.operations == ledger.operations, "Persistence round trip")
        var transfer = sample(-50000, kind: .review)
        transfer.details = "Внешний перевод по номеру телефона +7 (999) 123-45-67"
        let party = transferParty(transfer)!
        try check(party.id == "phone|79991234567", "Phone normalized")
        var incoming = transfer
        incoming.amount = 50000
        incoming.details = "Перевод через Систему быстрых платежей от 8 (999) 123-45-67. Без НДС."
        try check(transferParty(incoming) == party, "Incoming and outgoing phone rules share identity")
        var masked = transfer
        masked.details = "Перевод по номеру телефона 999***4567"
        try check(transferParty(masked) == nil, "Masked phones are not matched")
        var own = Ledger(operations: [transfer, incoming])
        own.transferOwners = [party.id: true]
        own.classifyTransfers()
        try check(own.operations.allSatisfy { $0.kind == .transfer }, "Own transfers in both directions excluded")
        own.transferOwners = [party.id: false]
        own.classifyTransfers()
        try check(own.operations[0].kind == .outgoingTransfer && own.operations[1].kind == .incomingTransfer, "Other person's transfer directions")
        try check(own.operations[0].expenseAmount == 50000 && own.operations[1].incomeAmount == 50000, "Other person's transfer totals")
        own.operations[0].kind = .refund; own.operations[0].manualKind = true
        own.transferOwners = [:]
        own.classifyTransfers()
        try check(own.operations[0].kind == .refund && own.operations[1].kind == .review, "Removing rule preserves manual decisions")
        var accountTransfer = sample(-50000, kind: .review)
        accountTransfer.account = "00000000000000000001"
        accountTransfer.details = "Внутрибанковский перевод между счетами. Со счёта 00000000000000000001 на счёт 00000000000000000002"
        var destination = sample(50000, kind: .review)
        destination.account = "00000000000000000002"
        var known = Ledger(operations: [accountTransfer, destination])
        known.classifyTransfers()
        try check(known.operations[0].kind == .transfer, "Counterparty with its own statement is my account")
        let ownerRows = Ledger(operations: [transfer, incoming, masked] + known.operations,
                               transferOwners: [party.id: true, "phone|79990000000": true],
                               phoneNames: ["phone|79990000001": "Без операций"]).transferOwnerRows
        try check(ownerRows.count == 4, "Owner list combines directions, ignores masked phones and retains saved phones")
        try check(ownerRows.first { $0.id == party.id }?.count == 2, "Owner list counts both transfer directions once")
        try check(ownerRows.first { $0.hasStatement }?.count == 1, "Owner list marks accounts with own statements")
        try check(ownerRows.filter { $0.count == 0 }.count == 2, "Saved phones without operations retain zero counts")
        try check(ownerRows.map { $0.party.label } == ownerRows.map { $0.party.label }.sorted(), "Owner rows remain sorted")
        accountTransfer.account = "00000000000000000099"
        try check(transferParty(accountTransfer) == nil, "Account direction mismatch is rejected")
        try check(namedInternalTransfer("Внутрибанковский перевод между счетами, ТЕСТОВ Т.Т..Со счёта 0001 на счёт 0002", owner: "Тестов Т. Т.", amount: -100) == .transfer, "Owner name tolerates spaces around initials")
        try check(namedInternalTransfer("Внутрибанковский перевод между счетами, ПЕТРОВ П.П..Со счёта 0001 на счёт 0002", owner: "Тестов Т. Т.", amount: -100) == .outgoingTransfer, "Different named internal recipient")
        try check(namedInternalTransfer("Внутрибанковский перевод между счетами, ТЕСТОВ Т.Т..Со счёта 0001 на счёт 0002", owner: "Тестов Тимур Тимурович", amount: -100) == nil, "Ambiguous abbreviated owner is not marked as other")
        let legacy = try JSONEncoder().encode(Ledger(operations: [transfer]))
        let decodedLegacy = try JSONDecoder().decode(Ledger.self, from: legacy)
        try check(decodedLegacy.transferOwners == nil && decodedLegacy.operations[0].manualKind == nil, "Old database without rule fields loads")
        let dates = ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]
        try check(dates.filter { dateMatches($0, period: "Один день", from: "2026-10-01", through: "2026-10-03") } == ["2026-10-01"], "One-day filter")
        try check(dates.filter { dateMatches($0, period: "Диапазон дат", from: "2026-09-30", through: "2026-10-02") } == Array(dates.prefix(3)), "Date range crosses month and includes both ends")
        try check(!dateMatches("2026-10-02", period: "Диапазон дат", from: "2026-10-03", through: "2026-10-01"), "Reversed date range is empty")
        try check(dateMatches("2026-10-02", period: "Все месяцы", from: "2026-10-03", through: "2026-10-01"), "All dates ignores stale range")
        try check(dateMatches("2026-10-02", period: "2026-10", from: "", through: ""), "Existing month filter")
        let nearMidnight = ISO8601DateFormatter().date(from: "2026-10-01T22:00:00Z")!
        try check(dayKey(nearMidnight, timeZone: TimeZone(secondsFromGMT: 10800)!) == "2026-10-02", "Day filter uses local calendar, not UTC")
        try testPeriodCashFlow()
        try testSavingsHistory()
        try testReviewStatus()
        try testIncomeBreakdown()
        try testPurchaseNameGrouping()
        try testCachedDescriptionMatching()
        try testSalaryGrouping()
        try testSBPGrouping()
        try testMerchantGrouping()
        try testPhonePolicy()
        try testPhoneContacts()
        try testDescriptionRules()
        let fixtures = URL(fileURLWithPath: "build/fixtures")
        let parsed = try parseStatement(Data(contentsOf: fixtures.appendingPathComponent("valid.xlsx")), filename: "valid.xlsx")
        try check(parsed.operations.count == 3, "XLSX rows")
        try check(parsed.operations[0].amount == -12550 && parsed.operations[0].category == "Продукты", "XLSX amount and MCC")
        try check(parsed.operations[2].kind == .pending && parsed.warnings.count == 1, "HOLD retained with warning")
        for file in ["bad-total.xlsx", "bad-status.xlsx", "bad-money.xlsx", "bad-xml.xlsx"] {
            try fails(file) { _ = try parseStatement(Data(contentsOf: fixtures.appendingPathComponent(file)), filename: file) }
        }
        try fails("Broken ZIP rejected") { _ = try SpreadsheetArchive(data: Data(repeating: 0, count: 200)) }
        try fails("Unsupported PDF rejected") { _ = try parseStatement(Data("not a pdf".utf8), filename: "x.pdf") }
        print("PASS: \(checks) checks")
        for path in CommandLine.arguments.dropFirst() {
            let url = URL(fileURLWithPath: path)
            let result = try parseStatement(Data(contentsOf: url), filename: url.lastPathComponent)
            let confirmed = result.operations.filter { $0.kind != .pending }
            let income = confirmed.filter { $0.amount > 0 }.reduce(Int64(0)) { $0 + $1.amount }
            let debits = confirmed.filter { $0.amount < 0 }.reduce(Int64(0)) { $0 - $1.amount }
            print("REAL FILE OK: \(url.pathExtension), rows=\(result.operations.count), confirmed=\(confirmed.count), credits_cents=\(income), debits_cents=\(debits), warnings=\(result.warnings.count)")
        }
    }
}
