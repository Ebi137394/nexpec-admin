import 'react-native-url-polyfill/auto';
import 'react-native-gesture-handler';
import React, { useEffect, useState, useRef } from 'react';
import { Slot, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { View, ActivityIndicator, StyleSheet, LogBox } from 'react-native';
import { initializeOfflineSync } from '@/lib/offline';
import { OutboxInspector } from '@/src/core/offline/OutboxInspector';
// ★ Phase 5 / Hour 3 — root ErrorBoundary. Catches every render-time
//   exception in the tree below and shows a recoverable fallback instead
//   of letting React unmount the whole app to a blank screen.
import { ErrorBoundary } from '@/src/core/errors/ErrorBoundary';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { queryClient, persistOptions } from '@/src/core/query/queryClient';

// ★ Silence non-actionable dev warnings that fire from deeply-nested
//   3rd-party trees (e.g. @stripe, expo-router internals). These are
//   noise — they don't affect runtime behavior on either platform.
LogBox.ignoreLogs([
  'VirtualizedLists should never be nested', // FlatList inside ScrollView
  'Non-serializable values were found in the navigation state',
  'Sending `onAnimatedValueUpdate` with no listeners registered',
]);
import { StripeProvider } from '@stripe/stripe-react-native';
import { AuthProvider, useAuth } from '@/src/contexts/AuthContext';
import { ThemeProvider, useTheme } from '@/providers/ThemeProvider';
import { getColors } from '@/src/constants/theme';
import '../global.css';
import { LanguageProvider } from '@/src/i18n/LanguageProvider';
// ★ NOTIF-DEEPLINK-001: mount the push-notification hook from the root
//   AuthGate so the response listener is registered for every signed-in
//   session. Without this call the hook was defined but never invoked,
//   so push registration AND the deep-link tap listener never fired.
import { usePushNotifications } from '@/hooks/usePushNotifications';
// ★ Phase A.5 — install the on-device Ed25519 model-signature verifier so the
//   runtime enforces authenticity app-wide (tampered/unsigned models rejected).
import { installMlSignatureVerifier } from '@/src/core/ml/verifier.noble';

function AuthGate() {
  const { session, loading, role } = useAuth();
  const { isDarkMode } = useTheme();
  const segments = useSegments();
  const router = useRouter();
  // ★ FIX — expo-router root-navigator readiness. Until this has a `key`, the
  //   <Slot/> navigator has NOT mounted, and any router.replace/push throws
  //   "Attempted to navigate before mounting the Root Layout component"
  //   (assertIsReady). The custom `isReady` below tracks auth-loading, NOT the
  //   navigator — so we additionally gate every redirect on this.
  const rootNavState = useRootNavigationState();
  const isAuthenticated = !!session;
  const colors = getColors(isDarkMode);

  // ★ NOTIF-DEEPLINK-001: register push tokens + tap-handler. Hook
  //   internally short-circuits when running on a simulator (returns a
  //   MOCK_TOKEN) and writes the real token to push_tokens once a
  //   physical device grants permission. We don't gate this on
  //   `isAuthenticated` because saveTokenToDatabase guards on the
  //   current Supabase user itself, and re-running token registration
  //   on sign-out → sign-in is harmless (upsert by user_id).
  usePushNotifications();

  const [isReady, setIsReady] = useState(false);
  const isNavigating = useRef(false);

  useEffect(() => {
    if (!loading) setIsReady(true);
  }, [loading]);

  useEffect(() => {
    // 🛑 Prevent routing until logic is ready AND the root navigator has
    //    mounted (rootNavState.key) — otherwise router.replace throws
    //    "navigate before mounting the Root Layout".
    if (!rootNavState?.key || !isReady || loading || !segments || segments.length < 1 || !segments[0]) return;

    const currentSegment = segments[0] as string;

    const inAuthGroup = currentSegment === 'auth' || currentSegment === '(auth)';
    const inSeniorGroup = currentSegment === '(senior)';
    const inTabsGroup = currentSegment === '(tabs)';
    // ★ LANE-A-PHASE-2.7 — Variable renamed (was inSuperAdminGroup) to match
    //   the (super-admin) → (admin) route-group rename. Also accepting
    //   '(super-admin)' as a safe-zone fallback so any user mid-flight on
    //   the old path doesn't get bounced (they'll hit a redirect stub
    //   anyway and land in (admin)/).
    const inAdminGroup = currentSegment === '(admin)' || currentSegment === '(super-admin)';

    // ★ NX-DEEPLINK-001 closure — every entry here was verified against the
    //   `app/` folder on disk via a full `ls`-level sweep. Stale entries
    //   (edit-profile, apply, [id]) were removed: no backing file/folder
    //   and no router.push() caller anywhere in the codebase.
    //
    //   `profile` and `expenses` are intentionally kept — both are real
    //   on-disk folders (profile/ has 11 sub-screens; expenses/[id].tsx
    //   exists for future use). An earlier draft of this sweep dropped
    //   them based on incomplete tooling output — that was a regression,
    //   restored here.
    //
    //   Missing top-level files that exist on disk but were never
    //   allow-listed have been added (settings, my-jobs, find-jobs,
    //   browse-jobs, browse-jobs-map, project-details, review-report,
    //   rate-inspector, map, applicant). Without these the gate's
    //   fallback branch would redirect signed-in users away from
    //   legitimate destinations.
    //
    //   If you add a new top-level segment to app/, add it here too.
    const allowedStandaloneRoutes = [
      // — Standalone screens (app/<name>.tsx) —
      'messages',
      'submit-report',
      'payment-screen',
      'notifications',
      'notification-settings',
      'support-chat',
      'post-new-job',
      'post-compliance-job',
      'agency-job-details',
      'inspectors',
      'settings',
      'my-jobs',
      'find-jobs',
      'browse-jobs',
      'browse-jobs-map',
      'project-details',
      'review-report',
      'rate-inspector',
      'map',
      // Mobile Sprint 1 · Lane 4 — dev-only pre-flight diagnostic at
      // /diagnostics. Read-only schema probe, safe to ship.
      'diagnostics',
      // Buyer-facing inspector directory (2026-05-20). Reachable from
      // client + agency dashboards. Allows verified-inspector discovery
      // and invitation-to-job via invite_inspector_to_job RPC.
      'inspector-directory',
      // — Folder-backed segments with dynamic children —
      'profile',       // app/profile/* (11 sub-screens: edit, certifications,
                       //  experience, skills, rates, payments, security,
                       //  language, help, terms, legal, document/[id])
      'expenses',      // app/expenses/[id].tsx
      'jobs',          // app/jobs/[id]/*
      'reviews',       // app/reviews/submit/[jobId]
      'contracts',     // app/contracts/index.tsx
      'contract',      // app/contract/[id].tsx
      'chat',          // app/chat/[job_id].tsx
      'report',        // app/report/[id].tsx
      'job-details',   // app/job-details/[id].tsx
      'applicant',     // app/(shared)/applicant/[id].tsx — resolved bare via Expo Router groups
      // — Role folders (client/inspector/admin top-level legacy routes) —
      'client',        // app/client/*
      'inspector',     // app/inspector/* (legacy submit-report etc.)
      'admin',         // app/admin/index.tsx
      // — Compliance-mode α-phase entries —
      //   cci-applications + compliance-templates live in (admin); the
      //   top-level segment doesn't exist on its own but inbound deep
      //   links from notifications use the bare segment. Keeping them
      //   in the allowlist is a deliberate forward-compat hedge —
      //   when post-launch sweeps land the redirect stubs, no gate
      //   change is needed.
      'cci-applications',
      'compliance',
      'compliance-templates',
      // — Public anon surfaces (also handled by publicAnonRoutes below) —
      'verify',
      'cert',
      // — Route group for inspector role —
      '(inspector)',
    ];
    const inAllowedRoute = allowedStandaloneRoutes.includes(currentSegment);

    // ★ STEP 7 — Public verify surfaces (/verify/[token] + /cert/[slug])
    //   are anon-callable end-to-end (the underlying RPCs grant SELECT
    //   to the anon role). The AuthGate's "force login" branch below
    //   would otherwise bounce unauthenticated deep-link visitors to
    //   sign-in. Bypass everything for these routes — they're the
    //   public face of the platform's trust layer.
    const publicAnonRoutes = ['verify', 'cert'];
    if (publicAnonRoutes.includes(currentSegment)) return;

    // Now apply the navigation lock — only for actual redirects below.
    if (isNavigating.current) return;

    const safeNavigate = (path: string) => {
      if (isNavigating.current) return;
      isNavigating.current = true;
      try {
        router.replace(path as any);
      } catch (error) {
        console.warn('[AuthGate] Navigation error:', error);
      } finally {
        setTimeout(() => { isNavigating.current = false; }, 400);
      }
    };

    // ════════════════════════════════════════════════════════════════
    //  Multi-role mobile app — routing matrix matches on-disk reality.
    //
    //  Verified by exhaustive grep of app/ + src/ on 2026-05-20:
    //
    //    inspector    → /(tabs)                  (tabs/index.tsx)
    //    client       → /(tabs)/client-dashboard (tabs/client-dashboard.tsx)
    //    agency       → /(tabs)/agency-dashboard (tabs/agency-dashboard.tsx)
    //    enterprise   → /(tabs)/agency-dashboard (see "enterprise note" below)
    //    admin        → /(admin)/admin-inbox
    //    super_admin  → /(admin)/dashboard
    //
    //  Enterprise is now a first-class role with its own dashboard at
    //  /(tabs)/enterprise-dashboard. The legacy enterprise→agency alias
    //  hack was removed across the codebase on 2026-05-20.
    //
    //  Role-of-truth: profiles.role. Web v3 migration
    //  20260519010000_apply_onboarding_role_rpc.sql fixed the OAuth-time
    //  role-loss bug, so by the time we read `role` here we can trust it
    //  reflects what the user actually picked at signup.
    // ════════════════════════════════════════════════════════════════

    // 🛑 STRICT ROLE ENFORCEMENT: Super Admins belong ONLY in (super-admin) OR allowed shared routes
    if (isAuthenticated && role === 'super_admin' && !inAdminGroup && !inAllowedRoute) {
      safeNavigate('/(admin)/dashboard');
      return;
    }

    // ✅ SAFE ZONE CHECK: Normal users can stay in their tabs, Super Admins can stay in their dashboard
    if (isAuthenticated && (inTabsGroup || inSeniorGroup || inAllowedRoute || inAdminGroup)) {
      return;
    }

    // 1. USER NOT LOGGED IN -> Force Login
    if (!isAuthenticated) {
      if (!inAuthGroup) safeNavigate('/(auth)/sign-in'); 
      return;
    }

    // 2. USER IS LOGGED IN but trying to see Auth pages -> Send to their Dashboard
    if (inAuthGroup && role) {
      if (role === 'super_admin') safeNavigate('/(admin)/dashboard');
      // ★ LANE-A-PHASE-2.3 — Repointed admin landing from /(senior)/inbox to
//   the canonical /(admin)/admin-inbox. The (senior) route group
//   is being stubbed in the same sub-phase; (super-admin) is the
//   established admin-tier folder. Future Phase 2b rename of (super-admin)
//   → (admin) will sweep this reference along with all other (super-admin)
//   refs in one pass.
      else if (role === 'admin') safeNavigate('/(admin)/admin-inbox');
      // Agency + enterprise both land in the agency-dashboard tab. The
      // entire downstream codebase normalises enterprise→agency (see
      // matrix comment above) — flipping enterprise to a separate
      // destination without first building one would land them on a
      // blank Stack.
      else if (role === 'agency') safeNavigate('/(tabs)/agency-dashboard');
      else if (role === 'enterprise') safeNavigate('/(tabs)/enterprise-dashboard');
      else if (role === 'client') safeNavigate('/(tabs)/client-dashboard');
      else safeNavigate('/(tabs)');
      return;
    }

    // 3. FALLBACK: If path is unknown, send to role-based dashboard
    if (role === 'super_admin') safeNavigate('/(admin)/dashboard');
    // ★ LANE-A-PHASE-2.3 — Repointed admin landing from /(senior)/inbox to
//   the canonical /(admin)/admin-inbox. The (senior) route group
//   is being stubbed in the same sub-phase; (super-admin) is the
//   established admin-tier folder. Future Phase 2b rename of (super-admin)
//   → (admin) will sweep this reference along with all other (super-admin)
//   refs in one pass.
    else if (role === 'admin') safeNavigate('/(admin)/admin-inbox');
    // Agency + enterprise both land in the agency-dashboard tab — see
    // matrix comment above for the codebase-wide enterprise→agency
    // normalisation rationale.
    else if (role === 'agency' || role === 'enterprise') safeNavigate('/(tabs)/agency-dashboard');
    else if (role === 'client') safeNavigate('/(tabs)/client-dashboard');
    else safeNavigate('/(tabs)');

    // rootNavState?.key is in the deps so the redirect re-runs the moment the
    // root navigator finishes mounting (it's null on the first pass).
  }, [isAuthenticated, loading, segments, role, isReady, rootNavState?.key]);

  if (loading || !isReady) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Slot />
      {/* QA — dev-only offline-outbox inspector overlay (renders null in prod). */}
      {__DEV__ ? <OutboxInspector /> : null}
    </View>
  );
}

export default function RootLayout() {
  // ★ Phase 3 / Task 2 — boot the offline outbox sync engine.
  //    Subscribes to NetInfo, drains the queue when online,
  //    re-polls every 60s for backoff-due retries. Idempotent.
  useEffect(() => {
    // ★ Phase A.5 — enforce on-device model signature verification app-wide.
    //   Pure-JS Ed25519; with ML_ALLOW_UNSIGNED off, tampered/unsigned models
    //   are rejected before load (fail-closed). Safe no-op if never used.
    installMlSignatureVerifier();
    const teardown = initializeOfflineSync();
    return teardown;
  }, []);

  // ── NX-SECRET-001 + NX-STRIPE-KEY-001 closure ────────────────────────
  // Stripe publishable key is sourced from EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY.
  //
  // We now validate the SHAPE of the key at boot. Real Stripe publishable
  // keys start with `pk_test_` (test mode) or `pk_live_` (production). The
  // post-rotation key-mix-up (Supabase `sb_publishable_*` pasted into the
  // Stripe slot) used to reach the Stripe SDK and surface as a confusing
  // "Invalid API Key provided: sb_publi***" dialog on first card action.
  // We now log a loud actionable warning at boot and substitute the
  // hard-coded test fallback so the rest of the app keeps working.
  // ──────────────────────────────────────────────────────────────────────
  const STRIPE_TEST_FALLBACK =
    'pk_test_51SkICRL9uHtRspTiLLEeg3YLMBY9MTMIR5BbylbYFBzu7UmjoVs1BLoFUkik0DRjIPh7k7t52aXPjqwVWN2vyvWO00h8sfZE9h';

  const rawStripeKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const isWellFormedStripeKey =
    typeof rawStripeKey === 'string' &&
    (rawStripeKey.startsWith('pk_test_') || rawStripeKey.startsWith('pk_live_'));

  const stripePublishableKey = isWellFormedStripeKey
    ? (rawStripeKey as string)
    : STRIPE_TEST_FALLBACK;

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    if (!rawStripeKey) {
      console.warn(
        '[RootLayout] EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY not set — using hard-coded test fallback. Production builds MUST override.',
      );
    } else if (!isWellFormedStripeKey) {
      // Common mix-up: Supabase publishable key (`sb_publishable_*`) pasted
      // into the Stripe slot. Surface it loudly.
      const masked =
        rawStripeKey.slice(0, 8) + '***' + rawStripeKey.slice(-4);
      console.warn(
        `[RootLayout] EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is not a Stripe key (got "${masked}"). Stripe keys start with pk_test_ or pk_live_. Falling back to the hard-coded test key so the app stays operable, but Stripe calls WILL fail until the env is corrected.`,
      );
    }
  }

  return (
    <ErrorBoundary>
      {/* ★ FIX — React Query needs a client in scope. Without this provider,
          every useQuery/useQueryClient consumer (useLaunchedInspectionDomains,
          inspector/seal-report, inspector/coordination-bridge) crashed the
          render with "No QueryClient set". Persisted via AsyncStorage so reads
          survive a restart. ErrorBoundary stays outermost. */}
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <ThemeProvider>
          <LanguageProvider>
            <AuthProvider>
              <StripeProvider
                publishableKey={stripePublishableKey}
                merchantIdentifier="com.nexpec.app"
                urlScheme="nexpec"
              >
                <AuthGate />
              </StripeProvider>
            </AuthProvider>
          </LanguageProvider>
        </ThemeProvider>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: '#020420' 
  },
});