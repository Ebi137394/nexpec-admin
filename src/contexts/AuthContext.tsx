// src/contexts/AuthContext.tsx

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { syncBiometricSession, isBiometricLoginEnabled } from '@/src/services/BiometricAuth';
import type { User, Session } from '@supabase/supabase-js';
import {
  classifyProfileFetchError,
  isCacheableProfile,
  resolveProfile,
  type ProfileFetchOutcome,
  type ResolvedProfile,
} from '@/src/core/auth/profileResolution';
import { readProfileCache, writeProfileCache } from '@/src/core/auth/profileCache';
import { onNetworkChange, startNetworkListener } from '@/src/core/offline/network';

interface ProfileData {
  organization_id: string | null;
  role: string | null;
  terms_accepted_at: string | null;
  marketplace_activated: boolean | null;
}

/** D38: how the current role/terms values were obtained.
 *  'network' — authoritative online answer;
 *  'cache'   — last validated snapshot (offline cold start);
 *  'none'    — no authoritative data at all → the gate shows the
 *              profile-unavailable screen, never the stance chooser. */
export type ProfileSource = 'network' | 'cache' | 'none';

interface AuthState {
  user: User | null;
  session: Session | null;
  organizationId: string | null;
  role: string | null;
  /** False only for an inspector / agency / supplier that NEXPEC has not yet
   *  activated. Drives the pending-verification routing in app/index.tsx. */
  marketplaceActivated: boolean;
  // Legal gateway: false until the user has accepted the Master ToS + Privacy
  // Policy (profiles.terms_accepted_at). The AuthGate blocks app entry until
  // this is true. Enforced in app/_layout.tsx.
  termsAccepted: boolean;
  loading: boolean;
  // 2FA: true when the session is AAL1 but the user has a verified TOTP factor
  // (nextLevel === 'aal2'), i.e. they must complete a TOTP challenge before
  // being allowed into the app. Enforced by the AuthGate (app/_layout.tsx).
  mfaRequired: boolean;
  // D38: provenance of role/termsAccepted (see ProfileSource).
  profileSource: ProfileSource;
}

interface AuthContextValue extends AuthState {
  signOut: () => Promise<void>;
  refreshOrganization: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, role: string) => Promise<{success: boolean; error?: string}>;
  // Re-evaluate the AAL after a successful TOTP challenge so the gate releases.
  recheckMfa: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    organizationId: null,
    role: null,
    termsAccepted: false,
    // Signed-out default: not pending. Routing only consults this once a role
    // is known, and a signed-out user has none.
    marketplaceActivated: true,
    loading: true,
    mfaRequired: false,
    profileSource: 'none',
  });

  // ── 2FA: is the current session AAL1 while a verified TOTP factor exists? ──
  const computeMfaRequired = useCallback(async (): Promise<boolean> => {
    try {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error || !data) return false;
      // currentLevel 'aal1' + nextLevel 'aal2' === a verified factor exists but
      // this session hasn't been challenged yet → step-up required.
      return data.currentLevel === 'aal1' && data.nextLevel === 'aal2';
    } catch {
      return false;
    }
  }, []);

  // D38: the fetch returns an OUTCOME — an authoritative answer ('ok', which
  // includes "the profile row does not exist") or 'unavailable' (network /
  // timeout / Supabase failure). 'unavailable' is NEVER converted into a
  // role-less profile: the resolver below serves the last validated cache, or
  // reports 'none' so the gate shows the offline screen instead of the
  // stance chooser. This path never writes to the profiles table.
  const fetchProfileOutcome = useCallback(async (userId: string): Promise<ProfileFetchOutcome> => {
    // QA-only deterministic transport mock (bundle-time flag, off by default —
    // same mechanism as ML_RUNTIME): simulators share the host network, so the
    // D38 offline-cold-start behavior is proven by injecting 'unavailable'
    // deterministically instead of toggling host Wi-Fi. Never set in release.
    if (process.env.EXPO_PUBLIC_QA_PROFILE_OFFLINE === '1') {
      return { status: 'unavailable', reason: 'qa-injected-offline' };
    }
    let lastReason = 'unknown';
    for (let attempt = 0; attempt < 3; attempt++) {
      // Per-attempt deadline: with radios off some stacks (Android emulator
      // included) silently DROP packets instead of refusing connections, so an
      // un-timed fetch hangs on TCP timeouts and the offline cold start sat on
      // the gate spinner for ~100s before the cache could serve. 6s bounds
      // each attempt; an abort classifies as 'unavailable' like any network
      // failure.
      const ctl = new AbortController();
      const deadline = setTimeout(() => ctl.abort(), 6000);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('organization_id, role, terms_accepted_at, marketplace_activated')
          .eq('id', userId)
          .abortSignal(ctl.signal)
          .single<ProfileData>();
        if (!error && data) {
          return {
            status: 'ok',
            profile: {
              organizationId: data.organization_id ?? null,
              role: data.role ?? null,
              termsAccepted: !!data.terms_accepted_at,
              // null === column not present yet → not pending. See
              // ProfileSnapshot.marketplaceActivated for why this fails open.
              marketplaceActivated: data.marketplace_activated !== false,
            },
          };
        }
        if (classifyProfileFetchError(error) === 'authoritative-missing') {
          // A REAL answer: this user has no profile row → genuinely role-less.
          return {
            status: 'ok',
            profile: {
              organizationId: null,
              role: null,
              termsAccepted: false,
              marketplaceActivated: true,
            },
          };
        }
        lastReason = error?.message ?? 'unknown supabase error';
      } catch (e) {
        lastReason = (e as Error)?.message ?? 'network failure';
      } finally {
        clearTimeout(deadline);
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    console.error('[AuthContext] profile fetch unavailable after retries:', lastReason);
    return { status: 'unavailable', reason: lastReason };
  }, []);

  const fetchOrganization = useCallback(async (userId: string) => {
    const outcome = await fetchProfileOutcome(userId);
    if (isCacheableProfile(outcome)) {
      // Only authoritative, role-bearing snapshots are cached (D38).
      await writeProfileCache(AsyncStorage, userId, outcome.profile);
    }
    const cached = outcome.status === 'ok' ? null : await readProfileCache(AsyncStorage, userId);
    const resolved: ResolvedProfile = resolveProfile(outcome, cached);
    if (resolved.source === 'none') {
      return {
        organizationId: null,
        role: null,
        termsAccepted: false,
        marketplaceActivated: true,
        profileSource: 'none' as const,
      };
    }
    return { ...resolved.profile, profileSource: resolved.source };
  }, [fetchProfileOutcome]);

  const refreshOrganization = useCallback(async () => {
    if (!state.user) return;
    const org = await fetchOrganization(state.user.id);
    setState(prev => ({ ...prev, ...org }));
  }, [state.user, fetchOrganization]);

  // D38: automatic rehydration — when connectivity returns and the current
  // values are not network-authoritative, refetch once. startNetworkListener
  // is idempotent (shared with the offline outbox).
  useEffect(() => {
    if (!state.user || state.profileSource === 'network') return;
    startNetworkListener();
    const unsub = onNetworkChange((online) => {
      if (online) void refreshOrganization();
    });
    return unsub;
  }, [state.user, state.profileSource, refreshOrganization]);

  useEffect(() => {
    let cancelled = false;

    // Hydrate auth state from a session. Runs OUTSIDE supabase-js's auth lock
    // (see the deferral note on onAuthStateChange below). Always terminates in
    // `loading: false` — including on failure — because AuthGate gates every
    // redirect on `!loading`, so a throw here would strand the user on the
    // login screen with a perfectly valid session.
    const hydrate = async (session: Session | null) => {
      if (!session?.user) {
        if (!cancelled) {
          setState({
            user: null,
            session: null,
            organizationId: null,
            role: null,
            termsAccepted: false,
            marketplaceActivated: true,
            mfaRequired: false,
            loading: false,
            profileSource: 'none',
          });
        }
        return;
      }
      try {
        const [org, mfaRequired] = await Promise.all([
          fetchOrganization(session.user.id),
          computeMfaRequired(),
        ]);
        if (!cancelled) {
          setState({ user: session.user, session, ...org, mfaRequired, loading: false });
        }
      } catch {
        // Profile/MFA enrichment failed (offline, transient PostgREST error).
        // Surface the session anyway so the app is usable and the guard can
        // route; fetchOrganization already falls back to the profile cache.
        if (!cancelled) {
          setState(prev => ({ ...prev, user: session.user, session, loading: false }));
        }
      }
    };

    // Initial session (cold start, incl. cold start straight after an OAuth
    // deep-link callback). .catch keeps `loading` from sticking on failure.
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => hydrate(session))
      .catch(() => { if (!cancelled) setState(prev => ({ ...prev, loading: false })); });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        // Keep the biometric refresh token in step with rotation. No-op unless
        // the user enabled biometric login; never throws. Fire-and-forget so
        // it cannot delay or break auth state propagation.
        void syncBiometricSession(session);

        // ★ This callback MUST stay synchronous and MUST NOT await any Supabase
        //   call. supabase-js holds its internal auth lock while callbacks run;
        //   awaiting another Supabase call here (computeMfaRequired() calls
        //   auth.mfa.getAuthenticatorAssuranceLevel(), and fetchOrganization()
        //   queries profiles) can deadlock against that lock. When it did, the
        //   await never resolved, setState never ran, `loading` stayed true and
        //   AuthGate never redirected — the OAuth session existed but the app
        //   sat on login until a force-close, whose getSession() path runs
        //   outside the lock. setTimeout(0) defers hydration until after this
        //   callback returns and the lock is released.
        //   Guarded by scripts/qa/check-auth-hydration.mjs.
        setTimeout(() => { void hydrate(session); }, 0);
      }
    );

    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [fetchOrganization, computeMfaRequired]);

  const signOut = useCallback(async () => {
    // Remove this user's push token first so a shared/resold device never keeps
    // receiving the prior user's pushes (push_tokens PK = user_id).
    try {
      const { data: u } = await supabase.auth.getUser();
      if (u.user?.id) {
        // outbox-exempt: best-effort logout cleanup; queuing a delete post-sign-out is pointless
        await supabase.from('push_tokens').delete().eq('user_id', u.user.id);
      }
    } catch { /* best-effort; never block sign-out */ }
    // Biometric re-login depends on the keystore refresh token surviving
    // logout. supabase-js defaults signOut() to scope 'global', which revokes
    // EVERY refresh token for the user — including the stored one — so the
    // next unlock always failed with "session expired" and biometric login
    // could never work. Sign out locally (this device's session only) when the
    // user has opted into biometric login; keep the stronger global revocation
    // for everyone else. Both paths clear the local session identically.
    let biometricEnabled = false;
    try { ({ enabled: biometricEnabled } = await isBiometricLoginEnabled()); } catch { /* default false */ }
    await supabase.auth.signOut(biometricEnabled ? { scope: 'local' } : undefined);
  }, []);

  // Called by the TOTP challenge screen after a successful mfa.verify so the
  // gate (which reads mfaRequired) immediately releases into the app.
  const recheckMfa = useCallback(async () => {
    const mfaRequired = await computeMfaRequired();
    setState(prev => ({ ...prev, mfaRequired }));
  }, [computeMfaRequired]);

  // Add signIn function
  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
  }, []);

  // Add signUp function
  const signUp = useCallback(async (email: string, password: string, role: string) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            role: role // Critical: Pass the role to user metadata so the DB trigger catches it
          }
        }
      });

      if (error) throw error;
      return { success: true };
    } catch (err: any) {
      console.error('Signup error:', err.message);
      return { success: false, error: err.message || 'Signup failed' };
    }
  }, []);

  // Memoize the context value so auth consumers don't re-render on every
  // provider render — only when auth state or the (stable) callbacks change.
  const value = useMemo(
    () => ({ ...state, signOut, refreshOrganization, signIn, signUp, recheckMfa }),
    [state, signOut, refreshOrganization, signIn, signUp, recheckMfa],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Helper hook to get a stable organization ID primitive
export function useOrganizationId(): string | null {
  const { organizationId } = useAuth();
  // Return a stable primitive - this prevents re-renders when the object reference changes
  return organizationId;
}
