import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        contentStyle: { backgroundColor: '#070716' },
      }}
    >
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      {/* Inspector-only app: clients/agencies/enterprises land here from
          AuthGate instead of into the legacy (tabs) surfaces. */}
      <Stack.Screen name="use-web-portal" />
    </Stack>
  );
}