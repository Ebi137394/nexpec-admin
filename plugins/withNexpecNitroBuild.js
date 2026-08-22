// ════════════════════════════════════════════════════════════════════════════
//  plugins/withNexpecNitroBuild.js — iOS New-Architecture header resolver
//
//  WHAT IT FIXES
//  -------------
//  Under Expo SDK 52 + New Architecture, third-party pods fail to compile with
//  "file not found" on their generated New-Arch specs / Fabric headers:
//      #import <ReactNativeBlobUtilSpec/ReactNativeBlobUtilSpec.h>   (react-native-blob-util)
//      #import <safeareacontext/safeareacontext.h>                    (react-native-safe-area-context)
//      #import <React/RCTViewComponentView.h>                         (react-native-pdf, Fabric)
//      #import <NitroModules/JSIConverter.hpp>                        (react-native-fast-tflite)
//
//  ROOT CAUSE (verified against the live Pods tree):
//  Codegen DID run — the specs exist at
//      Pods/Headers/Public/ReactCodegen/{ReactNativeBlobUtilSpec,safeareacontext}/…
//      Pods/Headers/Public/React-RCTFabric/React/RCTViewComponentView.h
//      Pods/Headers/Public/NitroModules/…
//  …but Expo SDK 52's per-pod `HEADER_SEARCH_PATHS` don't always include the
//  `ReactCodegen` and `React-RCTFabric` public-header dirs, so the angle-bracket
//  imports above can't be resolved by the consuming pods. NitroModules
//  additionally needs C++20.
//
//  THE FIX (surgical + purely additive):
//  In `post_install`, for every pod target, (1) pin C++20 + libc++ (NitroModules
//  requirement; safe — RN 0.76 New Arch already compiles core as C++20), and
//  (2) APPEND the four public-header dirs to HEADER_SEARCH_PATHS, always keeping
//  `$(inherited)` so the CocoaPods-managed paths are preserved. Extra *valid*
//  search paths can only help resolution — they never remove a pod's own paths.
//
//  We do NOT touch GCC_PREPROCESSOR_DEFINITIONS: React Native already defines
//  RCT_NEW_ARCH_ENABLED on the right targets (that's why the `#if` branches are
//  active). Forcing it ourselves is redundant and risks turning the import
//  branch on where a spec path isn't present — the opposite of what we want.
//
//  Delivered as a config plugin so it re-applies on every `expo prebuild`.
//  Idempotent (marker-guarded) and injected INSIDE Expo's single `post_install`.
// ════════════════════════════════════════════════════════════════════════════

const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// v2: fmt stays on C++17. Apple Clang 21 (Xcode 26.4/26.5 — the current EAS
// `image: "latest"` and Apple's 2026 submission toolchain) enforces stricter
// consteval rules that reject fmt 11.0.2's FMT_STRING call sites in
// format-inl.h ("call to consteval function ... is not a constant expression"
// — this killed EAS iOS store build 8, c59b97a1, on 2026-08-21). Upstream
// fixed it by bumping fmt to 12.1.0 on RN >= 0.83.9 only; the RN 0.76 line
// Expo SDK 52 uses was never patched. Under C++17 fmt's base.h derives
// FMT_USE_CONSTEVAL 0 (FMT_CPLUSPLUS < 201709L), the consteval constructor is
// never declared, and the pod compiles unchanged — fmt falls back to runtime
// format-string checks, identical behaviour for every valid format string.
// A -DFMT_USE_CONSTEVAL=0 does NOT work: fmt 11.0.2 has no #ifndef guard, so
// the header's own detection re-defines the macro and the flag loses. Only
// the language standard differs for fmt; libc++ + header paths still apply.
// The marker is versioned so a non-clean local prebuild appends the v2 block
// after a stale v1 block — Ruby runs both, v2 (textually later) wins.
const MARKER = 'nexpec-newarch-header-patch-v2';

// Ruby appended inside the existing `post_install do |installer| … end`.
// `\${…}` keeps the literal Xcode macros out of JS template interpolation;
// `$(inherited)` has no brace so it passes through unchanged.
const RUBY_PATCH = `
    # ${MARKER} — NEXPEC: make New-Architecture generated specs + Fabric +
    # NitroModules headers resolvable for every consuming pod. The specs exist
    # under Pods/Headers/Public/{ReactCodegen,React-RCTFabric,NitroModules};
    # Expo SDK 52's per-pod header paths don't always include them, which causes
    # "<XSpec/XSpec.h> / <React/RCTViewComponentView.h> file not found". Purely
    # additive — '$(inherited)' is always kept so CocoaPods' own paths survive.
    nx_extra_header_paths = [
      '"\${PODS_ROOT}/Headers/Public/ReactCodegen"',
      '"\${PODS_ROOT}/Headers/Public/React-RCTFabric"',
      '"\${PODS_ROOT}/Headers/Public/NitroModules"',
      '"\${PODS_CONFIGURATION_BUILD_DIR}/NitroModules/NitroModules.framework/Headers"'
    ]
    installer.pods_project.targets.each do |nx_t|
      nx_t.build_configurations.each do |nx_bc|
        # fmt must stay C++17: Apple Clang 21 (Xcode 26.4+) rejects fmt
        # 11.0.2's consteval FMT_STRING call sites under C++20. See the
        # "v2" note at the top of plugins/withNexpecNitroBuild.js.
        nx_bc.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] =
          nx_t.name == 'fmt' ? 'c++17' : 'c++20'
        nx_bc.build_settings['CLANG_CXX_LIBRARY'] = 'libc++'

        nx_hsp = nx_bc.build_settings['HEADER_SEARCH_PATHS']
        nx_hsp = nx_hsp.is_a?(Array) ? nx_hsp.dup : [nx_hsp || '$(inherited)']
        nx_hsp << '$(inherited)' unless nx_hsp.include?('$(inherited)')
        nx_extra_header_paths.each { |p| nx_hsp << p unless nx_hsp.include?(p) }
        nx_bc.build_settings['HEADER_SEARCH_PATHS'] = nx_hsp
      end
    end
`;

/** @param {import('expo/config').ExpoConfig} config */
const withNexpecNitroBuild = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let src = fs.readFileSync(podfilePath, 'utf8');

      if (src.includes(MARKER)) return cfg; // idempotent

      const anchor = /react_native_post_install\([\s\S]*?\)\n/m;
      if (!anchor.test(src)) {
        console.warn(
          '[withNexpecNitroBuild] react_native_post_install anchor not found — ' +
            'New-Arch header patch NOT applied. Apply the post_install block manually.',
        );
        return cfg;
      }
      src = src.replace(anchor, (m) => m + RUBY_PATCH);
      fs.writeFileSync(podfilePath, src);
      return cfg;
    },
  ]);

module.exports = withNexpecNitroBuild;
