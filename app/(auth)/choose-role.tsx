// ════════════════════════════════════════════════════════════════════════════
//  app/(auth)/choose-role.tsx
//
//  AEGIS — "Choose Your Stance" role picker.
//
//  Routed to ONLY when a freshly-authenticated user has no role on their
//  profile row (typically a first-time social sign-in). Three snap-cards
//  in a horizontal carousel: Inspector, Client, Agency. Each card carries
//  its sigil, role label, one-line pitch, and a 4-point "What you'll do"
//  preview. Tap to select (selection haptic). Confirm button writes the
//  role to profiles, success haptic, then bounces to the user's dashboard.
//
//  The post-auth router in src/lib/social-auth.ts drives users here when
//  needs_role === true. The AuthGate in app/_layout.tsx will detect the
//  filled role on next render and redirect to the appropriate dashboard.
// ════════════════════════════════════════════════════════════════════════════

import React, { useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  ArrowRight,
  Briefcase,
  Building,
  Building2,
  HardHat,
  Store,
  CheckCircle2,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import {
  aegis,
  LucentButton,
  select,
  buzzSuccess,
  buzzError,
} from '@/src/design';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W   = Math.min(SCREEN_W - 64, 320);
const CARD_GAP = 14;

// Bump when the Master ToS / Privacy Policy materially changes — a new version
// forces re-acceptance (the gate treats any stored older acceptance as valid
// for now; re-acceptance policy can key off this string later).
const TERMS_VERSION = 'v1-2026-07';

type Role = 'inspector' | 'client' | 'agency' | 'enterprise' | 'supplier';

interface RoleSpec {
  key: Role;
  title: string;
  pitch: string;
  icon: React.ComponentType<any>;
  bullets: string[];
}

const ROLES: RoleSpec[] = [
  {
    key: 'inspector',
    title: 'Inspector',
    pitch: 'Conduct verified inspections in the field',
    icon: HardHat,
    bullets: [
      'Take camera-only, GPS-anchored evidence',
      'Build a Compliance-Certified credential tier',
      'Get paid directly through NEXPEC',
      'Carry your verified jobs as portable proof',
    ],
  },
  {
    key: 'client',
    title: 'Client',
    pitch: 'Commission inspections, on your terms',
    icon: Briefcase,
    bullets: [
      'Post quality or compliance jobs in minutes',
      'Match to vetted, credentialed inspectors',
      'Approve reports with cryptographic affidavits',
      'Re-verify a supplier at any time, anywhere',
    ],
  },
  {
    key: 'agency',
    title: 'Agency',
    pitch: 'Operate a verified inspector roster at scale',
    icon: Building2,
    bullets: [
      'Manage many inspectors under one masthead',
      'Win compliance jobs your team is tier-qualified for',
      'Distribute work, track live dispatch, audit volume',
      'Issue trust certificates under your brand',
    ],
  },
  {
    key: 'enterprise',
    title: 'Enterprise',
    pitch: 'Govern inspection programs across your organization',
    icon: Building,
    bullets: [
      'Centralize compliance across teams and sites',
      'Set budgets, approval policies, and seats',
      'Standardize trust reporting org-wide',
      'Audit every engagement from one console',
    ],
  },
  {
    key: 'supplier',
    title: 'Vendor',
    pitch: 'Supply certified goods and services to the network',
    icon: Store,
    bullets: [
      'Respond to RFQs across every discipline',
      'Sign brokered supply agreements in-app',
      'Get paid on release through NEXPEC',
      'Build a verified vendor track record',
    ],
  },
];

export default function ChooseRoleScreen() {
  const router = useRouter();
  const { session, refreshOrganization, signOut } = useAuth();
  const userId: string | undefined = session?.user?.id;

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [submitting, setSubmitting]   = useState(false);
  const listRef = useRef<FlatList>(null);

  const onScrollEnd = (e: any) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const i = Math.round(offsetX / (CARD_W + CARD_GAP));
    if (i !== selectedIdx) {
      setSelectedIdx(i);
      select();
    }
  };

  const handleConfirm = async () => {
    if (!userId) {
      Alert.alert('Not signed in', 'Sign in before choosing a role.');
      return;
    }
    const role = ROLES[selectedIdx].key;
    setSubmitting(true);
    try {
      // A plain `profiles.update({ role })` runs under the user's JWT and is
      // SILENTLY filtered out by the column-level RLS lockdown on profiles.role
      // (0 rows, no error) → the social-onboarding loop. apply_onboarding_role
      // is SECURITY DEFINER: it enforces the role allow-list + the one-way
      // "no demoting an operator/inspector" guard and returns the canonical role.
      // LEGAL GATEWAY: role confirmation is the onboarding consent point.
      // Record ToS + Privacy acceptance here so no user can reach the app
      // without it (the AuthGate blocks entry until terms_accepted_at is set).
      const { data, error } = await supabase.rpc('apply_onboarding_role', {
        p_role: role,
        p_terms_accepted_at: new Date().toISOString(),
        p_terms_version: TERMS_VERSION,
      });
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      const appliedRole = (row?.applied_role ?? role) as string;

      buzzSuccess();
      // Trigger AuthContext to refetch the profile so the AuthGate routes to the
      // dashboard (AuthContext exposes refreshOrganization, which re-reads role).
      await refreshOrganization();
      // Belt-and-braces: also push directly to the applied role's home. The
      // AuthGate will allow this. Route on the SERVER-confirmed role, not the
      // tapped one, in case the one-way guard kept a protected role.
      switch (appliedRole) {
        case 'inspector':  router.replace('/(tabs)' as any); break;
        case 'client':     router.replace('/(tabs)/client-dashboard' as any); break;
        case 'agency':     router.replace('/(tabs)/agency-dashboard' as any); break;
        case 'enterprise': router.replace('/(tabs)/enterprise-dashboard' as any); break;
        case 'supplier':   router.replace('/(tabs)/supplier-dashboard' as any); break;
        default:           router.replace('/(tabs)' as any); break;
      }
    } catch (e: any) {
      buzzError();
      Alert.alert('Could not save role', e?.message ?? 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={s.bg} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.hero}>
        {/* Official app logo (assets/images/logo.png) — same mark used on
            sign-in / sign-up / splash. Replaces the AegisLogo sigil so
            onboarding matches the rest of the platform. */}
        <Image
          source={require('../../assets/images/logo.png')}
          style={s.heroLogo}
          resizeMode="contain"
        />
        <Text style={s.heroEyebrow}>WELCOME TO NEXPEC</Text>
        <Text style={s.heroTitle}>Choose your stance</Text>
        <Text style={s.heroSub}>
          You can change this later. For now, pick the lane that best matches how you'll use NEXPEC.
        </Text>
        {/* Informed-consent notice — confirming a role records ToS + Privacy
            acceptance (legal gateway). Links open the existing legal screens. */}
        <Text style={s.heroSub}>
          By continuing, you agree to our{' '}
          <Text style={s.heroLink} onPress={() => router.push('/profile/terms' as any)}>Terms of Service</Text>
          {' '}and{' '}
          <Text style={s.heroLink} onPress={() => router.push('/profile/legal' as any)}>Privacy Policy</Text>.
        </Text>
      </View>

      <FlatList
        ref={listRef}
        data={ROLES}
        keyExtractor={(r) => r.key}
        horizontal
        pagingEnabled={false}
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_W + CARD_GAP}
        decelerationRate="fast"
        contentContainerStyle={{
          paddingHorizontal: (SCREEN_W - CARD_W) / 2,
          gap: CARD_GAP,
        }}
        onMomentumScrollEnd={onScrollEnd}
        renderItem={({ item, index }) => {
          const Icon = item.icon;
          const on = index === selectedIdx;
          return (
            <Pressable
              onPress={() => {
                select();
                setSelectedIdx(index);
                listRef.current?.scrollToOffset({ offset: index * (CARD_W + CARD_GAP), animated: true });
              }}
              style={[s.card, on && s.cardOn]}
            >
              {/* Top hairline */}
              <View pointerEvents="none" style={s.cardHairline} />

              {on && (
                <View style={s.checkBadge}>
                  <CheckCircle2 size={14} color="#FFFFFF" />
                </View>
              )}

              <View style={s.iconWell}>
                <Icon size={36} color={on ? aegis.palette.irisSoft : aegis.palette.inkDim} strokeWidth={1.5} />
              </View>

              <Text style={s.cardTitle}>{item.title}</Text>
              <Text style={s.cardPitch}>{item.pitch}</Text>

              <View style={s.bulletList}>
                {item.bullets.map((b: any, i: number) => (
                  <View key={i} style={s.bulletRow}>
                    <View style={s.bulletDot} />
                    <Text style={s.bulletText}>{b}</Text>
                  </View>
                ))}
              </View>
            </Pressable>
          );
        }}
      />

      {/* Index dots */}
      <View style={s.dotsRow}>
        {ROLES.map((_, i) => (
          <View
            key={i}
            style={[s.dot, i === selectedIdx && s.dotOn]}
          />
        ))}
      </View>

      <View style={s.cta}>
        <LucentButton
          variant="primary"
          label={`Continue as ${ROLES[selectedIdx].title}`}
          trailingIcon={<ArrowRight size={16} color="#FFFFFF" strokeWidth={2.5} />}
          onPress={handleConfirm}
          loading={submitting}
        />
        {/* Escape hatch — never trap the user here if role-save fails.
            signOut() clears the session; the AuthGate then routes to sign-in. */}
        <Pressable
          onPress={() => signOut()}
          disabled={submitting}
          hitSlop={12}
          style={s.signOutBtn}
        >
          <Text style={s.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: aegis.palette.void },

  hero: {
    alignItems: 'center',
    paddingHorizontal: aegis.space.xl,
    paddingTop: aegis.space.lg,
    paddingBottom: aegis.space.xl,
    gap: 8,
  },
  heroEyebrow: {
    ...aegis.type.captionSm,
    color: aegis.palette.irisSoft,
    marginTop: 8,
  },
  heroTitle: {
    ...aegis.type.d2,
    color: aegis.palette.ink,
    textAlign: 'center',
  },
  heroSub: {
    color: aegis.palette.inkDim,
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 340,
    lineHeight: 19,
  },
  heroLink: {
    color: aegis.palette.iris,
    fontWeight: '600',
  },
  heroLogo: {
    width: 96,
    height: 96,
    marginBottom: 4,
  },

  card: {
    width: CARD_W,
    backgroundColor: aegis.palette.aether,
    borderColor: aegis.palette.mistHi,
    borderWidth: 1,
    borderRadius: aegis.radius.xl,
    padding: 18,
    gap: 8,
    overflow: 'hidden',
    ...aegis.elevation.aether,
  },
  cardOn: {
    backgroundColor: aegis.palette.mist,
    borderColor: aegis.palette.iris,
    ...aegis.elevation.halo,
  },
  cardHairline: {
    position: 'absolute', top: 0, left: 18, right: 18, height: 1,
    backgroundColor: aegis.palette.irisEdge,
  },
  checkBadge: {
    position: 'absolute',
    top: 12, right: 12,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: aegis.palette.iris,
    justifyContent: 'center', alignItems: 'center',
  },
  iconWell: {
    width: 56, height: 56, borderRadius: 14,
    backgroundColor: aegis.palette.irisDim,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 6,
  },
  cardTitle: {
    ...aegis.type.h1,
    color: aegis.palette.ink,
  },
  cardPitch: {
    color: aegis.palette.inkSec,
    fontSize: 13,
    lineHeight: 18,
  },
  bulletList: { marginTop: 10, gap: 8 },
  bulletRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bulletDot:  { width: 5, height: 5, borderRadius: 3, backgroundColor: aegis.palette.irisSoft, marginTop: 7 },
  bulletText: { flex: 1, color: aegis.palette.inkSec, fontSize: 12, lineHeight: 17 },

  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: aegis.space.lg,
  },
  dot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: aegis.palette.mistHi,
  },
  dotOn: { backgroundColor: aegis.palette.irisSoft, width: 18 },

  cta: {
    paddingHorizontal: aegis.space.xl,
    paddingBottom: aegis.space.xl,
  },
  signOutBtn: {
    alignSelf: 'center',
    marginTop: 14,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  signOutText: {
    color: aegis.palette.inkDim,
    fontSize: 14,
    fontWeight: '600',
  },
});
