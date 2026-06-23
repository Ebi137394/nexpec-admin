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
import { supabase } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

interface ProfileData {
  organization_id: string | null;
  role: string | null;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  organizationId: string | null;
  role: string | null;
  loading: boolean;
  // 2FA: true when the session is AAL1 but the user has a verified TOTP factor
  // (nextLevel === 'aal2'), i.e. they must complete a TOTP challenge before
  // being allowed into the app. Enforced by the AuthGate (app/_layout.tsx).
  mfaRequired: boolean;
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
    loading: true,
    mfaRequired: false,
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

  const fetchOrganization = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('organization_id, role')
      .eq('id', userId)
      .single<ProfileData>();

    if (error) {
      console.error('[AuthContext] Failed to fetch org:', error.message);
      return { organizationId: null, role: null };
    }

    return {
      organizationId: data?.organization_id ?? null,
      role: data?.role ?? null,
    };
  }, []);

  const refreshOrganization = useCallback(async () => {
    if (!state.user) return;
    const org = await fetchOrganization(state.user.id);
    setState(prev => ({ ...prev, ...org }));
  }, [state.user, fetchOrganization]);

  useEffect(() => {
    // Initialize with current session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const [org, mfaRequired] = await Promise.all([
          fetchOrganization(session.user.id),
          computeMfaRequired(),
        ]);
        setState({
          user: session.user,
          session,
          ...org,
          mfaRequired,
          loading: false,
        });
      } else {
        setState(prev => ({ ...prev, loading: false }));
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          const [org, mfaRequired] = await Promise.all([
            fetchOrganization(session.user.id),
            computeMfaRequired(),
          ]);
          setState({
            user: session.user,
            session,
            ...org,
            mfaRequired,
            loading: false,
          });
        } else {
          setState({
            user: null,
            session: null,
            organizationId: null,
            role: null,
            mfaRequired: false,
            loading: false,
          });
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [fetchOrganization, computeMfaRequired]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
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
