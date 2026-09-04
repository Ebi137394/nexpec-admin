# Android 16 KB page-size finding — honest status

## Evidence
Both the first production AAB and a fresh sim-qa APK (Expo SDK 52 / RN 0.76.9,
EAS builders, Aug 2026) carry **31 of 40 arm64 ELF libraries with 4 KB LOAD
alignment** (including prebuilt `libhermes.so`, `libreactnative.so`); 9 are
16 KB-ready. Verified by parsing ELF program headers directly — not guessed.
targetSdk has no effect on ELF alignment; the fix cannot come from config.

## What this means for Google Play
- targetSdk floor (35): **fixed** in the release config; the rebuilt AAB
  targets 35.
- Google's published requirement: new apps and updates targeting Android 15+
  submitted after 2025-11-01 must support 16 KB page sizes. Expo/React Native
  gained full 16 KB support in RN 0.77+; **Expo SDK 52 (RN 0.76) predates it**.
- The definitive enforcement answer comes from the Play Console itself at the
  Internal-testing upload (owner login required). Expect a hard error or at
  minimum a blocking warning on the 16 KB check.

## If Play rejects the AAB
The supported fix is the **Expo SDK 53+ upgrade** (RN 0.79+, 16 KB-aligned
libraries). That is a major dependency upgrade (React 19; nitro/skia/tflite
version bumps) requiring full requalification — deliberately NOT attempted
autonomously in the final hours before submission, to avoid destabilizing a
fully verified app. Plan: upload to Internal testing first; if the console
blocks, schedule the SDK upgrade as the next engineering cycle with the same
qualification pipeline that exists now (82 pgTAP suites, guards, typechecks,
artifact verification).

## iOS is unaffected
No equivalent Apple requirement; the iOS lane is fully green.
