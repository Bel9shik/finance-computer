#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" = ios ]; then
  if ! xcrun --sdk iphoneos --show-sdk-path >/dev/null 2>&1; then
    echo 'Для iOS нужен полный Xcode с iOS SDK. Установи Xcode, открой его для завершения настройки и выбери Xcode в Settings → Locations → Command Line Tools.' >&2
    exit 1
  fi
fi
if [ -d ../build/toolchain/cargo ]; then
  export CARGO_HOME="$(cd ../build/toolchain/cargo && pwd)"
  export RUSTUP_HOME="$(cd ../build/toolchain/rustup && pwd)"
  export PATH="$CARGO_HOME/bin:$PATH"
fi
if [ -d '/Applications/Android Studio.app/Contents/jbr/Contents/Home' ]; then
  export JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home'
fi
if [ -d "$HOME/Library/Android/sdk" ]; then export ANDROID_HOME="$HOME/Library/Android/sdk"; fi
if [ -d ../build/toolchain/android-ndk-r30 ]; then export NDK_HOME="$(cd ../build/toolchain/android-ndk-r30 && pwd)"; fi
exec npm run tauri -- "$@"
