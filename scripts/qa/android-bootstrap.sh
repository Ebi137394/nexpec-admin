#!/bin/bash
# Free, user-directory Android tooling. No sudo, no paid service, no billing.
set -e
ROOT="$HOME/.nexpec-android"; mkdir -p "$ROOT"
ARCH=$(uname -m); [ "$ARCH" = "arm64" ] && JDK_ARCH=aarch64 || JDK_ARCH=x64

# 1) Temurin JDK 17 (free, Eclipse Adoptium) into the user directory
if [ ! -x "$ROOT/jdk/Contents/Home/bin/java" ]; then
  echo "== downloading Temurin JDK 17 ($JDK_ARCH) =="
  curl -sL -o "$ROOT/jdk.tar.gz" \
    "https://api.adoptium.net/v3/binary/latest/17/ga/mac/${JDK_ARCH}/jdk/hotspot/normal/eclipse"
  mkdir -p "$ROOT/jdk" && tar xzf "$ROOT/jdk.tar.gz" -C "$ROOT/jdk" --strip-components=1
  rm -f "$ROOT/jdk.tar.gz"
fi
export JAVA_HOME="$ROOT/jdk/Contents/Home"; export PATH="$JAVA_HOME/bin:$PATH"
java -version 2>&1 | head -1

# 2) Android command-line tools (free, Google)
export ANDROID_HOME="$ROOT/sdk"; mkdir -p "$ANDROID_HOME"
if [ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "== downloading Android cmdline-tools =="
  curl -sL -o "$ROOT/clt.zip" https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip
  rm -rf "$ROOT/clt" && unzip -q "$ROOT/clt.zip" -d "$ROOT/clt"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  rm -rf "$ANDROID_HOME/cmdline-tools/latest"
  mv "$ROOT/clt/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  rm -rf "$ROOT/clt" "$ROOT/clt.zip"
fi
SDKM="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

# 3) Packages. Licences are the standard free SDK licences, accepted non-interactively.
echo "== accepting licences =="; yes | "$SDKM" --licenses >/dev/null 2>&1 || true
echo "== installing packages =="
"$SDKM" --install "platform-tools" "emulator" "platforms;android-35" \
  "system-images;android-35;google_apis;arm64-v8a" 2>&1 | tail -3

# 4) AVD
AVDM="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
IMG="system-images;android-35;google_apis;arm64-v8a"
if ! "$AVDM" list avd 2>/dev/null | grep -q nexpec_qa; then
  echo no | "$AVDM" create avd -n nexpec_qa -k "$IMG" --device "pixel_6" 2>&1 | tail -2
fi
"$AVDM" list avd 2>/dev/null | grep -E "Name:|Based on" | head -4
echo "ANDROID_BOOTSTRAP_OK"
