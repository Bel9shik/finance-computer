#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build/module-cache
python3 Tests/make_fixtures.py
swiftc -swift-version 5 -I Sources/CZlib -module-cache-path build/module-cache \
  Sources/Model.swift Sources/Spreadsheet.swift Sources/Parsers.swift Tests/TestMain.swift \
  -framework PDFKit -framework CryptoKit -o build/tests
build/tests "$@"
