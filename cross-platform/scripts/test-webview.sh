#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
swiftc -parse-as-library -module-cache-path build/module-cache cross-platform/tests/WebViewTests.swift -o build/cross-platform-webview-tests -framework WebKit -framework AppKit
build/cross-platform-webview-tests "$PWD/cross-platform/${4:-dist}" "${5:-$PWD/cross-platform/tests/webview-scenario.js}" "${1:-1250}" "${2:-880}" "${3:-light}"
