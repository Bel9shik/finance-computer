import Foundation

// Read-only oracle: never constructs FinanceStore or modifies the source ledger.
@main struct SwiftOracle {
    static func main() throws {
        let input = URL(fileURLWithPath: CommandLine.arguments[1])
        let data = try Data(contentsOf: input)
        let encoder = JSONEncoder()
        var ledger: Ledger
        if input.pathExtension == "json" {
            ledger = try JSONDecoder().decode(Ledger.self, from: data)
            ledger.migrateClassification()
            ledger.mergeEquivalentDescriptionRules()
            ledger.reclassify()
        } else {
            ledger = Ledger(operations: try parseStatement(data, filename: input.lastPathComponent).operations)
        }
        let payload = try JSONSerialization.jsonObject(with: encoder.encode(ledger))
        let derived = ledger.operations.map { o -> [String: Any] in
            let suggestion = suggest(details: o.details, amount: o.amount)
            return ["group": descriptionGroupKey(o.details, debit: o.amount < 0),
                    "party": transferParty(o)?.id ?? "", "source": incomeSource(o, phoneNames: ledger.phoneNames ?? [:]),
                    "expenses": String(o.expenseAmount), "income": String(o.incomeAmount), "savings": String(o.savingsAmount),
                    "review": o.needsReview, "suggestKind": suggestion.0.rawValue, "suggestCategory": suggestion.1]
        }
        let result = try JSONSerialization.data(withJSONObject: ["ledger": payload, "derived": derived], options: [.sortedKeys])
        FileHandle.standardOutput.write(result)
    }
}
