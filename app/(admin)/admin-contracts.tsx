import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { SA, ago } from '@/lib/super-admin/theme';

export default function AdminContracts() {
  const router = useRouter();
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchContracts = useCallback(async () => {
    try {
      console.log('🔍 Fetching contracts from database...');

      // ★ Diagnostic: log who we are and whether the super-admin policy
      //   can see us. If `am_i_super_admin` comes back false, the RLS
      //   helper rejects every row even though the policy is installed.
      try {
        const { data: meRow } = await supabase.auth.getUser();
        const myId = meRow?.user?.id;
        if (myId) {
          const { data: profRow } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', myId)
            .maybeSingle();
          console.log('🪪 admin-contracts user', { myId, role: profRow?.role });
        }
      } catch (probeErr) {
        console.warn('admin-contracts probe failed', probeErr);
      }

      // ✅ STEP 1: Fetch all contracts
      const { data: contractsData, error: contractsError } = await supabase
        .from('contracts')
        .select('*')
        .order('created_at', { ascending: false });

      if (contractsError) {
        console.error('❌ Contracts fetch error:', contractsError);
        throw contractsError;
      }

      console.log(`✅ Fetched ${contractsData?.length || 0} contracts`);
      // ★ When the array is empty, surface a hint pointing the developer
      //   at the most likely cause (RLS) so we don't have to guess again.
      if ((contractsData?.length ?? 0) === 0) {
        console.log(
          '⚠️ contracts query returned 0 rows. If the inspector can see ' +
          'their own contracts, the table is NOT empty, your profile.role ' +
          'is probably not in (admin, super_admin, support). Check the ' +
          'previous log line.'
        );
      }

      // ✅ STEP 2: Get unique inspector IDs and fetch their profiles.
      // ★ The `contracts` table has only ONE inspector-pointing column —
      //   `contractor_id`. There is NO `inspector_id` and NO `worker_id`
      //   on this schema, so we resolve profiles via contractor_id only.
      const inspectorIds = [...new Set(
        (contractsData || [])
          .map(c => c.contractor_id)
          .filter(Boolean)
      )];
      
      let profilesMap: Record<string, any> = {};

      if (inspectorIds.length > 0) {
        console.log('🔍 Fetching inspector profiles for IDs:', inspectorIds);
        
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, full_name, email')
          .in('id', inspectorIds);

        if (profilesError) {
          console.error('⚠️ Profiles fetch error:', profilesError);
        } else {
          profilesData?.forEach(p => { 
            profilesMap[p.id] = p; 
          });
          console.log(`✅ Fetched ${profilesData?.length || 0} inspector profiles`);
        }
      }

      // ✅ STEP 3: Get unique job IDs and fetch their titles
      // 🔧 FIX: Changed from project_id to job_id
      const jobIds = [...new Set(
        (contractsData || [])
          .map(c => c.job_id)
          .filter(Boolean)
      )];
      
      let jobsMap: Record<string, string> = {};

      if (jobIds.length > 0) {
        console.log('🔍 Fetching job titles for IDs:', jobIds);
        
        const { data: jobsData, error: jobsError } = await supabase
          .from('jobs')
          .select('id, title')
          .in('id', jobIds);

        if (jobsError) {
          console.error('⚠️ Jobs fetch error:', jobsError);
        } else {
          jobsData?.forEach(j => { 
            jobsMap[j.id] = j.title; 
          });
          console.log(`✅ Fetched ${jobsData?.length || 0} job titles`);
        }
      }

      // ✅ STEP 4: Map all data together
      const formattedContracts = (contractsData || []).map(c => {
        // 🔧 FIX: Use job_id instead of project_id
        const jobTitle = jobsMap[c.job_id] || 'Unknown Job';
        
        // ★ Resolve inspector profile via contractor_id (the only inspector
        //   column on this schema). Falls through full_name → first/last →
        //   contractor_signature (the name the inspector typed at sign time)
        //   → email → "Unknown Inspector". The previous resolver only
        //   checked first_name/last_name, which were null on the test
        //   profile even though full_name was populated.
        const profile = (c.contractor_id && profilesMap[c.contractor_id]) || {};
        const inspectorName =
          (profile.full_name && profile.full_name.trim()) ||
          `${profile.first_name || ''} ${profile.last_name || ''}`.trim() ||
          (c.contractor_signature && String(c.contractor_signature).trim()) ||
          (profile.email && profile.email.trim()) ||
          'Unknown Inspector';
        
        return { 
          ...c, 
          jobTitle, 
          inspectorName,
          inspectorEmail: profile.email || 'N/A'
        };
      });

      console.log('✅ Contracts formatted successfully');
      setContracts(formattedContracts);
      
    } catch (err: any) {
      console.error('❌ Fetch contracts error:', err);
      Alert.alert('Fetch Error', err.message || 'Failed to load contracts.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchContracts();
  }, [fetchContracts]);

  const renderContract = ({ item }: { item: any }) => {
    const isSigned = item.status === 'signed';

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        // ★ Card is now tappable — opens the contract detail page where
        //   admin can review the full agreement, signatures, dates, and
        //   the attached document if any.
        onPress={() => router.push(`/contracts/${item.id}` as any)}
        style={s.card}
      >
        <View style={s.cardHeader}>
          <View style={[s.iconBox, { backgroundColor: isSigned ? SA.success + '20' : SA.warning + '20' }]}>
            <Ionicons 
              name={isSigned ? "checkmark-circle" : "document-text"} 
              size={24} 
              color={isSigned ? SA.success : SA.warning} 
            />
          </View>
          <View style={s.headerInfo}>
            <Text style={s.jobTitle} numberOfLines={1}>{item.jobTitle}</Text>
            <Text style={s.date}>{item.created_at ? ago(item.created_at) : 'Just now'}</Text>
          </View>
          <View style={[s.badge, { backgroundColor: isSigned ? SA.success + '20' : SA.warning + '20' }]}>
            <Text style={[s.badgeText, { color: isSigned ? SA.success : SA.warning }]}>
              {isSigned ? 'SIGNED' : 'DRAFT'}
            </Text>
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.row}>
          <Text style={s.label}>Inspector:</Text>
          <Text style={s.value} numberOfLines={1}>{item.inspectorName}</Text>
        </View>

        <View style={s.row}>
          <Text style={s.label}>Contract #:</Text>
          {/* ★ Derive a readable reference from the row id since the schema
                does not have a dedicated contract_number column. Falls back
                to the legacy column if present (older rows). */}
          <Text style={s.value} numberOfLines={1}>
            {item.contract_number ||
              (item.id ? `NXP-${String(item.id).slice(0, 8).toUpperCase()}` : 'N/A')}
          </Text>
        </View>

        <View style={s.row}>
          <Text style={s.label}>Total Amount:</Text>
          {/* ★ Task 4: column renamed total_amount → total_amount_cents (bigint cents) */}
          <Text style={s.value}>${item.total_amount_cents ? (Number(item.total_amount_cents) / 100).toLocaleString() : '0.00'}</Text>
        </View>

        {item.signed_at && (
          <View style={s.row}>
            <Text style={s.label}>Signed:</Text>
            <Text style={s.value}>{ago(item.signed_at)}</Text>
          </View>
        )}

        {/* ★ Real column is `document_url` (not `pdf_url`). Falls back to
              external_link for legacy rows. Empty / placeholder values
              are filtered out so we don't show a useless button when the
              inspector signed digitally without uploading a file. */}
        {(item.document_url || item.external_link) &&
          item.document_url !== 'digital_signature' &&
          item.document_url !== 'https://nexpec.com/digital-signature' && (
          <TouchableOpacity
            style={s.pdfButton}
            onPress={(e) => {
              // Prevent the parent card press from firing when the user
              // explicitly taps the inner PDF button.
              e.stopPropagation();
              const url = item.document_url || item.external_link;
              Alert.alert('Contract File', `URL: ${url}`);
            }}
          >
            <Ionicons name="document-text" size={16} color={SA.accent} />
            <Text style={s.pdfButtonText}>View Contract PDF</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator size="large" color={SA.accent} />
        <Text style={{ color: SA.textMuted, marginTop: 16 }}>Loading contracts...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={24} color={SA.text} />
        </TouchableOpacity>
        <Text style={s.title}>Legal & Contracts</Text>
        <TouchableOpacity onPress={() => fetchContracts()} style={s.refreshBtn}>
          <Ionicons name="refresh" size={20} color={SA.text} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={contracts}
        keyExtractor={(item) => item.id || Math.random().toString()}
        renderItem={renderContract}
        contentContainerStyle={s.listContent}
        refreshing={refreshing}
        onRefresh={() => { 
          setRefreshing(true); 
          fetchContracts(); 
        }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="folder-open-outline" size={48} color={SA.textMuted} />
            <Text style={s.emptyText}>No contracts generated yet.</Text>
            <Text style={s.emptySubtext}>Contracts will appear here when inspectors sign job agreements.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: SA.bg },
  center: { flex: 1, backgroundColor: SA.bg, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: SA.border },
  backBtn: { padding: 8 },
  refreshBtn: { padding: 8 },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: 'bold', color: SA.text },
  listContent: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: SA.surface, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: SA.border },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  iconBox: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  headerInfo: { flex: 1 },
  jobTitle: { fontSize: 16, fontWeight: 'bold', color: SA.text, marginBottom: 4 },
  date: { fontSize: 12, color: SA.textMuted },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 10, fontWeight: 'bold' },
  divider: { height: 1, backgroundColor: SA.border, marginVertical: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' },
  label: { color: SA.textSec, fontSize: 14, flex: 1 },
  value: { color: SA.text, fontSize: 14, fontWeight: '600', flex: 1, textAlign: 'right' },
  pdfButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: SA.accent + '15',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: SA.accent + '30'
  },
  pdfButtonText: { 
    color: SA.accent, 
    fontSize: 13, 
    fontWeight: '600',
    marginLeft: 6
  },
  empty: { alignItems: 'center', marginTop: 100 },
  emptyText: { color: SA.textMuted, marginTop: 16, fontSize: 16, fontWeight: '600' },
  emptySubtext: { color: SA.textMuted, marginTop: 8, fontSize: 13, textAlign: 'center', paddingHorizontal: 40 },
});