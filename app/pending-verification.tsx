// ════════════════════════════════════════════════════════════════════════════
//  app/pending-verification.tsx — the mobile waiting room
//
//  Mobile sibling of apps/web/src/app/pending-verification/page.tsx. Shown to
//  an inspector, agency or supplier between signing up and being activated by
//  NEXPEC (migration 20260801584000). Choosing an account type at signup does
//  not confer it: the database refuses applications, job posts, contracts,
//  reports and commercial messages from a pending account outright.
//
//  The two things a pending account CAN still do — complete its profile and
//  upload verification documents — are the only actions offered here, plus a
//  route to support, which stays open precisely so someone can ask why they
//  are pending.
//
//  Every href below is a real file route: app/profile/edit.tsx,
//  app/profile/certifications.tsx and app/support-chat.tsx. The database keeps
//  the help_support conversation lane open for pending accounts on purpose.
// ════════════════════════════════════════════════════════════════════════════

import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/contexts/AuthContext';

const GATED_ROLES = ['inspector', 'agency', 'supplier'];

const ROLE_COPY: Record<
  string,
  { noun: string; profileHref: string; documentsHref: string; unlocks: string[] }
> = {
  inspector: {
    noun: 'Inspector',
    profileHref: '/profile/edit',
    documentsHref: '/profile/certifications',
    unlocks: [
      'Apply to inspection jobs',
      'Sign contracts and be dispatched to site',
      'Submit inspection reports',
      'See earnings and request payment release',
    ],
  },
  agency: {
    noun: 'Agency',
    profileHref: '/profile/edit',
    documentsHref: '/profile/certifications',
    unlocks: [
      'Post operational inspection jobs',
      'Review and select inspectors',
      'Sign contracts for your organization',
      'Access organization finance',
    ],
  },
  supplier: {
    noun: 'Supplier',
    profileHref: '/profile/edit',
    documentsHref: '/profile/certifications',
    unlocks: [
      'Respond to buyer quote requests',
      'Publish your capability catalogue',
      'Sign supply contracts',
      'Access supplier finance',
    ],
  },
};

export default function PendingVerification() {
  const { role, marketplaceActivated, signOut } = useAuth();
  const router = useRouter();

  // Approved while this screen was open, or never gated: leave immediately.
  useEffect(() => {
    if (!role) return;
    if (!GATED_ROLES.includes(role) || marketplaceActivated !== false) {
      router.replace('/');
    }
  }, [role, marketplaceActivated, router]);

  const copy = ROLE_COPY[role ?? ''] ?? {
    noun: 'Account',
    profileHref: '/profile/edit',
    documentsHref: '/profile/certifications',
    unlocks: [],
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.banner}>
          <Text style={styles.eyebrow}>VERIFICATION IN PROGRESS</Text>
          <Text style={styles.title}>
            We&apos;re reviewing your {copy.noun} account
          </Text>
          <Text style={styles.body}>
            Every {copy.noun.toLowerCase()} on NEXPEC is verified by our team
            before they can trade. Buyers rely on that, which is why a person
            does it rather than an automated check. We&apos;ll email you as soon
            as there&apos;s a decision.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>WHAT YOU CAN DO NOW</Text>
        <Pressable
          style={styles.card}
          onPress={() => router.push(copy.profileHref as never)}
        >
          <Text style={styles.cardTitle}>Complete your profile</Text>
          <Text style={styles.cardBody}>
            A complete profile is reviewed faster.
          </Text>
        </Pressable>
        <Pressable
          style={styles.card}
          onPress={() => router.push(copy.documentsHref as never)}
        >
          <Text style={styles.cardTitle}>Upload verification documents</Text>
          <Text style={styles.cardBody}>
            Certifications, insurance and registration.
          </Text>
        </Pressable>

        {copy.unlocks.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              WHAT UNLOCKS ONCE YOU&apos;RE APPROVED
            </Text>
            {copy.unlocks.map((item) => (
              <View key={item} style={styles.bulletRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.bulletText}>{item}</Text>
              </View>
            ))}
          </>
        )}

        <Pressable
          style={styles.supportBtn}
          onPress={() => router.push('/support-chat' as never)}
        >
          <Text style={styles.supportText}>Contact NEXPEC support</Text>
        </Pressable>

        <Pressable style={styles.signOutBtn} onPress={() => void signOut()}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  container: { padding: 20, paddingBottom: 48 },
  banner: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#B45309',
  },
  title: {
    marginTop: 8,
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 28,
  },
  body: { marginTop: 12, fontSize: 15, lineHeight: 22, color: '#334155' },
  sectionTitle: {
    marginTop: 28,
    marginBottom: 10,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#64748B',
  },
  card: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#0F172A' },
  cardBody: { marginTop: 4, fontSize: 13, color: '#64748B' },
  bulletRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  bullet: { color: '#94A3B8', fontSize: 15 },
  bulletText: { flex: 1, fontSize: 15, color: '#334155', lineHeight: 21 },
  supportBtn: {
    marginTop: 28,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0F172A',
    paddingVertical: 14,
    alignItems: 'center',
  },
  supportText: { fontSize: 15, fontWeight: '600', color: '#0F172A' },
  signOutBtn: { marginTop: 12, paddingVertical: 14, alignItems: 'center' },
  signOutText: { fontSize: 15, color: '#64748B' },
});
