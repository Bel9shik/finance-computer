import Foundation
import CryptoKit

enum OperationKind: String, Codable, CaseIterable, Identifiable {
    case expense = "Расход"
    case income = "Доход"
    case refund = "Возврат"
    case transfer = "Между своими счетами"
    case savings = "Откладывание на счета"
    case review = "Нужно разобрать"
    case excluded = "Не учитывать"
    case pending = "Ожидает подтверждения"
    case outgoingTransfer = "Перевод другому человеку"
    case incomingTransfer = "Перевод от другого человека"
    var id: String { rawValue }
}

struct Operation: Codable, Identifiable, Equatable {
    var id = UUID()
    var date: String
    var bank: String
    var account: String
    var details: String
    var amount: Int64
    var currency: String
    var category: String
    var kind: OperationKind
    var source: String
    var sourceRow: String
    var possibleDuplicate = false
    var bankID = ""
    var manualKind: Bool?
    var manualCategory: Bool?
    var ruleBase: OperationClassification?
    var phoneRuleBase: OperationClassification?
    var transferReason: String?

    var expenseAmount: Int64 {
        switch kind {
        case .expense: return abs(amount)
        case .outgoingTransfer: return max(0, -amount)
        case .review: return amount < 0 ? -amount : 0
        default: return 0
        }
    }
    var incomeAmount: Int64 {
        kind == .income || kind == .incomingTransfer || kind == .refund ? max(0, amount) : 0
    }
    var savingsAmount: Int64 {
        kind == .savings && amount < 0 ? -amount : 0
    }
    var needsReview: Bool {
        let needsCategory = category == "Без категории" && kind != .transfer && kind != .savings
        return kind != .excluded && (kind == .review || needsCategory || possibleDuplicate)
    }
    var kindLabel: String { kind.rawValue }
    var fingerprint: String {
        [bank, account, date, String(amount), currency, details.lowercased()].joined(separator: "\u{1f}")
    }
}

struct OperationClassification: Codable, Equatable {
    var category: String
    var kind: OperationKind
    var transferReason: String?
}

struct DescriptionRule: Codable, Identifiable, Equatable {
    var id = UUID()
    var description: String
    var debit = true
    var category: String
    var kind: OperationKind
    var alternateDescriptions: [String]?
    var key: String { descriptionGroupKey(description, debit: debit) }
    var keys: Set<String> { Set(([description] + (alternateDescriptions ?? [])).map { descriptionGroupKey($0, debit: debit) }) }
    func matches(_ operation: Operation) -> Bool {
        keys.contains(descriptionGroupKey(operation.details, debit: operation.amount < 0))
    }
}

func cardPurchaseIdentity(_ description: String) -> (merchant: String, mcc: String)? {
    let text = description.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    let pattern = #"^Операция по карте:\s*[0-9*Xx• -]+,\s*дата создания транзакции:\s*[0-9]{2}[-.][0-9]{2}[-.][0-9]{4},\s*место совершения операции:\s*(.+),\s*MCC:\s*([0-9]{4})\.?$"#
    guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
          let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
          let merchantRange = Range(match.range(at: 1), in: text), let mccRange = Range(match.range(at: 2), in: text) else { return nil }
    let merchant = text[merchantRange].trimmingCharacters(in: .whitespaces)
    guard !merchant.isEmpty else { return nil }
    return (merchant, String(text[mccRange]))
}

func sbpTransferIdentity(_ description: String) -> (party: String, phone: String)? {
    let text = normalized(description)
    let pattern = #"^(?:категория:\s*перевод по сбп\.\s*)?перевод (?:[cс][0-9]+ )?через систему быстрых платежей (от|на) (\+?[78][0-9 ()-]+)\.?\s*(?:без ндс\.?)?$"#
    guard let regex = try? NSRegularExpression(pattern: pattern),
          let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
          let partyRange = Range(match.range(at: 1), in: text), let phoneRange = Range(match.range(at: 2), in: text) else { return nil }
    var phone = text[phoneRange].filter(\.isNumber)
    guard phone.count == 11 else { return nil }
    if phone.first == "8" { phone.replaceSubrange(phone.startIndex...phone.startIndex, with: "7") }
    return (String(text[partyRange]), phone)
}

func normalizedMerchant(_ merchant: String) -> String {
    normalized(merchant.replacingOccurrences(of: #"[\p{Pd}_]+"#, with: " ", options: .regularExpression))
}

func purchaseIdentity(_ description: String) -> (name: String, format: String)? {
    if let identity = cardPurchaseIdentity(description) {
        return (normalizedMerchant(identity.merchant), "card|" + identity.mcc)
    }
    let text = normalized(description), prefix = "оплата в "
    guard text.hasPrefix(prefix), text.count > prefix.count else { return nil }
    return (normalizedMerchant(String(text.dropFirst(prefix.count))), "purchase")
}

func similarPurchaseNames(_ first: String, _ second: String) -> Bool {
    guard let lhs = purchaseIdentity(first), let rhs = purchaseIdentity(second), lhs.format == rhs.format,
          lhs.name != rhs.name, lhs.name.filter(\.isNumber) == rhs.name.filter(\.isNumber) else { return false }
    let a = Array(lhs.name), b = Array(rhs.name)
    let limit = min(2, min(a.count, b.count) / 8)
    guard limit > 0, max(a.count, b.count) <= 200, abs(a.count - b.count) <= limit else { return false }
    // Similarity only suggests a merge; applying a shared preset requires confirmation.
    var previous = Array(0...b.count)
    for (i, letter) in a.enumerated() {
        var row = [i + 1]
        for (j, other) in b.enumerated() {
            row.append(min(row[j] + 1, previous[j + 1] + 1, previous[j] + (letter == other ? 0 : 1)))
        }
        if row.min()! > limit { return false }
        previous = row
    }
    return previous[b.count] <= limit
}

func salaryEmployer(_ description: String) -> String? {
    let text = normalized(description)
    let patterns = [
        #"^пополнение\s*\.\s*зарплата\s*\.\s*(.+?)\s*\.?$"#,
        #"^пополнение\s*\.\s*(.+?)\s*\.\s*зарплата\s*\.?$"#
    ]
    for pattern in patterns {
        if let employer = firstMatch(pattern, in: text, group: 1) {
            let name = normalized(employer.replacingOccurrences(of: #"["«»“”„]"#, with: " ", options: .regularExpression)
                .replacingOccurrences(of: #"\s*\.\s*"#, with: ".", options: .regularExpression))
            if name.contains(where: \.isLetter) { return name }
        }
    }
    return nil
}

private let descriptionKeyCache: NSCache<NSString, NSString> = {
    let cache = NSCache<NSString, NSString>()
    cache.countLimit = 12_000
    cache.totalCostLimit = 8 * 1024 * 1024
    return cache
}()

func descriptionGroupKey(_ description: String, debit: Bool) -> String {
    let direction = debit ? "debit|" : "credit|"
    // Only pure text parsing is cached; edited descriptions and direction get distinct entries.
    let cacheKey = (direction + description) as NSString
    if let cached = descriptionKeyCache.object(forKey: cacheKey) { return cached as String }
    let key: String
    if let employer = salaryEmployer(description) {
        key = direction + "salary|" + employer
    } else if let identity = purchaseIdentity(description) {
        key = direction + identity.format + "|" + identity.name
    } else if let identity = sbpTransferIdentity(description) {
        key = direction + "sbp|" + identity.party + "|" + identity.phone
    } else {
        key = direction + "text|" + normalized(description)
    }
    descriptionKeyCache.setObject(key as NSString, forKey: cacheKey, cost: (cacheKey.length + key.utf16.count) * 2)
    return key
}

func descriptionGroupLabel(_ description: String) -> String {
    if let employer = salaryEmployer(description) { return "Зарплата · " + employer.uppercased() }
    if let identity = cardPurchaseIdentity(description) { return identity.merchant + " · MCC " + identity.mcc }
    if let identity = sbpTransferIdentity(description) { return "СБП · " + identity.party + " +" + identity.phone }
    return description
}

func resolveDescriptionRule(_ candidates: [DescriptionRule], for operation: Operation) -> DescriptionRule? {
    guard let first = candidates.first else { return nil }
    if candidates.allSatisfy({ $0.category == first.category && $0.kind == first.kind }) { return first }
    // При конфликте старых правил сохраняем их прежнее точное сопоставление.
    return candidates.first { rule in
        ([rule.description] + (rule.alternateDescriptions ?? [])).contains { normalized($0) == normalized(operation.details) }
    }
}

struct DescriptionGroup: Identifiable {
    var id: String
    var description: String
    var debit: Bool
    var operations: [Operation]
}

func descriptionGroups(_ operations: [Operation], rules: [DescriptionRule] = []) -> [DescriptionGroup] {
    let canonicalKeys = Dictionary(rules.flatMap { rule in rule.keys.map { ($0, rule.key) } }, uniquingKeysWith: { first, _ in first })
    let grouped = Dictionary(grouping: operations, by: {
        let key = descriptionGroupKey($0.details, debit: $0.amount < 0)
        return canonicalKeys[key] ?? key
    })
    let groups: [DescriptionGroup] = grouped.map { key, items in
        DescriptionGroup(id: key, description: items[0].details, debit: items[0].amount < 0, operations: items)
    }
    return groups.sorted { left, right in
        if left.operations.count != right.operations.count { return left.operations.count > right.operations.count }
        return left.id < right.id
    }
}

struct ImportRecord: Codable, Identifiable {
    var id = UUID()
    var filename: String
    var digest: String
    var importedAt = Date()
    var count: Int
    var warnings: [String]
}

struct Ledger: Codable {
    var version = 1
    var operations: [Operation] = []
    var imports: [ImportRecord] = []
    var transferOwners: [String: Bool]?
    var descriptionRules: [DescriptionRule]?
    var classificationVersion: Int? = 1
    var otherPhonesArePeople: Bool?
    var phoneNames: [String: String]?

    var transferOwnerRows: [TransferOwnerRow] {
        var rows: [String: TransferOwnerRow] = [:]
        let accounts = Set(operations.map { accountKey(bank: $0.bank, account: $0.account) })
        for operation in operations {
            guard let party = transferParty(operation) else { continue }
            rows[party.id, default: TransferOwnerRow(party: party, count: 0, hasStatement: accounts.contains(party.id))].count += 1
        }
        for id in ownPhoneIDs + Array((phoneNames ?? [:]).keys) where rows[id] == nil {
            rows[id] = TransferOwnerRow(party: TransferParty(id: id, label: "Телефон +" + id.dropFirst(6)), count: 0, hasStatement: false)
        }
        return rows.values.sorted { $0.party.label < $1.party.label }
    }

    var phoneContacts: [PhoneContact] {
        let found = operations.compactMap(transferParty).map(\.id) + Array((phoneNames ?? [:]).keys) + ownPhoneIDs
        let phones = Set(found.filter { $0.hasPrefix("phone|") && normalizedPhoneNumber(String($0.dropFirst(6))) != nil })
        let grouped = Dictionary(grouping: phones) { phone in
            let name = normalized(phoneNames?[phone] ?? "")
            return name.isEmpty ? phone : "name|" + name
        }
        return grouped.map { key, ids in
            let sorted = ids.sorted()
            let name = phoneNames?[sorted[0]] ?? ""
            return PhoneContact(id: key, name: name.isEmpty ? "+" + sorted[0].dropFirst(6) : name, phoneIDs: sorted)
        }.sorted {
            if $0.hasName != $1.hasName { return $0.hasName }
            return $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
    }

    func recipientLabel(for operation: Operation) -> String? {
        guard operation.amount < 0, let party = transferParty(operation), party.id.hasPrefix("phone|"),
              let name = phoneNames?[party.id]?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else { return nil }
        return "Кому: \(name) · +\(party.id.dropFirst(6))"
    }

    var ownPhoneIDs: [String] {
        (transferOwners ?? [:]).filter { $0.value && $0.key.hasPrefix("phone|") && normalizedPhoneNumber(String($0.key.dropFirst(6))) != nil }.map(\.key).sorted()
    }

    var availableCategories: [String] {
        let saved = Set(operations.map(\.category) + (descriptionRules ?? []).map(\.category))
        return categories + saved.subtracting(categories).filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.sorted()
    }

    mutating func migrateClassification() {
        guard classificationVersion == nil else { return }
        // Старые категории не имеют происхождения: сохраняем их до явного массового переназначения.
        for index in operations.indices where operations[index].category != "Без категории" && !operations[index].category.isEmpty {
            operations[index].manualCategory = true
        }
        classificationVersion = 1
    }

    func matchingRule(for operation: Operation) -> DescriptionRule? {
        let key = descriptionGroupKey(operation.details, debit: operation.amount < 0)
        return resolveDescriptionRule((descriptionRules ?? []).filter { $0.keys.contains(key) }, for: operation)
    }

    mutating func mergeEquivalentDescriptionRules() {
        guard let rules = descriptionRules else { return }
        let groups = Dictionary(grouping: rules, by: \.key)
        var seen = Set<String>()
        descriptionRules = rules.filter { rule in
            let equivalent = groups[rule.key]!.allSatisfy { $0.category == rule.category && $0.kind == rule.kind }
            return !equivalent || seen.insert(rule.key).inserted
        }.map { original in
            var rule = original
            let equivalent = groups[rule.key]!
            if equivalent.allSatisfy({ $0.category == rule.category && $0.kind == rule.kind }) {
                let alternatives = equivalent.flatMap { $0.alternateDescriptions ?? [] }
                if !alternatives.isEmpty { rule.alternateDescriptions = Array(Set(alternatives)).sorted() }
            }
            return rule
        }
    }

    mutating func reclassify() {
        for index in operations.indices {
            guard let base = operations[index].phoneRuleBase else { continue }
            if operations[index].manualCategory != true { operations[index].category = base.category }
            if operations[index].manualKind != true {
                operations[index].kind = base.kind
                operations[index].transferReason = base.transferReason
            }
            operations[index].phoneRuleBase = nil
        }
        let previousBases = Dictionary(operations.compactMap { operation in
            operation.ruleBase.map { (operation.id, $0) }
        }, uniquingKeysWith: { first, _ in first })
        for index in operations.indices {
            guard let base = operations[index].ruleBase else { continue }
            if operations[index].manualCategory != true { operations[index].category = base.category }
            if operations[index].manualKind != true {
                operations[index].kind = base.kind
                operations[index].transferReason = base.transferReason
            }
            operations[index].ruleBase = nil
        }
        classifyTransfers()
        let rules = Dictionary(grouping: (descriptionRules ?? []).flatMap { rule in rule.keys.map { (key: $0, rule: rule) } }, by: \.key)
        for index in operations.indices {
            let operation = operations[index]
            guard operation.kind != .pending,
                  let rule = resolveDescriptionRule((rules[descriptionGroupKey(operation.details, debit: operation.amount < 0)] ?? []).map(\.rule), for: operation) else { continue }
            let base = previousBases[operation.id]
            operations[index].ruleBase = OperationClassification(
                category: operation.manualCategory == true ? base?.category ?? operation.category : operation.category,
                kind: operation.manualKind == true ? base?.kind ?? operation.kind : operation.kind,
                transferReason: operation.manualKind == true ? base?.transferReason : operation.transferReason)
            if operation.manualCategory != true { operations[index].category = rule.category }
            if operation.manualKind != true {
                operations[index].kind = rule.kind
                operations[index].transferReason = nil
            }
        }
        guard otherPhonesArePeople == true, !ownPhoneIDs.isEmpty else { return }
        for index in operations.indices {
            let operation = operations[index]
            guard operation.manualKind != true,
                  [.review, .transfer, .outgoingTransfer, .incomingTransfer, .expense, .income].contains(operation.kind),
                  let party = transferParty(operation), party.id.hasPrefix("phone|") else { continue }
            operations[index].phoneRuleBase = OperationClassification(category: operation.category, kind: operation.kind, transferReason: operation.transferReason)
            let own = transferOwners?[party.id] == true
            operations[index].kind = own ? .transfer : operation.amount < 0 ? .outgoingTransfer : .incomingTransfer
            operations[index].transferReason = own ? "Номер указан как твой" : "Включено правило: остальные номера принадлежат другим людям"
            if operation.manualCategory != true, ["Без категории", "Переводы", "Переводы людям", "Переводы от людей", "Доходы"].contains(operation.category) {
                operations[index].category = own ? "Переводы" : operation.amount < 0 ? "Переводы людям" : "Переводы от людей"
            }
        }
    }

    mutating func setDescriptionRule(_ proposed: DescriptionRule, replaceManual: Bool = false) throws {
        var rule = proposed
        rule.description = rule.description.trimmingCharacters(in: .whitespacesAndNewlines)
        rule.category = rule.category.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !rule.description.isEmpty, !rule.category.isEmpty, rule.kind != .pending else {
            throw FinanceError.message("Заполни описание и категорию; ожидание подтверждения задаётся банком, а не правилом.")
        }
        var rules = descriptionRules ?? []
        let sameGroup = rules.filter { $0.key == rule.key }
        let resolvingConflict = sameGroup.count > 1 && sameGroup.contains { $0.id == rule.id }
        let alternatives = (rule.alternateDescriptions ?? []) + (resolvingConflict ? sameGroup.flatMap { $0.alternateDescriptions ?? [] } : [])
        var seen = Set([rule.key])
        let unique = alternatives.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter {
            !$0.isEmpty && seen.insert(descriptionGroupKey($0, debit: rule.debit)).inserted
        }
        rule.alternateDescriptions = unique.isEmpty ? nil : unique
        let matchingKeys = rule.keys
        guard !rules.contains(where: {
            $0.id != rule.id && !(resolvingConflict && $0.key == rule.key) && !$0.keys.isDisjoint(with: matchingKeys)
        }) else {
            throw FinanceError.message("Для одного из этих описаний уже есть правило. Объедини группы или отредактируй существующее правило.")
        }
        if resolvingConflict { rules.removeAll { $0.key == rule.key && $0.id != rule.id } }
        if let index = rules.firstIndex(where: { $0.id == rule.id }) { rules[index] = rule }
        else { rules.append(rule) }
        descriptionRules = rules
        if replaceManual {
            for index in operations.indices where operations[index].kind != .pending && matchingKeys.contains(descriptionGroupKey(operations[index].details, debit: operations[index].amount < 0)) {
                operations[index].manualCategory = false
                operations[index].manualKind = false
            }
        }
        reclassify()
    }

    func preset(for group: DescriptionGroup) -> DescriptionRule {
        descriptionRules?.first { $0.key == group.id } ??
            DescriptionRule(description: group.description, debit: group.debit, category: group.operations[0].category,
                            kind: group.operations[0].kind == .pending ? (group.debit ? .expense : .income) : group.operations[0].kind)
    }

    mutating func mergeDescriptionGroups(sourceID: String, targetID: String) throws {
        let groups = descriptionGroups(operations, rules: descriptionRules ?? [])
        guard sourceID != targetID, let source = groups.first(where: { $0.id == sourceID }),
              let target = groups.first(where: { $0.id == targetID }), source.debit == target.debit else {
            throw FinanceError.message("Выбери две существующие группы одного направления.")
        }
        let replaced = (descriptionRules ?? []).filter { $0.key == sourceID || $0.key == targetID }
        var rule = preset(for: target)
        rule.alternateDescriptions = replaced.flatMap { [$0.description] + ($0.alternateDescriptions ?? []) } + [source.description, target.description]
        var updated = self
        updated.descriptionRules = (descriptionRules ?? []).filter { $0.key != sourceID && $0.key != targetID }
        try updated.setDescriptionRule(rule)
        self = updated
    }

    mutating func removeDescriptionRule(_ id: UUID) {
        descriptionRules?.removeAll { $0.id == id }
        reclassify()
    }


    mutating func append(_ result: ParsedStatement, filename: String, digest: String) throws {
        guard !imports.contains(where: { $0.digest == digest }) else {
            throw FinanceError.message("Этот файл уже загружен: \(filename)")
        }
        let previous = Set(operations.map(\.fingerprint))
        var knownIDs = Dictionary(operations.filter { !$0.bankID.isEmpty }.map { ($0.bank + "|" + $0.account + "|" + $0.bankID, $0) }, uniquingKeysWith: { first, _ in first })
        var duplicateCount = 0
        var added: [Operation] = []
        for operation in result.operations {
            if !operation.bankID.isEmpty, let previous = knownIDs[operation.bank + "|" + operation.account + "|" + operation.bankID] {
                guard previous.amount == operation.amount, previous.currency == operation.currency, previous.date == operation.date else {
                    throw FinanceError.message("Операция с тем же банковским кодом изменилась. Импорт отменён: \(filename)")
                }
                duplicateCount += 1
            } else {
                added.append(operation)
                if !operation.bankID.isEmpty { knownIDs[operation.bank + "|" + operation.account + "|" + operation.bankID] = operation }
            }
        }
        for i in added.indices {
            // Совпадение без банковского ID — только кандидат: две покупки могут быть одинаковыми.
            added[i].possibleDuplicate = previous.contains(added[i].fingerprint)
        }
        try validateAmounts(operations + added)
        operations += added
        reclassify()
        var warnings = result.warnings
        if duplicateCount > 0 { warnings.append("Уже были загружены по банковскому коду: \(duplicateCount). Повторно не добавлены.") }
        imports.append(ImportRecord(filename: filename, digest: digest, count: added.count, warnings: warnings))
    }

    mutating func classifyTransfers() {
        let ownAccounts = Set(operations.map { accountKey(bank: $0.bank, account: $0.account) })
        for index in operations.indices {
            let operation = operations[index]
            guard operation.manualKind != true, operation.kind == .review || operation.transferReason != nil else { continue }
            let decision = transferDecision(operation, owners: transferOwners ?? [:], ownAccounts: ownAccounts)
            operations[index].kind = decision?.kind ?? .review
            operations[index].transferReason = decision?.reason
            if operation.manualCategory != true, ["Без категории", "Переводы", "Переводы людям"].contains(operation.category) {
                operations[index].category = decision == nil ? "Без категории" : decision?.kind == .transfer ? "Переводы" : "Переводы людям"
            }
        }
    }
}

struct TransferParty: Identifiable, Hashable {
    var id: String
    var label: String
}

struct TransferOwnerRow: Identifiable {
    var party: TransferParty
    var count: Int
    var hasStatement: Bool
    var id: String { party.id }
}

struct PhoneContact: Identifiable {
    var id: String
    var name: String
    var phoneIDs: [String]
    var hasName: Bool { id.hasPrefix("name|") }

    func transfers(in operations: [Operation]) -> [Operation] {
        let indexed = transfersByPhone(operations)
        return phoneIDs.flatMap { indexed[$0] ?? [] }
    }
}

func transfersByPhone(_ operations: [Operation]) -> [String: [Operation]] {
    var result: [String: [Operation]] = [:]
    for operation in operations where operation.kind != .pending && operation.kind != .excluded && operation.amount != 0 {
        if let party = transferParty(operation), party.id.hasPrefix("phone|") {
            result[party.id, default: []].append(operation)
        }
    }
    return result
}

func accountKey(bank: String, account: String) -> String { "account|\(bank)|\(account)" }

func normalizedPhoneNumber(_ value: String) -> String? {
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.range(of: #"^\+?[78][0-9 ()-]*$"#, options: .regularExpression) != nil else { return nil }
    var digits = text.filter(\.isNumber)
    guard digits.count == 11 else { return nil }
    if digits.first == "8" { digits.replaceSubrange(digits.startIndex...digits.startIndex, with: "7") }
    return digits
}

func transferParty(_ operation: Operation) -> TransferParty? {
    let text = normalized(operation.details)
    guard !text.contains("c2b"), !text.contains("операция по карте"), !text.hasPrefix("оплата в "),
          ["перевод", "перечислен", "пополнение"].contains(where: text.contains) else { return nil }
    if let from = firstMatch(#"(?:со|с) счета\s*(\d{20})(?!\d)"#, in: text, group: 1),
       let to = firstMatch(#"на счет\s*(\d{20})(?!\d)"#, in: text, group: 1) {
        // Проверяем сторону выписки, чтобы случайно не запомнить её собственный счёт как получателя.
        guard (operation.amount < 0 ? from : to) == operation.account else { return nil }
        let other = operation.amount < 0 ? to : from
        return TransferParty(id: accountKey(bank: operation.bank, account: other), label: "\(operation.bank) · счёт \(other)")
    }
    let marker = operation.amount < 0 ? #"(?:по номеру телефона|на)\s*"# : #"(?:по номеру телефона|от)\s*"#
    guard let number = firstMatch(marker + #"(\+?[78][\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2})(?![\d*])"#, in: text, group: 1) else { return nil }
    guard let digits = normalizedPhoneNumber(number) else { return nil }
    return TransferParty(id: "phone|" + digits, label: "Телефон +" + digits)
}

func transferDecision(_ operation: Operation, owners: [String: Bool], ownAccounts: Set<String>) -> (kind: OperationKind, reason: String)? {
    if let party = transferParty(operation) {
        if let own = owners[party.id] {
            return (own ? .transfer : operation.amount < 0 ? .outgoingTransfer : .incomingTransfer,
                    own ? "Ты отметил эти реквизиты как свои" : "Ты отметил эти реквизиты как чужие")
        }
        if ownAccounts.contains(party.id) { return (.transfer, "Оба счёта встречаются в твоих выписках") }
    }
    if normalized(operation.details).contains("перевод другому клиенту") {
        return (operation.amount < 0 ? .outgoingTransfer : .incomingTransfer, "Банк указал перевод другому клиенту")
    }
    return nil
}

func namedInternalTransfer(_ details: String, owner: String, amount: Int64) -> OperationKind? {
    guard !owner.isEmpty,
          let recipient = firstMatch(#"внутрибанковский перевод между счетами,\s*(.+?)\.\s*со счета"#, in: normalized(details), group: 1) else { return nil }
    func nameParts(_ name: String) -> [String] { normalized(name).split { !$0.isLetter }.map(String.init) }
    let own = nameParts(owner), other = nameParts(recipient)
    guard own.count == 3, other.count == 3 else { return nil }
    if own == other { return .transfer }
    // Разные сокращения одного имени не доказывают, что получатель чужой.
    if own[0] != other[0] || own[1].first != other[1].first || own[2].first != other[2].first {
        return amount < 0 ? .outgoingTransfer : .incomingTransfer
    }
    return nil
}

func dayKey(_ date: Date, timeZone: TimeZone = .current) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
}

func dateMatches(_ date: String, period: String, from: String, through: String) -> Bool {
    switch period {
    case "Все месяцы": return true
    case "Один день": return date == from
    case "Диапазон дат": return from <= through && date >= from && date <= through
    default: return date.hasPrefix(period)
    }
}

func validateAmounts(_ operations: [Operation]) throws {
    guard operations.count <= 200_000 else { throw FinanceError.message("В базе больше 200 000 операций") }
    var magnitude: Int64 = 0
    for operation in operations {
        guard operation.amount != Int64.min else { throw FinanceError.message("Недопустимая сумма") }
        let (sum, overflow) = magnitude.addingReportingOverflow(abs(operation.amount))
        guard !overflow else { throw FinanceError.message("Слишком большая суммарная величина операций") }
        magnitude = sum
    }
}

struct ParsedStatement {
    var operations: [Operation]
    var warnings: [String] = []
}

enum FinanceError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case .message(let message) = self { return message }
        return nil
    }
}

func digestOf(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

func normalized(_ value: String) -> String {
    value.lowercased().replacingOccurrences(of: "ё", with: "е")
        .replacingOccurrences(of: "\u{00a0}", with: " ")
        .split(whereSeparator: \.isWhitespace).joined(separator: " ")
}

func money(_ raw: String) throws -> Int64 {
    var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "−", with: "-")
        .replacingOccurrences(of: "–", with: "-")
    for suffix in ["RUB", "RUR", "руб.", "руб", "₽", "USD", "EUR", "$", "€"] {
        text = text.replacingOccurrences(of: suffix, with: "", options: .caseInsensitive)
    }
    text = text.filter { !$0.isWhitespace }
    if text.hasPrefix("("), text.hasSuffix(")") { text = "-" + text.dropFirst().dropLast() }
    if text.contains(","), text.contains(".") {
        guard let comma = text.lastIndex(of: ","), let dot = text.lastIndex(of: ".") else {
            throw FinanceError.message("Не удалось разобрать сумму")
        }
        text = comma > dot ? text.replacingOccurrences(of: ".", with: "") : text.replacingOccurrences(of: ",", with: "")
    }
    text = text.replacingOccurrences(of: ",", with: ".")
    guard text.range(of: #"^[+-]?\d+(?:\.\d{1,2})?$"#, options: .regularExpression) != nil,
          let decimal = Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")),
          abs(decimal) <= Decimal(1_000_000_000_000 as Int64) else {
        throw FinanceError.message("Не удалось разобрать сумму: \(raw)")
    }
    return NSDecimalNumber(decimal: decimal * 100).int64Value
}

func operationDate(_ raw: String) throws -> String {
    let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    let patterns = ["dd.MM.yyyy HH:mm:ss", "dd.MM.yyyy HH:mm", "dd.MM.yyyy", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd", "dd/MM/yyyy"]
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.isLenient = false
    for pattern in patterns {
        formatter.dateFormat = pattern
        if let date = formatter.date(from: value) {
            formatter.dateFormat = "yyyy-MM-dd"
            return formatter.string(from: date)
        }
    }
    throw FinanceError.message("Не удалось разобрать дату: \(raw)")
}

let categories = ["Продукты", "Кафе и рестораны", "Транспорт", "Жильё и ЖКХ", "Здоровье", "Покупки", "Развлечения", "Связь и подписки", "Оплата Codex", "Путешествия", "Образование", "Комиссии", "Другое", "Без категории"]

func suggest(details: String, amount: Int64, bankCategory: String = "") -> (OperationKind, String) {
    let text = normalized(details)
    if ["между своими", "между собственными", "на свой счет", "перевод себе", "инвесткопил", "копилка для сдачи", "вывод средств с брокерского счета"].contains(where: text.contains) {
        return (.transfer, "Переводы")
    }
    if amount > 0, ["возврат покупки", "возврат средств за", "отмена покупки", "возврат оплаты"].contains(where: text.contains) {
        return (.refund, bankCategory.isEmpty ? "Без категории" : bankCategory)
    }
    if amount > 0, ["зарплата", "заработная плата", "проценты на остаток", "кэшбэк", "кешбэк"].contains(where: text.contains) { return (.income, "Доходы") }
    let merchantPayment = text.contains("c2b") || text.contains("операция по карте") || text.hasPrefix("оплата в ")
    if !merchantPayment && ["перевод", "снятие наличных", "пополнение", "погашение кредит", "сберегательный взнос"].contains(where: text.contains) {
        return (.review, "Без категории")
    }
    if amount >= 0 { return (.income, "Доходы") }
    if text.range(of: #"\bcodex\b"#, options: .regularExpression) != nil { return (.expense, "Оплата Codex") }
    if !bankCategory.isEmpty, !["прочие операции", "финансовые операции"].contains(normalized(bankCategory)) { return (.expense, bankCategory) }
    if let range = text.range(of: #"mcc:\s*\d{4}"#, options: .regularExpression),
       let code = Int(text[range].filter(\.isNumber)) {
        switch code {
        case 5411, 5422, 5441, 5451, 5462, 5499: return (.expense, "Продукты")
        case 5812, 5813, 5814: return (.expense, "Кафе и рестораны")
        case 4111, 4112, 4121, 4131, 4784, 5541, 5542: return (.expense, "Транспорт")
        case 5912, 8011, 8021, 8062, 8099: return (.expense, "Здоровье")
        case 4812, 4814, 4816: return (.expense, "Связь и подписки")
        case 4900: return (.expense, "Жильё и ЖКХ")
        default: break
        }
    }
    let rules: [(String, [String])] = [
        ("Продукты", ["пятероч", "пятёроч", "perekrestok", "перекрест", "vkusvill", "вкусвилл", "magnit", "магнит", "azbuka", "продукт", "pyateroch", "mariya-ra"]),
        ("Кафе и рестораны", ["restaurant", "ресторан", "cafe", "кафе", "coffee", "кофе", "burger", "бургер", "столов"]),
        ("Транспорт", ["taxi", "такси", "metro", "метро", "тройка", "парков", "заправ", "azs"]),
        ("Жильё и ЖКХ", ["жкх", "коммуналь", "квартплат", "мосэнерг"]),
        ("Здоровье", ["аптек", "apteka", "клиник", "стомат", "pharmacy"]),
        ("Связь и подписки", ["мобильная связь", "телефон", "мегафон", "мтс", "tele2", "билайн", "подписк"]),
        ("Комиссии", ["комиссия", "обслуживание карты"])
    ]
    for (category, keywords) in rules where keywords.contains(where: text.contains) { return (.expense, category) }
    return (.expense, "Без категории")
}

func merchantName(_ operation: Operation) -> String {
    if let range = operation.details.range(of: "место совершения операции:", options: .caseInsensitive) {
        let tail = operation.details[range.upperBound...].components(separatedBy: ", MCC:")[0]
        return tail.trimmingCharacters(in: .whitespaces)
    }
    if operation.details.hasPrefix("Оплата в ") { return String(operation.details.dropFirst(9)) }
    return operation.details
}

struct ExpenseGroup: Identifiable {
    var label: String
    var amount: Int64
    var id: String { label }
}

func groupedExpenses(_ operations: [Operation], key: (Operation) -> String) -> [ExpenseGroup] {
    var sums: [String: Int64] = [:]
    for operation in operations where operation.expenseAmount != 0 {
        sums[key(operation), default: 0] += operation.expenseAmount
    }
    return sums.map { ExpenseGroup(label: $0.key, amount: $0.value) }.sorted { $0.amount > $1.amount }
}

func incomeSource(_ operation: Operation, phoneNames: [String: String] = [:]) -> String {
    if operation.amount > 0, let party = transferParty(operation), party.id.hasPrefix("phone|"),
       let name = phoneNames[party.id]?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
        return "Переводы · " + name
    }
    if sbpTransferIdentity(operation.details) != nil { return descriptionGroupLabel(operation.details) }
    if !["Доходы", "Переводы", "Переводы людям", "Без категории", ""].contains(operation.category) {
        return operation.category
    }
    let text = normalized(operation.details)
    if text.range(of: #"^перевод (?:с|со) договора\s+№?\s*\d+\.?$"#, options: .regularExpression) != nil {
        return "Переводы с договоров"
    }
    if text.range(of: #"^(?:начисление\s+)?к[еэ]шб[еэ]к(?:а)?(?:\s|[.:]|$)"#, options: .regularExpression) != nil {
        return "Кэшбэк"
    }
    return descriptionGroupLabel(operation.details)
}

func groupedIncome(_ operations: [Operation], phoneNames: [String: String] = [:]) -> [ExpenseGroup] {
    var sources: [String: ExpenseGroup] = [:]
    for operation in operations where operation.incomeAmount > 0 {
        let label = incomeSource(operation, phoneNames: phoneNames)
        sources[normalized(label), default: ExpenseGroup(label: label, amount: 0)].amount += operation.incomeAmount
    }
    return sources.values.sorted { $0.amount == $1.amount ? $0.label < $1.label : $0.amount > $1.amount }
}

struct BreakdownSelection: Identifiable {
    var label: String
    var isIncome: Bool
    var id: String { (isIncome ? "income|" : "expense|") + label }

    func operations(in items: [Operation], phoneNames: [String: String] = [:]) -> [Operation] {
        items.filter { operation in
            if isIncome { return operation.incomeAmount > 0 && normalized(incomeSource(operation, phoneNames: phoneNames)) == normalized(label) }
            return operation.expenseAmount != 0 && operation.category == label
        }
    }
}

struct PeriodCashFlow: Identifiable {
    var period: String
    var expenses: Int64 = 0
    var income: Int64 = 0
    var savings: Int64 = 0
    var id: String { period }
}

func cashFlow(_ operations: [Operation], byMonth: Bool = false, expenseCategory: String? = nil) -> [PeriodCashFlow] {
    var periods: [String: PeriodCashFlow] = [:]
    for operation in operations where byMonth || operation.expenseAmount != 0 || operation.incomeAmount != 0 || operation.savingsAmount != 0 {
        let period = byMonth ? String(operation.date.prefix(7)) : operation.date
        periods[period, default: PeriodCashFlow(period: period)].expenses +=
            expenseCategory == nil || operation.category == expenseCategory ? operation.expenseAmount : 0
        periods[period, default: PeriodCashFlow(period: period)].income += operation.incomeAmount
        periods[period, default: PeriodCashFlow(period: period)].savings += operation.savingsAmount
    }
    return periods.values.sorted { $0.period < $1.period }
}

enum CashFlowMeasure: String {
    case expenses = "Расходы"
    case income = "Поступления"
    case savings = "На накопления"

    func amount(_ operation: Operation) -> Int64 {
        switch self {
        case .expenses: return operation.expenseAmount
        case .income: return operation.incomeAmount
        case .savings: return operation.savingsAmount
        }
    }
}

struct CashFlowSelection: Identifiable {
    var period: String
    var measure: CashFlowMeasure = .expenses
    var category: String?
    var id: String { "\(period)|\(measure.rawValue)|\(category ?? "")" }

    func operations(in items: [Operation]) -> [Operation] {
        items.filter {
            $0.date.hasPrefix(period) && measure.amount($0) != 0 &&
            (measure != .expenses || category == nil || $0.category == category)
        }
    }
}

func chartDayLabel(_ day: String) -> String {
    String(day.suffix(2)) + "." + String(day.dropFirst(5).prefix(2))
}

func formattedMoney(_ amount: Int64, currency: String = "RUB") -> String {
    let formatter = NumberFormatter()
    formatter.locale = Locale(identifier: "ru_RU")
    formatter.numberStyle = .currency
    formatter.currencyCode = currency
    return formatter.string(from: NSDecimalNumber(decimal: Decimal(amount) / 100)) ?? "\(amount) коп."
}
