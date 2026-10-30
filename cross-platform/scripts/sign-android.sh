#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
if [ -d '/Applications/Android Studio.app/Contents/jbr/Contents/Home' ]; then export JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home'; fi
sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
build_tools="$sdk/build-tools/37.0.0"
if [ ! -d "$build_tools" ]; then build_tools="$sdk/build-tools/36.0.0"; fi
keytool="${JAVA_HOME:+$JAVA_HOME/bin/}keytool"
mkdir -p .local-signing ../build/releases
if [ ! -f .local-signing/release.keystore ]; then
  if [ ! -f .local-signing/release.password ]; then
    python3 -c 'import secrets; print(secrets.token_urlsafe(36))' > .local-signing/release.password
  fi
  "$keytool" -genkeypair -keystore .local-signing/release.keystore -storepass:file .local-signing/release.password -keypass:file .local-signing/release.password -alias finance -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Offline Finance Local' -noprompt
fi
input=src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
aligned=../build/releases/finance-aligned.apk
version="$(node -p 'require("./package.json").version')"
output="../build/releases/FinanceComputer-$version-arm64.apk"
"$build_tools/zipalign" -P 16 -f 4 "$input" "$aligned"
"$build_tools/apksigner" sign --ks .local-signing/release.keystore --ks-key-alias finance --ks-pass file:.local-signing/release.password --out "$output" "$aligned"
"$build_tools/apksigner" verify "$output"
rm "$aligned"
printf 'Signed APK: %s\nKeep .local-signing for future updates.\n' "$output"
