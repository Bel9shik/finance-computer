#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build/module-cache
swiftc -O -swift-version 5 -I Sources/CZlib -module-cache-path build/module-cache \
  Sources/Model.swift Sources/Spreadsheet.swift Sources/Parsers.swift Tests/PerformanceTests.swift \
  -framework PDFKit -framework CryptoKit -o build/performance-tests
build/performance-tests
