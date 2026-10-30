import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class FinanceStore: ObservableObject {
    @Published private(set) var ledger = Ledger() {
        didSet { transferOwnerRowsCache = nil }
    }
    private var transferOwnerRowsCache: [TransferOwnerRow]?
    var transferOwnerRows: [TransferOwnerRow] {
        if let rows = transferOwnerRowsCache { return rows }
        let rows = ledger.transferOwnerRows
        transferOwnerRowsCache = rows
        return rows
    }
    @Published var busy = false
    @Published var message: String?
    @Published private(set) var readOnly = false
    private let location: URL

    init(location: URL? = nil) {
        self.location = location ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("FinanceComputer", isDirectory: true).appendingPathComponent("ledger.json")
        do {
            if FileManager.default.fileExists(atPath: self.location.path) {
                ledger = try JSONDecoder().decode(Ledger.self, from: Data(contentsOf: self.location))
                guard ledger.version == 1 else { throw FinanceError.message("Неизвестная версия базы") }
                try validateAmounts(ledger.operations)
                let previous = ledger.operations
                let previousRules = ledger.descriptionRules
                let migrated = ledger.classificationVersion == nil
                ledger.migrateClassification()
                ledger.mergeEquivalentDescriptionRules()
                ledger.reclassify()
                if migrated || ledger.operations != previous || ledger.descriptionRules != previousRules { try save(ledger) }
            }
        } catch {
            ledger = Ledger()
            readOnly = true
            message = "Не удалось прочитать локальную базу. Изменения отключены, чтобы её не перезаписать. \(error.localizedDescription)\n\(self.location.path)"
        }
    }

    private func save(_ updated: Ledger) throws {
        guard !readOnly else { throw FinanceError.message("База открыта только для чтения") }
        try FileManager.default.createDirectory(at: location.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let data = try JSONEncoder().encode(updated)
        try data.write(to: location, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: location.path)
        ledger = updated
    }

    @discardableResult func update(_ operation: Operation) -> Bool {
        guard let index = ledger.operations.firstIndex(where: { $0.id == operation.id }) else { return false }
        var updated = ledger
        var edited = operation
        edited.category = edited.category.trimmingCharacters(in: .whitespacesAndNewlines)
        if edited.category.isEmpty { edited.category = "Без категории" }
        if edited.category != ledger.operations[index].category { edited.manualCategory = true }
        if edited.kind != ledger.operations[index].kind {
            edited.manualKind = true
            edited.transferReason = nil
        }
        updated.operations[index] = edited
        do { try save(updated); return true } catch { message = "Изменение не сохранено: \(error.localizedDescription)"; return false }
    }

    @discardableResult func edit(_ id: UUID, changes: (inout Operation) -> Void) -> Bool {
        guard var operation = ledger.operations.first(where: { $0.id == id }) else { return false }
        changes(&operation)
        return update(operation)
    }

    @discardableResult func saveRule(_ rule: DescriptionRule, replaceManual: Bool = false) -> Bool {
        guard !busy, !readOnly else { return false }
        var updated = ledger
        do {
            try updated.setDescriptionRule(rule, replaceManual: replaceManual)
            try save(updated)
            return true
        } catch { message = "Правило не сохранено: \(error.localizedDescription)"; return false }
    }

    @discardableResult func deleteRule(_ id: UUID) -> Bool {
        guard !busy, !readOnly else { return false }
        var updated = ledger
        updated.removeDescriptionRule(id)
        do { try save(updated); return true }
        catch { message = "Правило не удалено: \(error.localizedDescription)"; return false }
    }

    @discardableResult func mergeDescriptionGroups(sourceID: String, targetID: String) -> Bool {
        guard !busy, !readOnly else { return false }
        var updated = ledger
        do {
            try updated.mergeDescriptionGroups(sourceID: sourceID, targetID: targetID)
            try save(updated)
            return true
        } catch { message = "Группы не объединены: \(error.localizedDescription)"; return false }
    }

    @discardableResult func useDescriptionRule(_ id: UUID) -> Bool {
        var updated = ledger
        guard let index = updated.operations.firstIndex(where: { $0.id == id }),
              updated.matchingRule(for: updated.operations[index]) != nil,
              updated.operations[index].kind != .pending else { return false }
        updated.operations[index].manualKind = false
        updated.operations[index].manualCategory = false
        updated.reclassify()
        do { try save(updated); return true }
        catch { message = "Правило не применено: \(error.localizedDescription)"; return false }
    }

    func setTransferOwner(_ party: TransferParty, own: Bool?) {
        guard !busy, !readOnly else { return }
        var updated = ledger
        if updated.transferOwners == nil { updated.transferOwners = [:] }
        updated.transferOwners?[party.id] = own
        if updated.ownPhoneIDs.isEmpty { updated.otherPhonesArePeople = false }
        updated.reclassify()
        do { try save(updated) } catch { message = "Правило не сохранено: \(error.localizedDescription)" }
    }

    @discardableResult func setPhoneName(_ party: TransferParty, name: String) -> Bool {
        guard !busy, !readOnly else { return false }
        guard party.id.hasPrefix("phone|"), let phone = normalizedPhoneNumber(String(party.id.dropFirst(6))),
              party.id == "phone|" + phone else {
            message = "Имя можно назначить только полному номеру телефона."
            return false
        }
        let name = name.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        var updated = ledger
        if updated.phoneNames == nil { updated.phoneNames = [:] }
        updated.phoneNames?[party.id] = name.isEmpty ? nil : name
        do { try save(updated); return true }
        catch { message = "Имя не сохранено: \(error.localizedDescription)"; return false }
    }

    @discardableResult func setOwnPhone(_ value: String) -> Bool {
        guard !busy, !readOnly else { return false }
        guard let phone = normalizedPhoneNumber(value) else {
            message = "Введи полный номер из 11 цифр, начиная с +7 или 8. Можно использовать пробелы, скобки и дефисы."
            return false
        }
        var updated = ledger
        if updated.transferOwners == nil { updated.transferOwners = [:] }
        updated.transferOwners?["phone|" + phone] = true
        updated.otherPhonesArePeople = true
        updated.reclassify()
        do { try save(updated); return true }
        catch { message = "Номер не сохранён: \(error.localizedDescription)"; return false }
    }

    func setOtherPhonesArePeople(_ enabled: Bool) {
        guard !busy, !readOnly else { return }
        guard !enabled || !ledger.ownPhoneIDs.isEmpty else {
            message = "Сначала укажи свой номер телефона."
            return
        }
        var updated = ledger
        updated.otherPhonesArePeople = enabled
        updated.reclassify()
        do { try save(updated) } catch { message = "Настройка не сохранена: \(error.localizedDescription)" }
    }

    @discardableResult func resetAnalysis() -> Bool {
        guard !busy, !readOnly else { return false }
        do {
            let backups = location.deletingLastPathComponent().appendingPathComponent("Backups", isDirectory: true)
            try FileManager.default.createDirectory(at: backups, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
            let backup = backups.appendingPathComponent("ledger-\(stamp)-\(UUID().uuidString).json")
            try JSONEncoder().encode(ledger).write(to: backup, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: backup.path)
            // Сначала сохраняем копию: если это не удалось, текущий разбор не очищаем.
            let ownPhones = (ledger.transferOwners ?? [:]).filter { ledger.ownPhoneIDs.contains($0.key) }
            try save(Ledger(transferOwners: ownPhones.isEmpty ? nil : ownPhones, descriptionRules: ledger.descriptionRules,
                            otherPhonesArePeople: ledger.otherPhonesArePeople, phoneNames: ledger.phoneNames))
            message = nil
            return true
        } catch {
            message = "Не удалось начать новый разбор: \(error.localizedDescription)"
            return false
        }
    }

    func chooseFiles() {
        guard !busy, !readOnly else { return }
        let panel = NSOpenPanel()
        panel.title = "Добавить банковские выписки"
        panel.prompt = "Импортировать"
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.pdf, UTType(filenameExtension: "xlsx")!]
        guard panel.runModal() == .OK else { return }
        let urls = panel.urls
        busy = true
        Task {
            var messages: [String] = []
            for url in urls {
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                do {
                    let result = try await Task.detached(priority: .userInitiated) {
                        let attributes = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
                        guard attributes.isRegularFile == true, let size = attributes.fileSize, size <= 25 * 1024 * 1024 else {
                            throw FinanceError.message("Нужен обычный файл размером до 25 МБ")
                        }
                        let data = try Data(contentsOf: url)
                        let result = try parseStatement(data, filename: url.lastPathComponent)
                        return (result, digestOf(data))
                    }.value
                    var updated = ledger
                    try updated.append(result.0, filename: url.lastPathComponent, digest: result.1)
                    try save(updated)
                    let record = updated.imports.last!
                    messages.append("\(url.lastPathComponent): добавлено \(record.count) операций.\(record.warnings.isEmpty ? "" : " Есть предупреждения — см. раздел «Импорт».")")
                } catch {
                    messages.append("\(url.lastPathComponent): \(error.localizedDescription)")
                }
            }
            busy = false
            message = messages.joined(separator: "\n\n")
        }
    }

    func exportBackup() {
        let panel = NSSavePanel()
        panel.title = "Сохранить копию данных"
        panel.nameFieldStringValue = "finances.json"
        panel.allowedContentTypes = [.json]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(ledger).write(to: url, options: .atomic)
        } catch { message = "Не удалось сохранить копию: \(error.localizedDescription)" }
    }
}
