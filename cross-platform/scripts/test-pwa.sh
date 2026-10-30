#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
node_modules/.bin/esbuild tests/browser-scenario.ts --bundle --format=iife --platform=browser --target=es2022 --outfile=../build/browser-scenario.js
bash scripts/test-webview.sh "${1:-390}" "${2:-844}" "${3:-light}" dist-pwa "$PWD/../build/browser-scenario.js"
