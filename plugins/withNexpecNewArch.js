// ════════════════════════════════════════════════════════════════════════════
//  plugins/withNexpecNewArch.js — New Architecture build guard
//
//  WHY THIS EXISTS
//  ---------------
//  NEXPEC's native ML layer is built on the React Native New Architecture:
//    • react-native-fast-tflite v3  → NitroModules (Fabric/TurboModules only)
//    • @shopify/react-native-skia    → Fabric component renderer
//    • react-native-reanimated 3 / worklets-core
//  None of these compile under the Old Architecture. fast-tflite's nitrogen
//  codegen literally fails with `#error NitroModules cannot be found!` and the
//  ReactCodegen build phase aborts.
//
//  Expo SDK 52 controls New Arch via the TOP-LEVEL `newArchEnabled` in
//  app.config.js. But that value only reaches the native build through two
//  generated files:
//    • ios/Podfile.properties.json   → key  "newArchEnabled": "true"
//                                      (Podfile sets RCT_NEW_ARCH_ENABLED from it)
//    • android/gradle.properties     → line newArchEnabled=true
//  A stale, partial, or pre-newArch prebuild can leave the iOS file WITHOUT the
//  key and the Android file at `false`. When that happens the build silently
//  reverts to Old Arch and Nitro/Skia codegen breaks — and a normal
//  `prebuild` (without --clean) won't rewrite the existing files, so the bad
//  state survives DerivedData / node_modules / watchman cleans. That was the
//  exact NEXPEC failure (2026-05-29): iOS file missing the key, Android at false.
//
//  This plugin makes New Arch SELF-HEALING. It runs on every prebuild and
//  FORCES both property files to the correct value, so the native build can
//  never regress to Old Arch regardless of cache state. It is intentionally
//  the LAST plugin in app.config.js so it has the final say on these keys.
//
//  Note: expo-build-properties' own `newArchEnabled` option is a no-op on
//  SDK 52 (New Arch graduated to the top-level config), which is why setting it
//  there did not fix the generated files. This plugin writes them directly via
//  the supported config-plugin mod APIs.
// ════════════════════════════════════════════════════════════════════════════

const {
  withPodfileProperties,
  withGradleProperties,
} = require('expo/config-plugins');

/** @param {import('expo/config').ExpoConfig} config */
const withNexpecNewArch = (config) => {
  // ── iOS: ios/Podfile.properties.json ────────────────────────────────────
  config = withPodfileProperties(config, (cfg) => {
    cfg.modResults.newArchEnabled = 'true';
    return cfg;
  });

  // ── Android: android/gradle.properties ──────────────────────────────────
  config = withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    const existing = props.find(
      (p) => p.type === 'property' && p.key === 'newArchEnabled',
    );
    if (existing) {
      existing.value = 'true';
    } else {
      props.push({ type: 'property', key: 'newArchEnabled', value: 'true' });
    }
    return cfg;
  });

  return config;
};

module.exports = withNexpecNewArch;
