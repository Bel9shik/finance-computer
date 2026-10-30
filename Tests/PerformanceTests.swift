import Foundation

@main struct PerformanceProbe {
    static func measure<T>(_ label: String, _ action: () throws -> T) rethrows -> T {
        let start = Date()
        let value = try action()
        print("\(label): \(String(format: "%.4f", Date().timeIntervalSince(start)))s")
        fflush(stdout)
        return value
    }
    static func main() throws {
        let count = 240
        let rules = (0..<count).map { index in
            DescriptionRule(description: index % 2 == 0
                ? "Оплата в SHOP_\(index) Novosibirsk RUS"
                : "Операция по карте: 000000******1111, дата создания транзакции: 10-10-2026, место совершения операции: RU/Novosibirsk/SHOP_\(index), MCC: 5411",
                category: "Категория \(index % 12)", kind: .expense)
        }
        let operations = (0..<4800).map { index in
            Operation(date: "2026-10-10", bank: "Test", account: "test", details: rules[index % count].description,
                      amount: -10000, currency: "RUB", category: "Без категории", kind: .expense, source: "test", sourceRow: String(index))
        }
        print("Synthetic operations=\(operations.count), presets=\(rules.count)")
        let groups = measure("grouping") { descriptionGroups(operations, rules: rules) }
        let rows = measure("preset-list lookup") {
            let index = Dictionary(grouping: rules, by: \.key)
            return rules.map { index[$0.key]?.count ?? 0 }
        }
        precondition(groups.count == count && rows.allSatisfy { $0 == 1 })
        let matches = measure("open editor") {
            let keys = rules[0].keys
            return operations.filter { keys.contains(descriptionGroupKey($0.details, debit: $0.amount < 0)) }
        }
        precondition(matches.count == 20)
        var ledger = Ledger(operations: operations, descriptionRules: rules)
        var edit = rules[0]; edit.category = "Изменено"
        try measure("apply edited preset") { try ledger.setDescriptionRule(edit) }
        precondition(ledger.operations.filter { $0.category == "Изменено" }.count == 20)
    }
}
