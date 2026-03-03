// src/components/inspector/growth/ReferralProgram.tsx
import React, { useRef, useCallback, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  Animated,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const REWARD_PER_REFERRAL = 50;

const MILESTONE_DEFINITIONS = [
  { count: 1, reward: '$25' },
  { count: 3, reward: '$150' },
  { count: 5, reward: '$300' },
  { count: 10, reward: '$750' },
];

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
const ReferralProgram: React.FC = () => {
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [referralCode, setReferralCode] = useState('');
  const [referralStats, setReferralStats] = useState({
    friendsInvited: 0,
    pendingAmount: 0,
    totalEarned: 0,
    conversionRate: 0,
  });

  const milestones = MILESTONE_DEFINITIONS.map((m) => ({
    ...m,
    reached: referralStats.friendsInvited >= m.count,
  }));

  const shareMessage = referralCode
    ? `Join NEXPEC using my code ${referralCode} and get verified instantly! 🚀`
    : '';
  const shareUrl = referralCode
    ? `https://nexpec.app/invite/${referralCode}`
    : '';

  useEffect(() => {
    if (!userId) return;

    const fetchReferralData = async () => {
      try {
        // Fetch referral code from profiles table
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('referral_code')
          .eq('id', userId)
          .single();

        if (profileError) {
          console.error('Error fetching referral code:', profileError);
        } else if (profile?.referral_code) {
          setReferralCode(profile.referral_code);
        }

        // Count total friends invited
        const { count: totalInvited, error: invitedError } = await supabase
          .from('referrals')
          .select('*', { count: 'exact', head: true })
          .eq('referrer_id', userId);

        if (invitedError) {
          console.error('Error counting referrals:', invitedError);
        }

        const friendsInvited = totalInvited ?? 0;

        // Count completed referrals
        const { count: completedCount, error: completedError } = await supabase
          .from('referrals')
          .select('*', { count: 'exact', head: true })
          .eq('referrer_id', userId)
          .eq('status', 'completed');

        if (completedError) {
          console.error('Error counting completed referrals:', completedError);
        }

        const completed = completedCount ?? 0;

        // Count pending referrals
        const { count: pendingCount, error: pendingError } = await supabase
          .from('referrals')
          .select('*', { count: 'exact', head: true })
          .eq('referrer_id', userId)
          .eq('status', 'pending');

        if (pendingError) {
          console.error('Error counting pending referrals:', pendingError);
        }

        const pending = pendingCount ?? 0;

        const totalEarned = completed * REWARD_PER_REFERRAL;
        const pendingAmount = pending * REWARD_PER_REFERRAL;
        const conversionRate =
          friendsInvited > 0
            ? Math.round((completed / friendsInvited) * 100)
            : 0;

        setReferralStats({
          friendsInvited,
          pendingAmount,
          totalEarned,
          conversionRate,
        });
      } catch (error) {
        console.error('Error fetching referral data:', error);
      }
    };

    fetchReferralData();
  }, [userId]);

  const shareButtonScale = useRef(new Animated.Value(1)).current;
  const copyFlash = useRef(new Animated.Value(0)).current;

  // ── Share Handler ──
  const handleShare = useCallback(async () => {
    // Button press animation
    Animated.sequence([
      Animated.timing(shareButtonScale, {
        toValue: 0.93,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.spring(shareButtonScale, {
        toValue: 1,
        tension: 300,
        friction: 10,
        useNativeDriver: true,
      }),
    ]).start();

    try {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch {}

    try {
      const result = await Share.share({
        message: shareMessage,
        url: shareUrl, // iOS only — Android includes in message
        title: 'Join NEXPEC',
      });

      if (result.action === Share.sharedAction) {
        // Could track analytics here
      }
    } catch (error: any) {
      Alert.alert('Share Failed', error.message);
    }
  }, [shareMessage, shareUrl]);

  // ── Copy Code Handler ──
  const handleCopyCode = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(referralCode);

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      // Flash animation
      Animated.sequence([
        Animated.timing(copyFlash, {
          toValue: 1,
          duration: 150,
          useNativeDriver: false,
        }),
        Animated.timing(copyFlash, {
          toValue: 0,
          duration: 800,
          useNativeDriver: false,
        }),
      ]).start();
    } catch {
      Alert.alert('Copied!', `Code: ${referralCode}`);
    }
  }, [referralCode]);

  const copyBgColor = copyFlash.interpolate({
    inputRange: [0, 1],
    outputRange: ['#1E293B', '#065F4620'],
  });

  return (
    <View style={styles.container}>
      {/* ── Decorative Top Accent Line ── */}
      <LinearGradient
        colors={['#06B6D4', '#F59E0B', '#06B6D4']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.topAccent}
      />

      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <LinearGradient
            colors={['#06B6D4', '#0891B2']}
            style={styles.headerIconBg}
          >
            <Ionicons name="people" size={16} color="#020617" />
          </LinearGradient>
          <View>
            <Text style={styles.headerTitle}>Referral Program</Text>
            <Text style={styles.headerSubtitle}>
              Earn rewards for every friend
            </Text>
          </View>
        </View>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      {/* ── Referral Code Card ── */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={handleCopyCode}
        style={styles.codeCardTouchable}
      >
        <Animated.View
          style={[styles.codeCard, { backgroundColor: copyBgColor }]}
        >
          <View style={styles.codeLeft}>
            <Text style={styles.codeLabel}>YOUR CODE</Text>
            <View style={styles.codeRow}>
              <Text style={styles.codeText}>{referralCode || '---'}</Text>
              <View style={styles.codeDivider} />
              <Ionicons name="copy-outline" size={18} color="#06B6D4" />
            </View>
          </View>
          <View style={styles.tapHint}>
            <Text style={styles.tapHintText}>Tap to copy</Text>
          </View>
        </Animated.View>
      </TouchableOpacity>

      {/* ── Stats Row ── */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <View style={[styles.statIconBg, { backgroundColor: '#06B6D420' }]}>
            <Ionicons name="person-add" size={16} color="#06B6D4" />
          </View>
          <Text style={styles.statValue}>
            {referralStats.friendsInvited}
          </Text>
          <Text style={styles.statLabel}>Friends Invited</Text>
        </View>

        <View style={styles.statDivider} />

        <View style={styles.statItem}>
          <View style={[styles.statIconBg, { backgroundColor: '#F59E0B20' }]}>
            <Ionicons name="time" size={16} color="#F59E0B" />
          </View>
          <Text style={[styles.statValue, { color: '#F59E0B' }]}>
            ${referralStats.pendingAmount}
          </Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>

        <View style={styles.statDivider} />

        <View style={styles.statItem}>
          <View style={[styles.statIconBg, { backgroundColor: '#10B98120' }]}>
            <Ionicons name="checkmark-circle" size={16} color="#10B981" />
          </View>
          <Text style={[styles.statValue, { color: '#10B981' }]}>
            ${referralStats.totalEarned}
          </Text>
          <Text style={styles.statLabel}>Total Earned</Text>
        </View>
      </View>

      {/* ── Milestone Tracker ── */}
      <View style={styles.milestoneSection}>
        <Text style={styles.milestoneTitle}>Milestones</Text>
        <View style={styles.milestoneTrack}>
          {milestones.map((milestone, index) => (
            <View key={milestone.count} style={styles.milestoneItem}>
              {/* Connector line */}
              {index > 0 && (
                <View
                  style={[
                    styles.milestoneLine,
                    milestone.reached && styles.milestoneLineActive,
                  ]}
                />
              )}
              {/* Dot */}
              <View
                style={[
                  styles.milestoneDot,
                  milestone.reached && styles.milestoneDotActive,
                ]}
              >
                {milestone.reached ? (
                  <Ionicons name="checkmark" size={10} color="#020617" />
                ) : (
                  <Text style={styles.milestoneDotText}>
                    {milestone.count}
                  </Text>
                )}
              </View>
              {/* Label */}
              <Text
                style={[
                  styles.milestoneLabel,
                  milestone.reached && styles.milestoneLabelActive,
                ]}
              >
                {milestone.reward}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Share Button ── */}
      <Animated.View
        style={[
          styles.shareButtonWrapper,
          { transform: [{ scale: shareButtonScale }] },
        ]}
      >
        <TouchableOpacity activeOpacity={0.85} onPress={handleShare}>
          <LinearGradient
            colors={['#06B6D4', '#0891B2']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.shareButton}
          >
            <Ionicons
              name="share-social"
              size={20}
              color="#020617"
              style={{ marginRight: 8 }}
            />
            <Text style={styles.shareButtonText}>Share Invite</Text>
            <View style={styles.shareArrow}>
              <Ionicons name="arrow-forward" size={16} color="#06B6D4" />
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>

      {/* ── Footer Note ── */}
      <View style={styles.footer}>
        <Ionicons name="information-circle-outline" size={14} color="#475569" />
        <Text style={styles.footerText}>
          Rewards credited after referee's first completed inspection
        </Text>
      </View>
    </View>
  );
};

// ─────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    backgroundColor: '#0F172A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    overflow: 'hidden',
    // Card shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  topAccent: {
    height: 3,
    width: '100%',
  },
  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconBg: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F1F5F9',
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B98115',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 5,
    borderWidth: 1,
    borderColor: '#10B98130',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  liveText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#10B981',
    letterSpacing: 1,
  },
  // ── Code Card ──
  codeCardTouchable: {
    marginHorizontal: 18,
    marginBottom: 16,
  },
  codeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderStyle: 'dashed',
  },
  codeLeft: {
    flex: 1,
  },
  codeLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  codeText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#06B6D4',
    letterSpacing: 3,
    fontVariant: ['tabular-nums'],
  },
  codeDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#334155',
  },
  tapHint: {
    backgroundColor: '#06B6D410',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tapHintText: {
    fontSize: 10,
    color: '#06B6D4',
    fontWeight: '500',
  },
  // ── Stats ──
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 18,
    marginBottom: 16,
    backgroundColor: '#020617',
    borderRadius: 14,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statIconBg: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#06B6D4',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#1E293B',
  },
  // ── Milestones ──
  milestoneSection: {
    marginHorizontal: 18,
    marginBottom: 18,
  },
  milestoneTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  milestoneTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  milestoneItem: {
    alignItems: 'center',
    flex: 1,
    position: 'relative',
  },
  milestoneLine: {
    position: 'absolute',
    top: 12,
    right: '50%',
    left: -20,
    height: 2,
    backgroundColor: '#1E293B',
    zIndex: -1,
  },
  milestoneLineActive: {
    backgroundColor: '#06B6D4',
  },
  milestoneDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#1E293B',
    borderWidth: 2,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  milestoneDotActive: {
    backgroundColor: '#06B6D4',
    borderColor: '#06B6D4',
  },
  milestoneDotText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
  },
  milestoneLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  milestoneLabelActive: {
    color: '#06B6D4',
  },
  // ── Share Button ──
  shareButtonWrapper: {
    marginHorizontal: 18,
    marginBottom: 14,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 15,
    position: 'relative',
  },
  shareButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#020617',
    letterSpacing: 0.3,
  },
  shareArrow: {
    position: 'absolute',
    right: 16,
    backgroundColor: '#02061730',
    borderRadius: 10,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Footer ──
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: 16,
    paddingHorizontal: 18,
  },
  footerText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '400',
  },
});

export default ReferralProgram;