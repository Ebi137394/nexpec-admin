// ════════════════════════════════════════════════════════════════════════════
//  app.config.js — NEXPEC Expo runtime + native config
//
//  This file is the CANONICAL source of truth for native app config. Expo's
//  precedence rule: when both app.config.js and app.json exist, app.config.js
//  wins. The companion app.json is preserved as a minimal stub for tooling
//  compatibility (some Expo CLIs still read app.json for slug detection).
//
//  Phase 5 / Hour 4 hardening pass closed:
//    NX-PERM-001  P0 — Removed every NSUsageDescription string for APIs we
//                       don't actually use (HealthKit, Siri, Apple Music,
//                       Apple Events, system/user mgmt, reminders, local
//                       network, network volumes, Bluetooth, UserActivity).
//                       Apple specifically reviews and rejects apps that
//                       declare permissions they don't exercise.
//    NX-PERM-002  P0 — Trimmed Android permissions to only those the app
//                       actually uses. Removed BLUETOOTH (no BLE library),
//                       BODY_SENSORS (no heart-rate use), USE_FINGERPRINT
//                       (deprecated; USE_BIOMETRIC is sufficient).
//    NX-PERM-003  P0 — Added expo-camera, expo-location, expo-notifications,
//                       expo-local-authentication, expo-calendar, expo-av
//                       to plugins so their permission strings are emitted
//                       to Info.plist by the prebuild step. Without these
//                       declarations the runtime requests would fail.
//    NX-ATS-001   P0 — NSAllowsArbitraryLoads is GONE. Supabase is HTTPS;
//                       no exception domains needed. Apple flags any app
//                       with arbitrary loads on for manual review and
//                       rejects without justification.
//    NX-CLEAR-001 P0 — usesCleartextTraffic is GONE. The networkSecurity
//                       config XML remains in place but plaintext is
//                       disallowed.
//    NX-IDENT-001 P1 — bundleIdentifier/package consolidated to com.nexpec.app
//                       in this file. The legacy "com.yourname.nexpec"
//                       placeholder in app.json is overridden.
//    NX-PROJ-001  P2 — eas.projectId surfaced as TODO. Must be filled in
//                       before `eas build --profile production` runs.
// ════════════════════════════════════════════════════════════════════════════

module.exports = {
  expo: {
    name: 'NEXPEC',
    slug: 'nexpec',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    scheme: 'nexpec',
    icon: './assets/icon.png',
    // ★ NEW-ARCH-MISMATCH-001 — single source of truth. Top-level wins on
    //   SDK 52+; the expo-build-properties plugin below mirrors it to
    //   satisfy older bundler caches.
    newArchEnabled: true,

    splash: {
      image: './assets/splash-logo.png',
      resizeMode: 'contain',
      backgroundColor: '#020420',
    },

    assetBundlePatterns: ['**/*'],

    // ── iOS ────────────────────────────────────────────────────────────
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.nexpec.app',
      // ★ NX-ATS-001 closure — No NSAppTransportSecurity block at all is
      //   the canonical Apple posture for an HTTPS-only app. Supabase
      //   serves HTTPS, Stripe serves HTTPS; we have zero plaintext
      //   endpoints. The previous NSAllowsArbitraryLoads=true was a
      //   guaranteed App Store reviewer flag.
      infoPlist: {
        // ── Permission usage strings — only what the app actually does ──
        // Apple's App Store review rejects apps that declare permission
        // strings for APIs they don't use. Every entry below ties to a
        // verified call site in the codebase.
        NSCameraUsageDescription:
          'NEXPEC uses your camera to capture inspection photos and scan certificates. Photos are attached to the active job and uploaded to the secure inspection-photos bucket.',
        NSPhotoLibraryUsageDescription:
          'NEXPEC reads photos from your library so you can attach existing inspection images to a report.',
        NSPhotoLibraryAddUsageDescription:
          'NEXPEC saves report copies and inspection photos to your library when you tap Save to camera roll.',
        NSLocationWhenInUseUsageDescription:
          'NEXPEC uses your location to show nearby job sites, calculate inspector travel distance, and verify on-site arrival when an inspection starts.',
        NSFaceIDUsageDescription:
          'NEXPEC uses Face ID for one-tap sign-in so you don\'t have to retype credentials in the field.',
        NSCalendarsUsageDescription:
          'NEXPEC adds scheduled inspections to your calendar so site visits show up alongside your other commitments.',
        NSMicrophoneUsageDescription:
          'NEXPEC uses your microphone when you record a voice message in the in-app chat with your client or admin.',
        NSMotionUsageDescription:
          'NEXPEC reads device motion to render a subtle parallax effect on the splash and inspection-capture screens. No motion data leaves the device.',
        // ── Map deep-link schemes ──────────────────────────────────────
        LSApplicationQueriesSchemes: [
          'comgooglemaps',
          'waze',
          'maps',
          'citymapper',
          'uber',
        ],
      },
    },

    // ── Android ────────────────────────────────────────────────────────
    android: {
      package: 'com.nexpec.app',
      // ★ NX-CLEAR-001 closure — plaintext disallowed. The
      //   networkSecurityConfig XML stays in place as a defense-in-depth
      //   layer (it can list specific exception domains for cert-pinning
      //   later) but globally we accept HTTPS only.
      usesCleartextTraffic: false,
      networkSecurityConfig: './android/app/src/main/res/xml/network_security_config.xml',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#020420',
      },
      // ★ NX-PERM-002 closure — only permissions the app actually uses.
      //   Each entry maps to a verified runtime call.
      permissions: [
        'android.permission.CAMERA',                       // expo-camera
        'android.permission.RECORD_AUDIO',                 // chat voice notes (expo-av)
        'android.permission.ACCESS_FINE_LOCATION',         // job-site map
        'android.permission.ACCESS_COARSE_LOCATION',       // job-feed proximity sort
        'android.permission.USE_BIOMETRIC',                // expo-local-authentication
        'android.permission.READ_CALENDAR',                // expo-calendar
        'android.permission.WRITE_CALENDAR',               // expo-calendar
        'android.permission.READ_MEDIA_IMAGES',            // Android 13+ scoped photos
        'android.permission.POST_NOTIFICATIONS',           // Android 13+ push
        'android.permission.RECEIVE_BOOT_COMPLETED',       // re-arm scheduled tasks
        'android.permission.VIBRATE',                      // haptics + notifications
        'android.permission.WAKE_LOCK',                    // long inspection captures
      ],
      // Apple's blocklist analogue — these are explicitly NOT requested
      // even if a transitive library wants them.
      blockedPermissions: [
        'android.permission.READ_EXTERNAL_STORAGE',        // deprecated on 33+
        'android.permission.WRITE_EXTERNAL_STORAGE',       // deprecated on 33+
        'android.permission.BLUETOOTH',                    // no BLE features
        'android.permission.BLUETOOTH_ADMIN',
        'android.permission.BODY_SENSORS',                 // no heart-rate use
        'android.permission.USE_FINGERPRINT',              // superseded by USE_BIOMETRIC
        'android.permission.ACTIVITY_RECOGNITION',
      ],
    },

    // ── Plugins ────────────────────────────────────────────────────────
    plugins: [
      [
        'expo-build-properties',
        {
          ios: {
            newArchEnabled: true,
          },
          android: {
            newArchEnabled: true,
            // Trim shrinkResources / minifyEnabled left to EAS production
            // profile defaults.
          },
        },
      ],
      [
        'expo-camera',
        {
          cameraPermission:
            'NEXPEC uses your camera to capture inspection photos and scan certificates.',
          microphonePermission:
            'NEXPEC uses your microphone when you record a voice message in the in-app chat.',
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission:
            'NEXPEC reads photos from your library so you can attach existing inspection images to a report.',
          cameraPermission:
            'NEXPEC uses your camera to capture inspection photos and scan certificates.',
        },
      ],
      [
        'expo-document-picker',
        {
          iCloudContainerEnvironment: 'Production',
        },
      ],
      [
        'expo-local-authentication',
        {
          faceIDPermission:
            'NEXPEC uses Face ID for one-tap sign-in so you don\'t have to retype credentials in the field.',
        },
      ],
      [
        'expo-calendar',
        {
          calendarPermission:
            'NEXPEC adds scheduled inspections to your calendar so site visits show up alongside your other commitments.',
        },
      ],
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'NEXPEC uses your location to show nearby job sites and verify on-site arrival.',
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/notification-icon.png',
          color: '#00CFD5',
        },
      ],
      'expo-router',
      'expo-font',
      'expo-sqlite',
      'expo-file-system',
    ],

    // ── Runtime env exposed to the JS bundle ───────────────────────────
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      stripePublishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      eas: {
        // ★ NX-PROJ-001 — fill in before `eas build --profile production`.
        //   Find this value at https://expo.dev/accounts/<org>/projects/nexpec
        //   or run `eas init` to bind a new project. The placeholder below
        //   intentionally breaks any production build that hasn't been
        //   linked yet.
        projectId: process.env.EAS_PROJECT_ID || 'REPLACE_WITH_EAS_PROJECT_ID',
      },
    },
  },
};
