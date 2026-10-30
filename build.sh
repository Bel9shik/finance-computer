#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
APP="build/Мои финансы.app"
mkdir -p "$APP/Contents/MacOS" build/module-cache
swiftc -swift-version 5 -target "$(uname -m)-apple-macos14.0" -O -I Sources/CZlib -module-cache-path build/module-cache \
    Sources/Model.swift Sources/Spreadsheet.swift Sources/Parsers.swift Sources/Store.swift Sources/App.swift \
    -framework SwiftUI -framework Charts -framework PDFKit -framework CryptoKit \
    -o "$APP/Contents/MacOS/FinanceComputer"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Мои финансы</string>
<key>CFBundleDisplayName</key><string>Мои финансы</string>
<key>CFBundleIdentifier</key><string>local.financecomputer.desktop</string>
<key>CFBundleExecutable</key><string>FinanceComputer</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>31</string>
<key>CFBundleShortVersionString</key><string>0.17.2</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSHumanReadableCopyright</key><string>Локальное приложение. Сетевой доступ запрещён.</string>
</dict></plist>
PLIST
codesign --force --sign - --entitlements FinanceComputer.entitlements "$APP"
codesign --verify --strict "$APP"
printf 'Готово: %s/%s\n' "$PWD" "$APP"
