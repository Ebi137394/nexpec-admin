import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import { Alert } from 'react-native';
import { useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { UserRole, UserProfile } from '@/types/core';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

function useProtectedRoute(
  session: Session | null,
  profile: UserProfile | null,
  loading: boolean
) {
  const segments = useSegments();
  const router = useRouter();
  
  // 🛑 The Safety Brake
  const rootNavigationState = useRootNavigationState();

  useEffect(() => {
    // 1. Wait for Expo Router to finish mounting completely
    if (!rootNavigationState?.key) return;
    
    // 2. Wait for Supabase to finish loading the user
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inSeniorGroup = segments[0] === '(senior)';
    const inTabsGroup = segments[0] === '(tabs)';

    // Not authenticated → send to login
    if (!session) {
      if (!inAuthGroup) {
        router.replace('/(auth)/login');
      }
      return;
    }

    // Authenticated but still on auth screens → route by role
    if (inAuthGroup && profile) {
      if (profile.role === 'admin') {
        router.replace('/(senior)/inbox');
      } else {
        router.replace('/(tabs)/dashboard');
      }
      return;
    }

    // RBAC Guard: Inspector trying to access senior routes
    if (inSeniorGroup && profile && profile.role === 'inspector') {
      Alert.alert('Access Denied', 'You do not have permission to access this area.');
      router.replace('/(tabs)/dashboard');
      return;
    }

  }, [session, profile, loading, segments, rootNavigationState?.key]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string): Promise<UserProfile | null> => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;
      return data as UserProfile;
    } catch (err: any) {
      console.error('Error fetching profile:', err.message);
      return null;
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const p = await fetchProfile(user.id);
    if (p) setProfile(p);
  }, [user, fetchProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) throw error;

      if (data.session && data.user) {
        setSession(data.session);
        setUser(data.user);
        const p = await fetchProfile(data.user.id);
        setProfile(p);
      }
    } catch (err: any) {
      Alert.alert('Login Failed', err.message || 'An unexpected error occurred.');
      throw err;
    }
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setSession(null);
      setUser(null);
      setProfile(null);
    } catch (err: any) {
      Alert.alert('Sign Out Error', err.message);
    }
  }, []);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        const p = await fetchProfile(s.user.id);
        setProfile(p);
      }
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, s) => {
        setSession(s);
        setUser(s?.user ?? null);
        if (s?.user) {
          const p = await fetchProfile(s.user.id);
          setProfile(p);
        } else {
          setProfile(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  useProtectedRoute(session, profile, loading);

  return (
    <AuthContext.Provider
      value={{ session, user, profile, loading, signIn, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}
