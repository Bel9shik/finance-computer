import Foundation
import CZlib

// Читаем только содержимое ZIP, никогда не распаковываем пути из файла на диск.
struct SpreadsheetArchive {
    let data: Data
    var entries: [String: (method: Int, size: Int, compressed: Int, offset: Int, crc: UInt32)] = [:]

    init(data: Data) throws {
        self.data = data
        guard data.count >= 22 else { throw FinanceError.message("Повреждённый XLSX") }
        func number(_ offset: Int, _ count: Int) throws -> Int {
            guard offset >= 0, offset + count <= data.count else { throw FinanceError.message("Повреждённый ZIP") }
            return (0..<count).reduce(0) { $0 | Int(data[offset + $1]) << (8 * $1) }
        }
        guard let end = stride(from: data.count - 22, through: max(0, data.count - 65_557), by: -1).first(where: {
            (try? number($0, 4)) == 0x06054b50 && (try? number($0 + 20, 2)).map { $0 + 22 } == data.count - $0
        }) else { throw FinanceError.message("Файл не является обычным XLSX/ZIP") }
        let count = try number(end + 10, 2)
        guard try number(end + 4, 2) == 0, try number(end + 6, 2) == 0, count < 4096 else {
            throw FinanceError.message("Многотомный или слишком большой XLSX не поддерживается")
        }
        var cursor = try number(end + 16, 4)
        var total = 0
        for _ in 0..<count {
            guard try number(cursor, 4) == 0x02014b50 else { throw FinanceError.message("Повреждённый каталог XLSX") }
            let flags = try number(cursor + 8, 2)
            let method = try number(cursor + 10, 2)
            let compressed = try number(cursor + 20, 4)
            let size = try number(cursor + 24, 4)
            let nameLength = try number(cursor + 28, 2)
            let extra = try number(cursor + 30, 2)
            let comment = try number(cursor + 32, 2)
            guard flags & 1 == 0, [0, 8].contains(method), size <= 64 * 1024 * 1024,
                  cursor + 46 + nameLength + extra + comment <= data.count else {
                throw FinanceError.message("Зашифрованный, слишком большой или неподдерживаемый XLSX")
            }
            total += size
            guard total <= 128 * 1024 * 1024 else { throw FinanceError.message("Распакованный XLSX превышает 128 МБ") }
            let name = String(decoding: data[(cursor + 46)..<(cursor + 46 + nameLength)], as: UTF8.self)
            entries[name] = (method, size, compressed, try number(cursor + 42, 4), UInt32(try number(cursor + 16, 4)))
            cursor += 46 + nameLength + extra + comment
        }
    }

    func read(_ path: String) throws -> Data {
        guard let entry = entries[path], entry.offset >= 0, entry.offset + 30 <= data.count else {
            throw FinanceError.message("В XLSX отсутствует \(path)")
        }
        func number(_ offset: Int, _ count: Int) -> Int {
            (0..<count).reduce(0) { $0 | Int(data[offset + $1]) << (8 * $1) }
        }
        guard number(entry.offset, 4) == 0x04034b50 else { throw FinanceError.message("Повреждённая запись XLSX") }
        let start = entry.offset + 30 + number(entry.offset + 26, 2) + number(entry.offset + 28, 2)
        guard start >= 0, start + entry.compressed <= data.count else { throw FinanceError.message("Обрезанный XLSX") }
        let input = data.subdata(in: start..<(start + entry.compressed))
        var output: Data
        if entry.method == 0 {
            output = input
        } else {
            output = Data(count: max(1, entry.size))
            var stream = z_stream()
            guard inflateInit2_(&stream, -MAX_WBITS, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else {
                throw FinanceError.message("Ошибка распаковки XLSX")
            }
            defer { inflateEnd(&stream) }
            let outputCount = output.count
            let status = input.withUnsafeBytes { source in
                output.withUnsafeMutableBytes { destination in
                    stream.next_in = UnsafeMutablePointer(mutating: source.bindMemory(to: Bytef.self).baseAddress)
                    stream.avail_in = uInt(input.count)
                    stream.next_out = destination.bindMemory(to: Bytef.self).baseAddress
                    stream.avail_out = uInt(outputCount)
                    return inflate(&stream, Z_FINISH)
                }
            }
            guard status == Z_STREAM_END, stream.total_out == entry.size else { throw FinanceError.message("Повреждённые данные XLSX") }
            output.count = entry.size
        }
        let checksum = output.withUnsafeBytes { crc32(0, $0.bindMemory(to: Bytef.self).baseAddress, uInt(output.count)) }
        guard output.count == entry.size, UInt32(checksum) == entry.crc else { throw FinanceError.message("Не совпадает контрольная сумма XLSX") }
        return output
    }
}

struct SpreadsheetRow {
    var number: Int
    var cells: [String]
}

final class SpreadsheetXML: NSObject, XMLParserDelegate {
    var shared: [String]
    var strings: [String] = []
    var rows: [SpreadsheetRow] = []
    private var currentRow: [Int: String] = [:]
    private var rowNumber = 0
    private var column = 0
    private var cellType = ""
    private var value = ""
    private var string = ""
    private var capture = false
    private var inShared = false
    private var inCell = false
    private var failure: String?

    init(shared: [String] = []) { self.shared = shared }

    func parse(_ data: Data) throws {
        // В XLSX достаточно встроенных XML-сущностей; DTD и внешние ресурсы не нужны.
        guard !String(decoding: data, as: UTF8.self).contains("<!DOCTYPE") else {
            throw FinanceError.message("XML с DTD не поддерживается")
        }
        let parser = XMLParser(data: data)
        parser.shouldResolveExternalEntities = false
        parser.delegate = self
        guard parser.parse(), failure == nil else { throw FinanceError.message(failure ?? "Повреждённый XML в XLSX") }
    }

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String]) {
        switch name {
        case "si": inShared = true; string = ""
        case "row":
            currentRow = [:]; rowNumber = Int(attributes["r"] ?? "") ?? rows.count + 1
            if rows.count >= 100_000 { failure = "На листе больше 100 000 строк"; parser.abortParsing() }
        case "c":
            column = 0
            for character in (attributes["r"] ?? "A").uppercased() {
                guard let ascii = character.asciiValue, (65...90).contains(ascii) else { break }
                column = column * 26 + Int(ascii - 64)
            }
            column = max(0, column - 1)
            if column >= 1024 { failure = "На листе больше 1024 столбцов"; parser.abortParsing() }
            cellType = attributes["t"] ?? ""; value = ""; inCell = true
        case "v", "t": capture = true
        default: break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters text: String) {
        if capture {
            if inShared { string += text }
            else if inCell { value += text }
        }
    }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        switch name {
        case "v", "t": capture = false
        case "si": strings.append(string); inShared = false
        case "c":
            if cellType == "s" {
                if let index = Int(value), shared.indices.contains(index) { currentRow[column] = shared[index] }
                else { failure = "Некорректная ссылка на текст в XLSX"; parser.abortParsing() }
            } else { currentRow[column] = value }
            inCell = false
        case "row":
            if let last = currentRow.keys.max() {
                rows.append(SpreadsheetRow(number: rowNumber, cells: (0...last).map { currentRow[$0] ?? "" }))
            }
        default: break
        }
    }
}

func spreadsheetSheets(_ data: Data) throws -> [(String, [SpreadsheetRow])] {
    let archive = try SpreadsheetArchive(data: data)
    var shared: [String] = []
    if archive.entries["xl/sharedStrings.xml"] != nil {
        let xml = SpreadsheetXML()
        try xml.parse(archive.read("xl/sharedStrings.xml"))
        shared = xml.strings
    }
    if archive.entries["xl/workbook.xml"] != nil {
        let workbook = String(decoding: try archive.read("xl/workbook.xml"), as: UTF8.self)
        guard workbook.range(of: #"date1904\s*=\s*["'](?:1|true)["']"#, options: .regularExpression) == nil else {
            throw FinanceError.message("XLSX с календарём 1904 пока не поддерживается")
        }
    }
    let names = archive.entries.keys.filter { $0.hasPrefix("xl/worksheets/") && $0.hasSuffix(".xml") && !$0.contains("/_rels/") }.sorted()
    guard !names.isEmpty else { throw FinanceError.message("В XLSX нет листов") }
    return try names.map { name in
        let xml = SpreadsheetXML(shared: shared)
        try xml.parse(archive.read(name))
        return (name, xml.rows)
    }
}
