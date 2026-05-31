import 'react-native-url-polyfill/auto';
// Initialize Sentry as early as possible (no-op until EXPO_PUBLIC_SENTRY_DSN is set).
import './src/observability/sentry.native';
import 'expo-router/entry';