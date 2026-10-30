import AppKit
import WebKit

// An isolated native WebView test host. It never opens a browser or reads a real ledger.
final class Harness: NSObject, WKURLSchemeHandler, WKScriptMessageHandler, WKNavigationDelegate {
    let root: URL
    var view: WKWebView!
    var window: NSWindow!
    init(root: URL) { self.root = root }
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        do {
            let url = urlSchemeTask.request.url!
            let relative = url.path == "/" ? "index.html" : String(url.path.dropFirst())
            let file = root.appendingPathComponent(relative).standardizedFileURL
            guard file.path.hasPrefix(root.path + "/") else { throw NSError(domain: "path", code: 1) }
            var data = try Data(contentsOf: file)
            if relative == "index.html" {
                let configData = try Data(contentsOf: root.deletingLastPathComponent().appendingPathComponent("src-tauri/tauri.conf.json"))
                let config = try JSONSerialization.jsonObject(with: configData) as! [String: Any]
                let app = config["app"] as! [String: Any], security = app["security"] as! [String: Any]
                let csp = security["csp"] as! String
                data = Data(String(decoding: data, as: UTF8.self).replacingOccurrences(of: "<head>", with: "<head><meta http-equiv=\"Content-Security-Policy\" content=\"\(csp)\">").utf8)
            }
            let type = ["html":"text/html", "js":"text/javascript", "mjs":"text/javascript", "css":"text/css", "json":"application/json"][file.pathExtension] ?? "application/octet-stream"
            urlSchemeTask.didReceive(URLResponse(url: url, mimeType: type, expectedContentLength: data.count, textEncodingName: "utf-8"))
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch { urlSchemeTask.didFailWithError(error) }
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let result = message.body as? [String: Any] else { return }
        print(result)
        let passed = result["ok"] as? Bool == true
        let snapshot = WKSnapshotConfiguration()
        view.takeSnapshot(with: snapshot) { image, _ in
            if let data = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: data), let png = bitmap.representation(using: .png, properties: [:]) {
                try? png.write(to: self.root.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("build/cross-platform-ui-\(Int(self.view.frame.width)).png"))
            }
            exit(passed ? 0 : 1)
        }
    }
    func start(width: CGFloat, height: CGFloat, script: String) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.setURLSchemeHandler(self, forURLScheme: "finance-test")
        config.userContentController.add(self, name: "testResult")
        config.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        view = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: config)
        view.navigationDelegate = self
        window = NSWindow(contentRect: view.frame, styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = view
        window.orderFront(nil)
        view.load(URLRequest(url: URL(string: "finance-test://localhost/")!))
        DispatchQueue.main.asyncAfter(deadline: .now() + 45) { print("FAIL: WebView timeout"); exit(1) }
    }
}
@main struct WebViewTests {
    static func pdfFixture(_ path: URL) throws -> Data {
        var bounds = CGRect(x: 0, y: 0, width: 595, height: 842)
        guard let context = CGContext(path as CFURL, mediaBox: &bounds, nil) else { throw NSError(domain: "pdf", code: 1) }
        context.beginPDFPage(nil)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        func draw(_ value: String, _ x: CGFloat, _ y: CGFloat) {
            (value as NSString).draw(at: CGPoint(x: x, y: y), withAttributes: [.font: NSFont(name: "Arial", size: 9)!])
        }
        draw("ТБанк Справка о движении средств", 56, 780)
        draw("Номер лицевого счета: 00000000000000000001", 56, 750)
        draw("Дата и время", 56, 680); draw("Дата", 126, 680)
        draw("Сумма в валюте", 199, 680); draw("Сумма операции", 294, 680)
        draw("Описание", 389, 680); draw("Номер", 499, 680)
        draw("01.10.2026", 56, 640); draw("02.10.2026", 126, 640)
        draw("-10.00 USD", 199, 640); draw("-925.00 ₽", 294, 640)
        draw("Оплата в CAFE", 389, 640); draw("Вторая строка", 389, 628)
        draw("1234", 499, 640)
        draw("Пополнения: 0,00 ₽", 56, 600); draw("Расходы: 925,00 ₽", 56, 580)
        NSGraphicsContext.restoreGraphicsState()
        context.endPDFPage(); context.closePDF()
        return try Data(contentsOf: path)
    }
    static func main() throws {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        app.appearance = NSAppearance(named: CommandLine.arguments.count > 5 && CommandLine.arguments[5] == "dark" ? .darkAqua : .aqua)
        let root = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
        let fixture = try Data(contentsOf: root.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("build/fixtures/valid.xlsx")).base64EncodedString()
        let pdf = try pdfFixture(root.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("build/fixtures/finance-test.pdf")).base64EncodedString()
        let script = "window.testFile = Uint8Array.from(atob('\(fixture)'), c=>c.charCodeAt(0));window.testPDF = Uint8Array.from(atob('\(pdf)'), c=>c.charCodeAt(0));\n" + (try String(contentsOfFile: CommandLine.arguments[2], encoding: .utf8))
        let harness = Harness(root: root)
        let height = CommandLine.arguments.count > 4 ? CGFloat(Double(CommandLine.arguments[4])!) : 880
        harness.start(width: CGFloat(Double(CommandLine.arguments[3])!), height: height, script: script)
        withExtendedLifetime(harness) { app.run() }
    }
}
