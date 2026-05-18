// app/(admin)/users/index.tsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Super Admin CRM — Users Hub. Role-tabbed list
// with search. Flat Supabase queries only.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Image,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { SA, ago } from '@/lib/super-admin/theme';

/* ── Types ─────────────────────────────────────── */

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  avatar_url: string | null;
  phone: string | null;
  company_name: string | null;
  created_at: string;
}

type RoleFilter = 'all' | 'inspector' | 'client' | 'agency';

const ROLE_TABS: { key: RoleFilter; label: string }[] = [
  { key: 'inspector', label: 'Inspector' },
  { key: 'client', label: 'Client' },
  { key: 'agency', label: 'Agency' },
  { key: 'all', label: 'All' },
];

/* ── Helpers ───────────────────────────────────── */

const roleBadgeColor = (role: string | null): string => {
  switch (role) {
    case 'inspector':
      return SA.info;
    case 'client':
      return SA.success;
    case 'agency':
    case 'enterprise':
      return SA.accent;
    case 'admin':
      return SA.warning;
    case 'super_admin':
      return SA.danger;
    default:
      return SA.textMuted;
  }
};

const { width: SCREEN_W } = Dimensions.get('window');

/* ── Component ─────────────────────────────────── */

export default function UsersHub() {
  const router = useRouter();

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [roleFilter, setRoleFilter] = useState<RoleFilter>('inspector');
  const [search, setSearch] = useState('');

  /* ── Data Fetching ──────────────────────────── */

  const fetchUsers = useCallback(async () => {
    try {
      setError(null);

      const { data, error: queryError } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, avatar_url, phone, company_name, created_at')
        .order('created_at', { ascending: false });

      if (queryError) throw queryError;

      setProfiles((data as ProfileRow[]) ?? []);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load users');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchUsers();
  }, [fetchUsers]);

  /* ── Filtered & Searched List ───────────────── */

  const filteredProfiles = useMemo(() => {
    let list = profiles;

    // Role filter
    if (roleFilter !== 'all') {
      if (roleFilter === 'agency') {
        list = list.filter(
          (p) => p.role === 'agency' || p.role === 'enterprise'
        );
      } else {
        list = list.filter((p) => p.role === roleFilter);
      }
    }

    // Search
    const q = search.trim().toLowerCase();
    if (q.length > 0) {
      list = list.filter(
        (p) =>
          (p.full_name ?? '').toLowerCase().includes(q) ||
          (p.email ?? '').toLowerCase().includes(q) ||
          (p.company_name ?? '').toLowerCase().includes(q)
      );
    }

    return list;
  }, [profiles, roleFilter, search]);

  /* ── Role-count badge ───────────────────────── */

  const countForRole = useCallback(
    (key: RoleFilter): number => {
      if (key === 'all') return profiles.length;
      if (key === 'agency')
        return profiles.filter(
          (p) => p.role === 'agency' || p.role === 'enterprise'
        ).length;
      return profiles.filter((p) => p.role === key).length;
    },
    [profiles]
  );

  /* ── Sub-components ─────────────────────────── */

  const RoleTab = ({ tab }: { tab: (typeof ROLE_TABS)[number] }) => {
    const active = roleFilter === tab.key;
    const count = countForRole(tab.key);
    return (
      <TouchableOpacity
        style={[s.tab, active && s.tabActive]}
        onPress={() => setRoleFilter(tab.key)}
        activeOpacity={0.7}
      >
        <Text style={[s.tabLabel, active && s.tabLabelActive]}>
          {tab.label}
        </Text>
        <View
          style={[
            s.tabCount,
            {
              backgroundColor: active ? 'rgba(255,255,255,0.2)' : SA.bg,
            },
          ]}
        >
          <Text
            style={[s.tabCountText, active && { color: '#fff' }]}
          >
            {count}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderUser = ({ item }: { item: ProfileRow }) => {
    const badgeColor = roleBadgeColor(item.role);
    const initials = (item.full_name ?? '?')
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

    return (
      <TouchableOpacity
        style={s.card}
        activeOpacity={0.65}
        onPress={() =>
          router.push(`/(admin)/users/${item.id}` as any)
        }
      >
        {/* Avatar */}
        {item.avatar_url ? (
          <Image source={{ uri: item.avatar_url }} style={s.avatar} />
        ) : (
          <View style={[s.avatar, s.avatarFallback]}>
            <Text style={s.avatarInitials}>{initials}</Text>
          </View>
        )}

        {/* Info */}
        <View style={s.cardInfo}>
          <Text style={s.cardName} numberOfLines={1}>
            {item.full_name ?? 'Unnamed User'}
          </Text>
          <Text style={s.cardEmail} numberOfLines={1}>
            {item.email ?? '—'}
          </Text>
          {item.company_name ? (
            <Text style={s.cardCompany} numberOfLines={1}>
              🏢 {item.company_name}
            </Text>
          ) : null}
        </View>

        {/* Right side: role badge + chevron */}
        <View style={s.cardRight}>
          <View
            style={[
              s.roleBadge,
              { backgroundColor: badgeColor + '18', borderColor: badgeColor + '40' },
            ]}
          >
            <Text style={[s.roleBadgeText, { color: badgeColor }]}>
              {(item.role ?? 'unknown').toUpperCase()}
            </Text>
          </View>
          <Text style={s.cardTime}>{ago(item.created_at)}</Text>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={SA.textMuted}
            style={{ marginTop: 4 }}
          />
        </View>
      </TouchableOpacity>
    );
  };

  /* ── Render ─────────────────────────────────── */

  return (
    <View style={s.root}>
      {/* ── Search Bar ───────────────── */}
      <View style={s.searchWrap}>
        <Ionicons name="search" size={18} color={SA.textMuted} />
        <TextInput
          style={s.searchInput}
          placeholder="Search by name, email or company…"
          placeholderTextColor={SA.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearch('')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close-circle" size={18} color={SA.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Role Tabs ────────────────── */}
      <View style={s.tabsRow}>
        {ROLE_TABS.map((tab) => (
          <RoleTab key={tab.key} tab={tab} />
        ))}
      </View>

      {/* ── Error Banner ─────────────── */}
      {error && (
        <TouchableOpacity
          style={s.errorBanner}
          onPress={fetchUsers}
          activeOpacity={0.8}
        >
          <Ionicons name="alert-circle" size={16} color={SA.danger} />
          <Text style={s.errorText}>{error}</Text>
          <Text style={s.retryText}>Retry</Text>
        </TouchableOpacity>
      )}

      {/* ── List ─────────────────────── */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={SA.accent} />
          <Text style={[s.emptyText, { marginTop: 12 }]}>
            Loading users…
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredProfiles}
          keyExtractor={(item) => item.id}
          renderItem={renderUser}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={SA.accent}
            />
          }
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <Text style={s.resultCount}>
              {filteredProfiles.length} user
              {filteredProfiles.length !== 1 ? 's' : ''} found
            </Text>
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons
                name="people-outline"
                size={52}
                color={SA.textMuted}
              />
              <Text style={s.emptyTitle}>No users found</Text>
              <Text style={s.emptyText}>
                {search.trim()
                  ? 'Try a different search term'
                  : 'No users match this filter'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

/* ── Styles ──────────────────────────────────── */

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: SA.bg,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* Search */
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: SA.surface,
    borderRadius: SA.radiusSm,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: SA.border,
    marginBottom: 14,
  },
  searchInput: {
    flex: 1,
    color: SA.text,
    fontSize: 14,
    paddingVertical: 0,
  },

  /* Tabs */
  tabsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 22,
    backgroundColor: SA.surface,
    borderWidth: 1,
    borderColor: SA.border,
  },
  tabActive: {
    backgroundColor: SA.accent,
    borderColor: SA.accent,
  },
  tabLabel: {
    color: SA.textSec,
    fontSize: 12,
    fontWeight: '700',
  },
  tabLabelActive: {
    color: '#fff',
  },
  tabCount: {
    minWidth: 20,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  tabCountText: {
    color: SA.textMuted,
    fontSize: 10,
    fontWeight: '800',
  },

  /* Result count */
  resultCount: {
    color: SA.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
    letterSpacing: 0.3,
  },

  /* Card */
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SA.surface,
    borderRadius: SA.radius,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: SA.border,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 14,
  },
  avatarFallback: {
    backgroundColor: SA.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: SA.accent + '30',
  },
  avatarInitials: {
    color: SA.accent,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cardInfo: {
    flex: 1,
    marginRight: 10,
  },
  cardName: {
    color: SA.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  cardEmail: {
    color: SA.textSec,
    fontSize: 12,
    marginBottom: 2,
  },
  cardCompany: {
    color: SA.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  cardRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  roleBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  cardTime: {
    color: SA.textMuted,
    fontSize: 10,
    marginTop: 2,
  },

  /* Error */
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: SA.dangerSoft,
    padding: 12,
    borderRadius: SA.radiusSm,
    marginBottom: 12,
  },
  errorText: {
    color: SA.danger,
    fontSize: 13,
    flex: 1,
  },
  retryText: {
    color: SA.danger,
    fontWeight: '700',
    fontSize: 13,
  },

  /* Empty */
  empty: {
    alignItems: 'center',
    paddingVertical: 70,
    gap: 8,
  },
  emptyTitle: {
    color: SA.textSec,
    fontSize: 16,
    fontWeight: '700',
  },
  emptyText: {
    color: SA.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
});