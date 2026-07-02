---
name: reference-expo-newarch-build
description: NEXPEC iOS/Android New-Arch build gotcha — Nitro/Skia/fast-tflite need New Arch; the GENERATED property files are authoritative; guard plugin enforces it
metadata: 
  node_type: memory
  type: reference
  originSessionId: 49b95114-7fa8-48bb-91e6-6eeb9c30c3df
---

NitroModules (react-native-fast-tflite v3) + the Fabric Skia renderer REQUIRE the RN New Architecture. On **Expo SDK 52** New Arch is the TOP-LEVEL `newArchEnabled: true` in app.config.js — and **expo-build-properties' `newArchEnabled` option is a NO-OP on SDK 52** (it silently does nothing, which makes config "look right" while the build is Old Arch).

The build actually reads New Arch from the GENERATED native files, which are authoritative:
- `ios/Podfile.properties.json` → `"newArchEnabled":"true"` (Podfile: `ENV['RCT_NEW_ARCH_ENABLED']=podfile_properties['newArchEnabled']=='true' ? '1':'0'`)
- `android/gradle.properties` → `newArchEnabled=true`

A stale/partial prebuild can leave iOS MISSING the key + Android at `false` → `RCT_NEW_ARCH_ENABLED=0` → NitroModules codegen fails at **`PhaseScriptExecution` → `ReactCodegen`** with `#error NitroModules cannot be found!`. It SURVIVES DerivedData/node_modules/watchman/`prebuild` cleans because the bad state lives in the generated files, not caches (and non-`--clean` prebuild won't rewrite an existing Podfile.properties.json). Tells: no `ios/Pods/ReactCodegen` dir, no `NitroModules`/tflite/skia pods linked.

FIX (2026-05-29): **`plugins/withNexpecNewArch.js`** (registered LAST in app.config.js) forces `newArchEnabled` into BOTH generated files on every prebuild via `withPodfileProperties` / `withGradleProperties` → self-healing. Also registered fast-tflite's own `app.plugin.js` (`enableCoreMLDelegate:true`). Runbook = **NEXPEC_IOS_BUILD_FIX.md**. Rebuild: `npx expo prebuild --clean` → verify both files print true → `cd ios && RCT_NEW_ARCH_ENABLED=1 bundle exec pod install`.

VERSION NOTE: fast-tflite 3.0.1 was built vs `nitrogen ^0.35.2`; installed `react-native-nitro-modules 0.35.9` SATISFIES it — versions were NOT the problem (don't downgrade). Secondary fragility: `ios/.xcode.env.local` pinned an nvm path (`.../v20.20.0/bin/node`); Xcode's non-login shell never loads nvm, so prefer a dynamic loader (`source $NVM_DIR/nvm.sh; export NODE_BINARY=$(command -v node)`). See [[reference-nexpec-schema-gotchas]] and [[project-ai-strategy]].
