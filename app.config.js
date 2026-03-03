module.exports = {
  expo: {
    name: 'NEXPEC',
    slug: 'nexpec',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    scheme: 'nexpec',
    splash: {
      resizeMode: 'contain',
      backgroundColor: '#0F172A',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.nexpec.app',
      infoPlist: {
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: true,
          NSExceptionDomains: {
            'supabase.co': {
              NSExceptionAllowsInsecureHTTPLoads: true,
              NSIncludesSubdomains: true,
            },
            'sxqpjxhslzzcdrdctatm.supabase.co': {
              NSExceptionAllowsInsecureHTTPLoads: true,
              NSIncludesSubdomains: true,
            },
          },
        },
      },
    },
    android: {
      package: 'com.nexpec.app',
      usesCleartextTraffic: true,
      networkSecurityConfig: './android/app/src/main/res/xml/network_security_config.xml',
    },
    plugins: [
      [
        'expo-build-properties',
        {
          ios: {
            newArchEnabled: false,
          },
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: 'NEXPEC needs access to your photos to upload certificates.',
          cameraPermission: 'NEXPEC needs access to your camera to take photos of certificates.',
        },
      ],
      [
        'expo-document-picker',
        {
          iCloudContainerEnvironment: 'Production',
        },
      ],
      'expo-router',
      'expo-font',
      'expo-sqlite',
      'expo-file-system',
    ],
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      eas: {
        projectId: '...',
      },
    },
  },
};

