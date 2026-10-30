#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build/module-cache
swiftc -swift-version 5 -D FINANCE_TESTS -I Sources/CZlib -module-cache-path build/module-cache \
  Sources/Model.swift Sources/Spreadsheet.swift Sources/Parsers.swift Sources/Store.swift Sources/App.swift Tests/UITests.swift \
  -framework SwiftUI -framework Charts -framework PDFKit -framework CryptoKit -o build/ui-tests
build/ui-tests "$@"
