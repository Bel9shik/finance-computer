import Foundation
import PDFKit

func firstMatch(_ pattern: String, in text: String, group: Int = 0) -> String? {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
          let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
          group < match.numberOfRanges, let range = Range(match.range(at: group), in: text) else { return nil }
    return String(text[range])
}

func currencyCode(_ raw: String) throws -> String {
    let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    if ["RUR", "RUB", "₽", "РУБ."].contains(value) { return "RUB" }
    if value == "$" { return "USD" }
    if value == "€" { return "EUR" }
    guard value.range(of: #"^[A-Z]{3}$"#, options: .regularExpression) != nil else {
        throw FinanceError.message("Не удалось определить валюту: \(raw)")
    }
    return value
}

func reconcile(_ operations: [Operation], income: Int64?, expense: Int64?, currency: String, source: String, includePending: Bool = false) throws -> [String] {
    try validateAmounts(operations)
    let confirmed = operations.filter { (includePending || $0.kind != .pending) && $0.currency == currency }
    let actualIncome = confirmed.filter { $0.amount > 0 }.reduce(Int64(0)) { $0 + $1.amount }
    let actualExpense = confirmed.filter { $0.amount < 0 }.reduce(Int64(0)) { $0 - $1.amount }
    if let income, actualIncome != income {
        throw FinanceError.message("\(source): сумма поступлений не сошлась с итогом банка. Импорт отменён, чтобы не потерять операции.")
    }
    if let expense, actualExpense != expense {
        throw FinanceError.message("\(source): сумма списаний не сошлась с итогом банка. Импорт отменён, чтобы не исказить расходы.")
    }
    return income == nil || expense == nil ? ["В файле нет обоих контрольных итогов. Полноту импорта нужно проверить вручную."] : []
}

func parseStatement(_ data: Data, filename: String) throws -> ParsedStatement {
    guard data.count <= 25 * 1024 * 1024 else { throw FinanceError.message("Максимальный размер файла — 25 МБ") }
    let result: ParsedStatement
    switch (filename as NSString).pathExtension.lowercased() {
    case "pdf": result = try parseTBankPDF(data, filename: filename)
    case "xlsx": result = try parseAlfaXLSX(data, filename: filename)
    default: throw FinanceError.message("Поддерживаются PDF Т‑Банка и XLSX Альфа‑Банка")
    }
    try validateAmounts(result.operations)
    return result
}

func parseAlfaXLSX(_ data: Data, filename: String) throws -> ParsedStatement {
    let sheets = try spreadsheetSheets(data)
    var result = ParsedStatement(operations: [])
    for (sheet, rows) in sheets {
        guard let headerIndex = rows.firstIndex(where: { $0.cells.contains { normalized($0) == "дата операции" } }) else { continue }
        let allText = normalized(rows.flatMap(\.cells).joined(separator: " "))
        guard allText.contains("альфа-банк") || allText.contains("альфа банк") else {
            throw FinanceError.message("XLSX не распознан как выписка Альфа‑Банка")
        }
        let header = rows[headerIndex].cells.map(normalized)
        func column(_ names: [String]) -> Int? { header.firstIndex { names.contains($0) } }
        guard let dateColumn = column(["дата операции"]), let amountColumn = column(["сумма в валюте счета"]),
              let descriptionColumn = column(["описание"]) else {
            throw FinanceError.message("Неизвестные столбцы XLSX. Нужны дата, описание и сумма в валюте счёта.")
        }
        let categoryColumn = column(["категория"])
        let codeColumn = column(["код"])
        let postedColumn = column(["дата проводки"])
        let statusColumn = column(["статус"])
        func meta(_ label: String) -> String? {
            for row in rows.prefix(headerIndex) {
                if let index = row.cells.firstIndex(where: { normalized($0) == label }) {
                    return row.cells.dropFirst(index + 1).first { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
                }
            }
            return nil
        }
        guard let rawCurrency = meta("валюта счета"), let account = meta("номер счета"), !account.isEmpty else {
            throw FinanceError.message("В XLSX не найдены номер и валюта счёта")
        }
        let currency = try currencyCode(rawCurrency)
        let owner = normalized(meta("клиент") ?? "")
        var operations: [Operation] = []
        for row in rows.dropFirst(headerIndex + 1) {
            func cell(_ index: Int?) -> String {
                guard let index, row.cells.indices.contains(index) else { return "" }
                return row.cells[index].trimmingCharacters(in: .whitespacesAndNewlines)
            }
            let rawDate = cell(dateColumn)
            let rawAmount = cell(amountColumn)
            if normalized(rawDate) == "дата операции" { continue }
            guard !rawAmount.isEmpty || firstMatch(#"^\d{2}\.\d{2}\.\d{4}"#, in: rawDate) != nil else { continue }
            let context = "\(sheet), строка \(row.number)"
            do {
                let date: String
                if let serial = Double(rawDate), (1...100_000).contains(serial) {
                    let reference = Date(timeIntervalSince1970: -2_209_161_600) // 1899-12-30: календарь Excel 1900.
                    let formatter = DateFormatter()
                    formatter.dateFormat = "yyyy-MM-dd"; formatter.timeZone = TimeZone(secondsFromGMT: 0)
                    formatter.locale = Locale(identifier: "en_US_POSIX")
                    date = formatter.string(from: reference.addingTimeInterval(serial.rounded(.down) * 86400))
                } else { date = try operationDate(rawDate) }
                let amount = try money(rawAmount)
                let details = cell(descriptionColumn)
                guard !details.isEmpty else { throw FinanceError.message("Пустое описание операции") }
                var (kind, category) = suggest(details: details, amount: amount, bankCategory: cell(categoryColumn))
                if let transferKind = namedInternalTransfer(details, owner: owner, amount: amount) {
                    kind = transferKind
                    category = kind == .transfer ? "Переводы" : "Переводы людям"
                }
                let status = normalized(cell(statusColumn))
                if cell(postedColumn).uppercased() == "HOLD" || status.contains("обработ") || status.contains("неподтвержден") {
                    kind = .pending
                } else if !status.isEmpty && !["выполнен", "исполнен", "проведен", "выполнена"].contains(status) {
                    throw FinanceError.message("Неизвестный статус «\(cell(statusColumn))»")
                }
                var operation = Operation(date: date, bank: "Альфа‑Банк", account: account, details: details, amount: amount,
                                          currency: currency, category: category, kind: kind, source: filename, sourceRow: context)
                operation.bankID = cell(codeColumn)
                operations.append(operation)
            } catch { throw FinanceError.message("\(context): \(error.localizedDescription). Файл не импортирован.") }
        }
        guard !operations.isEmpty else { throw FinanceError.message("В XLSX нет операций") }
        let income = try meta("поступления").map(money)
        let expense = try meta("расходы").map(money)
        // В этой форме Альфы итог «Расходы» включает HOLD, хотя в графики HOLD не попадает.
        result.warnings += try reconcile(operations, income: income, expense: expense, currency: currency, source: sheet, includePending: true)
        let pending = operations.filter { $0.kind == .pending }
        if !pending.isEmpty {
            if let pendingTotal = meta("неподтвержденные операции") {
                guard try money(pendingTotal) == pending.reduce(Int64(0), { $0 + abs($1.amount) }) else {
                    throw FinanceError.message("Не сошлась сумма неподтверждённых операций Альфа‑Банка")
                }
            }
            result.warnings.append("Ожидают подтверждения: \(pending.count) операций на \(formattedMoney(pending.reduce(0, { $0 + abs($1.amount) }), currency: currency)). Они сохранены, но не включены в расходы.")
        }
        result.operations += operations
    }
    guard !result.operations.isEmpty else { throw FinanceError.message("Не найдена таблица операций Альфа‑Банка") }
    return result
}

func parseTBankPDF(_ data: Data, filename: String) throws -> ParsedStatement {
    guard let document = PDFDocument(data: data), !document.isLocked else {
        throw FinanceError.message("PDF повреждён или защищён паролем")
    }
    guard document.pageCount <= 200 else { throw FinanceError.message("PDF содержит больше 200 страниц") }
    let text = document.string ?? ""
    let bankText = normalized(text)
    guard bankText.contains("справка о движении средств"), bankText.contains("тбанк") || bankText.contains("тинькофф") else {
        throw FinanceError.message("Нужна текстовая «Справка о движении средств» Т‑Банка. Сканированные PDF и другие формы пока не поддерживаются.")
    }
    guard let account = firstMatch(#"Номер лицевого счета:\s*(\d{20})"#, in: text, group: 1) else {
        throw FinanceError.message("Не найден номер счёта в PDF")
    }
    var result = ParsedStatement(operations: [])
    var income: Int64?
    var expense: Int64?
    var controlCurrency: String?
    for pageIndex in 0..<document.pageCount {
        guard let page = document.page(at: pageIndex), let pageText = page.string,
              let selection = page.selection(for: NSRange(location: 0, length: (pageText as NSString).length)) else {
            throw FinanceError.message("Не удалось прочитать страницу \(pageIndex + 1)")
        }
        let lines = selection.selectionsByLine()
        func selections(_ pattern: String) -> [PDFSelection] {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { return [] }
            return regex.matches(in: pageText, range: NSRange(pageText.startIndex..., in: pageText))
                .compactMap { page.selection(for: $0.range) }
        }
        let totalLines = selections("Пополнения:|Расходы:")
        for line in totalLines {
            let bounds = line.bounds(for: page)
            let value = page.selection(for: CGRect(x: bounds.maxX + 1, y: bounds.minY - 1, width: page.bounds(for: .mediaBox).width - bounds.maxX - 1, height: bounds.height + 2))?.string ?? ""
            guard let code = firstMatch(#"(₽|RUB|RUR|USD|EUR|\$|€)"#, in: value) else { throw FinanceError.message("Не определена валюта итогов PDF") }
            let currency = try currencyCode(code)
            if let controlCurrency, controlCurrency != currency { throw FinanceError.message("Разные валюты контрольных итогов PDF") }
            controlCurrency = currency
            if normalized(line.string ?? "") == "пополнения:" { income = try money(value) }
            else { expense = try money(value) }
        }
        guard let dateHeader = selections("Дата и время").first else {
            // The bank can place totals and the signature on a separate final page.
            let summaryLabels = Set(totalLines.map { normalized($0.string ?? "") })
            if pageIndex == document.pageCount - 1, !result.operations.isEmpty,
               totalLines.count == 2, summaryLabels == ["пополнения:", "расходы:"],
               normalized(pageText).contains("с уважением"),
               selections(#"\b\d{2}\.\d{2}\.\d{4}\b"#).isEmpty {
                continue
            }
            throw FinanceError.message("Страница \(pageIndex + 1): не найден заголовок таблицы")
        }
        let headerY = dateHeader.bounds(for: page).minY
        func header(_ name: String) -> PDFSelection? {
            selections(name).first { abs($0.bounds(for: page).minY - headerY) < 3 }
        }
        guard let amountHeader = header("сумма операции"),
              let descriptionHeader = header("описание"), let cardHeader = header("номер") else {
            throw FinanceError.message("Страница \(pageIndex + 1): не распознана таблица Т‑Банка. Импорт отменён.")
        }
        let dateX = dateHeader.bounds(for: page).minX
        let amountX = amountHeader.bounds(for: page).minX
        let descriptionX = descriptionHeader.bounds(for: page).minX
        let cardX = cardHeader.bounds(for: page).minX
        guard dateX < amountX, amountX < descriptionX, descriptionX < cardX else {
            throw FinanceError.message("Неизвестное расположение столбцов PDF")
        }
        let starts = selections(#"\b\d{2}\.\d{2}\.\d{4}\b"#).filter {
            abs($0.bounds(for: page).minX - dateX) < 3 && $0.bounds(for: page).minY < headerY &&
            firstMatch(#"^\d{2}\.\d{2}\.\d{4}$"#, in: $0.string ?? "") != nil
        }.sorted { $0.bounds(for: page).minY > $1.bounds(for: page).minY }
        let footerTop = lines.filter { normalized($0.string ?? "").contains("универсальная лицензия") }.map { $0.bounds(for: page).maxY + 2 }.max() ?? 65
        let bottom = totalLines.map { $0.bounds(for: page).maxY + 1 }.max() ?? footerTop
        for (index, start) in starts.enumerated() {
            let top = start.bounds(for: page).maxY + 1
            let lower = index + 1 < starts.count ? starts[index + 1].bounds(for: page).maxY + 1 : bottom
            guard top > lower else { throw FinanceError.message("Не удалось определить границы строки PDF") }
            func columnText(_ x: CGFloat, _ right: CGFloat) -> String {
                let raw = page.selection(for: CGRect(x: x - 0.5, y: lower, width: right - x, height: top - lower))?.string ?? ""
                return raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
            }
            let location = "Страница \(pageIndex + 1), операция \(index + 1)"
            do {
                let date = try operationDate(start.string ?? "")
                let rawAmount = columnText(amountX, descriptionX)
                guard let code = firstMatch(#"(₽|RUB|RUR|USD|EUR|\$|€)"#, in: rawAmount) else { throw FinanceError.message("Не найдена валюта операции") }
                let currency = try currencyCode(code)
                let amount = try money(rawAmount)
                let details = columnText(descriptionX, cardX)
                guard !details.isEmpty else { throw FinanceError.message("Пустое описание") }
                let (kind, category) = suggest(details: details, amount: amount)
                result.operations.append(Operation(date: date, bank: "Т‑Банк", account: account, details: details, amount: amount,
                                                   currency: currency, category: category, kind: kind, source: filename, sourceRow: location))
            } catch { throw FinanceError.message("\(location): \(error.localizedDescription). Файл не импортирован.") }
        }
    }
    guard !result.operations.isEmpty else { throw FinanceError.message("В PDF не найдены операции") }
    if let controlCurrency {
        guard result.operations.allSatisfy({ $0.currency == controlCurrency }) else { throw FinanceError.message("Валюта операций отличается от валюты итогов PDF") }
        result.warnings += try reconcile(result.operations, income: income, expense: expense, currency: controlCurrency, source: "PDF Т‑Банка")
    } else { result.warnings.append("Не найдены контрольные суммы банка. Проверь полноту импорта вручную.") }
    return result
}
