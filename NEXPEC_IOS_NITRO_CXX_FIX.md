# NEXPEC iOS — "NitroModules cannot be found" (ReactCodegen) · definitive fix

**Symptom:** with `RCT_NEW_ARCH_ENABLED=1` and all caches wiped, the build still fails
at `PhaseScriptExecution [CP-User] Generate Specs` (ReactCodegen) with compiler
errors that **NitroModules** is missing — right after MacCatalyst warnings in
`StripeFinancialConnections`.

## Diagnosis (from first principles)

The error is a **C++ compile failure**, not a script failure. `react-native-fast-tflite`
v3 ships nitrogen-generated C++ that does:

```cpp
#if __has_include(<NitroModules/JSIConverter.hpp>)
  #include <NitroModules/JSIConverter.hpp>
#else
  #error NitroModules cannot be found! Are you sure you installed NitroModules properly?
#endif
```

`__has_include(...)` evaluates to **false** at compile time even though the
`NitroModules` pod (0.35.9) **is** installed (it's in `Podfile.lock`). The
NitroModules podspec itself shows why:

- it **requires C++20** (`CLANG_CXX_LANGUAGE_STANDARD = c++20`), and
- it exposes its C++ headers via a **modulemap with "stricter modular headers."**

Expo SDK 52's stock Podfile doesn't guarantee C++20 on every *consuming* target,
nor that NitroModules' header path is on their `HEADER_SEARCH_PATHS` across pods.
So the consumer (NitroTflite / ReactCodegen) can't see the header → `#error`.

**Ruled out:** `use_frameworks!` is **off** (no `ios.useFrameworks` in
`Podfile.properties.json`), so Stripe is *not* forcing frameworks — those
MacCatalyst lines are harmless Swift warnings, not the cause.

**Why not `use_modular_headers!`:** flipping global modular headers risks breaking
Stripe / Skia / other pods. The surgical fix below touches only build settings and
is purely additive.

## The fix (committed)

`plugins/withNexpecNitroBuild.js` (registered **last** in `app.config.js`) patches
the Podfile `post_install` so that, for **every pod target**, it:

1. pins `CLANG_CXX_LANGUAGE_STANDARD = c++20` + `CLANG_CXX_LIBRARY = libc++`;
2. appends NitroModules' header search paths for **both** CocoaPods layouts —
   `${PODS_ROOT}/Headers/Public/NitroModules` (static) and
   `${PODS_CONFIGURATION_BUILD_DIR}/NitroModules/NitroModules.framework/Headers`
   (framework) — so `<NitroModules/...>` always resolves; and
3. asserts `RCT_NEW_ARCH_ENABLED=1` in the preprocessor defines.

It injects **inside** Expo's existing `post_install` block (CocoaPods allows only
one), is **idempotent** (guarded by a marker), and re-applies on every
`expo prebuild` (verified: the regex anchor matches your Podfile and yields exactly
one `post_install`).

## Rebuild

```bash
# clean to clear stale nitrogen output + pods
watchman watch-del-all 2>/dev/null || true
rm -rf ios node_modules "$TMPDIR/metro-"* "$TMPDIR/haste-map-"*
npm install
npx expo prebuild --clean            # New-Arch guard + this Nitro patch both apply

# verify the patch landed
grep -q 'nexpec-nitro-cxx-patch' ios/Podfile && echo "Nitro C++ patch present ✓"
node -e "console.log('newArch:', require('./ios/Podfile.properties.json').newArchEnabled)"

cd ios && RCT_NEW_ARCH_ENABLED=1 bundle exec pod install && cd ..
npx expo run:ios
```

## If you'd rather patch by hand right now (no re-prebuild)

Paste this inside the existing `post_install do |installer|` block in `ios/Podfile`,
just after the `react_native_post_install(...)` call, then `pod install`:

```ruby
    # nexpec-nitro-cxx-patch
    installer.pods_project.targets.each do |nx_t|
      nx_t.build_configurations.each do |nx_bc|
        nx_bc.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++20'
        nx_bc.build_settings['CLANG_CXX_LIBRARY'] = 'libc++'
        nx_hsp = nx_bc.build_settings['HEADER_SEARCH_PATHS']
        nx_hsp = nx_hsp.is_a?(Array) ? nx_hsp.dup : [nx_hsp || '$(inherited)']
        ['$(inherited)',
         '"${PODS_ROOT}/Headers/Public/NitroModules"',
         '"${PODS_CONFIGURATION_BUILD_DIR}/NitroModules/NitroModules.framework/Headers"'
        ].each { |p| nx_hsp << p unless nx_hsp.include?(p) }
        nx_bc.build_settings['HEADER_SEARCH_PATHS'] = nx_hsp
        nx_defs = nx_bc.build_settings['GCC_PREPROCESSOR_DEFINITIONS']
        nx_defs = nx_defs.is_a?(Array) ? nx_defs.dup : [nx_defs || '$(inherited)']
        nx_defs << 'RCT_NEW_ARCH_ENABLED=1' unless nx_defs.include?('RCT_NEW_ARCH_ENABLED=1')
        nx_bc.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = nx_defs
      end
    end
```

## If it *still* fails after this

Capture the first ~40 lines of the actual compiler error (the file + the missing
symbol). Two residual possibilities to distinguish:
- **`'utility'/'optional'/'tuple' file not found`** → C++ stdlib path issue, not
  NitroModules; means a target is still on the wrong toolchain/SDK.
- **`Failed to get NitroModules` at *runtime*** (not build) → autolinking; run
  `npx expo-doctor` and confirm `react-native-nitro-modules` resolves in
  `npx expo config --type introspect`.
Send me that snippet and I'll pinpoint it.
