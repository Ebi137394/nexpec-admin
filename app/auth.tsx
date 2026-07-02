// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  app/auth.tsx — LEGACY AUTH SCREEN, retired to a redirect stub.
//
//  Why this exists as a stub instead of a working screen:
//    • The old screen here ran its own signup flow that BYPASSED the role
//      wizard and hardcoded every new profile to role: 'inspector'
//      (job_title: 'Inspector', base_location: 'To be set'), silently
//      mis-provisioning clients and agencies.
//    • Its sign-in path also routed straight to '/(tabs)' with no role
//      resolution.
//    • The canonical auth surface is /(auth)/sign-in (with sign-up and the
//      role wizard alongside it in the (auth) group). All entry points
//      should use that; any stale deep link or push('/auth') caller lands
//      here and is forwarded.
//
//  Do not resurrect the old form. If /auth needs UI again, build it inside
//  app/(auth)/ so it shares the canonical role/session handling.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
import { Redirect } from 'expo-router';

export default function LegacyAuthRedirect() {
  return <Redirect href="/(auth)/sign-in" />;
}
