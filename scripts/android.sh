#!/usr/bin/env bash
# Android toolchain wrapper: sets JAVA_HOME / ANDROID_HOME for the local, no-sudo install in ~/Android.
#   scripts/android.sh setup     # install SDK packages (after accepting licenses)
#   scripts/android.sh build     # cap sync + debug APK
#   scripts/android.sh install   # install the APK on a USB/wifi-connected phone (adb)
#   scripts/android.sh devices   # list connected phones
set -euo pipefail
export JAVA_HOME="${JAVA_HOME:-$HOME/Android/jdk-21}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK="$ROOT/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"

case "${1:-}" in
  setup)
    sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;36.0.0"
    ;;
  build)
    cd "$ROOT/apps/mobile" && npx cap sync android && cd android && ./gradlew --no-daemon assembleDebug
    echo "APK: $APK"
    ;;
  install)
    adb install -r "$APK"
    ;;
  devices)
    adb devices -l
    ;;
  *)
    shift || true
    exec "$@"
    ;;
esac
