import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import PdfViewer from '../../src/components/PdfViewer';

// Match your app's theme colors
const COLORS = {
  background: '#020420',
  card: '#1e293b',
  border: '#334155',
  primary: '#7C3AED', // Purple to match your branding
  text: '#FFFFFF',
  textDim: '#9CA3AF',
  success: '#10B981',
  warning: '#F59E0B',
};

export default function ContractDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [contract, setContract] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [showPdf, setShowPdf] = useState(false);

  useEffect(() => {
    if (id) fetchContractDetails();
  }, [id]);

  const fetchContractDetails = async () => {
    try {
      setLoading(true);

      // ★ Guard against non-UUID route params (e.g. '/contracts/history').
      //   expo-router silently routes any unknown segment into [id], so
      //   without this guard we'd hit Postgres with `id = 'history'` and
      //   get a 22P02 invalid-uuid error. Bouncing back is friendlier.
      const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      // Accept either a raw UUID or the Hub's `jc:<uuid>` prefix form.
      const rawId = String(id ?? '').replace(/^jc:/, '');
      if (!rawId || !UUID_RX.test(rawId)) {
        Alert.alert('Not found', 'No contract matches that link.');
        router.back();
        return;
      }

      // ── V3 CUTOVER GUARDRAIL ─────────────────────────────────────────
      //   The legacy V1 contracts table is decommissioned for active
      //   workflows. Before showing this archive viewer, check whether
      //   the id maps to a V3 row (or whether the job referenced by a
      //   legacy row has a V3 counterpart) and redirect to the V3
      //   signing surface instead. This ensures any direct deep link
      //   into the old viewer surfaces the canonical contract.
      //
      //   Strategy:
      //     a) If the id itself exists in inspector_job_contracts_view OR
      //        client_job_contracts_view → it IS a V3 contract id.
      //        Redirect to /contracts/job/jc:<id>.
      //     b) Else, find the legacy row's job_id and check whether a
      //        V3 contract exists for that job. If yes → redirect.
      //     c) Else, render this archive view as before (read-only).
      try {
        const v3DirectInsp = await supabase
          .from('inspector_job_contracts_view')
          .select('id')
          .eq('id', rawId)
          .maybeSingle();
        if (v3DirectInsp.data?.id) {
          router.replace(`/contracts/job/jc:${v3DirectInsp.data.id}` as any);
          return;
        }
        const v3DirectClient = await supabase
          .from('client_job_contracts_view')
          .select('id')
          .eq('id', rawId)
          .maybeSingle();
        if (v3DirectClient.data?.id) {
          router.replace(`/contracts/job/jc:${v3DirectClient.data.id}` as any);
          return;
        }
        // Look up the legacy row's job_id to check for a V3 counterpart.
        const legacyPeek = await supabase
          .from('contracts')
          .select('job_id, deleted_at')
          .eq('id', rawId)
          .maybeSingle();
        const legacyJobId = legacyPeek.data?.job_id ?? null;
        if (legacyJobId) {
          const v3ForJobInsp = await supabase
            .from('inspector_job_contracts_view')
            .select('id')
            .eq('job_id', legacyJobId)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (v3ForJobInsp.data?.id) {
            router.replace(`/contracts/job/jc:${v3ForJobInsp.data.id}` as any);
            return;
          }
          const v3ForJobClient = await supabase
            .from('client_job_contracts_view')
            .select('id')
            .eq('job_id', legacyJobId)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (v3ForJobClient.data?.id) {
            router.replace(`/contracts/job/jc:${v3ForJobClient.data.id}` as any);
            return;
          }
        }
        // No V3 counterpart found — fall through to the read-only
        // archive viewer below (the legacy row, if it exists, is shown
        // for audit-history purposes only).
      } catch {
        // Resolver lookup is best-effort. If it errors, fall through to
        // the legacy viewer rather than block the user.
      }

      // ★ Manual 3-step fetch — replaces the embedded `jobs:job_id (...)`
      //   select that PostgREST was rejecting with PGRST200 ("Could not
      //   find a relationship between 'contracts' and 'jobs' in the
      //   schema cache"). Same pattern we use elsewhere.
      //
      //   Uses `rawId` so the Hub's `jc:` prefix is correctly stripped.
      //   Skips soft-deleted legacy rows so superseded duplicates don't
      //   surface in this archive viewer.
      const { data: contractData, error } = await supabase
        .from('contracts')
        .select('*')
        .eq('id', rawId)
        .is('deleted_at', null)
        .maybeSingle();

      if (error) throw error;
      if (!contractData) {
        Alert.alert('Not found', 'This contract no longer exists.');
        router.back();
        return;
      }

      // Pull job and client profile in parallel (both optional).
      //
      // ★ The profiles table does NOT have a `company_name` column (verified
      //   against the migration history). Querying it causes PostgREST to
      //   42703, the catch block below calls router.back(), and the user
      //   gets kicked out of the screen. Use `full_name` only — and surface
      //   it through a friendly fallback if missing.
      const [{ data: jobRow }, clientPromise] = await Promise.all([
        contractData.job_id
          ? supabase
              .from('jobs')
              .select('id, title, location, client_id')
              .eq('id', contractData.job_id)
              .maybeSingle()
          : Promise.resolve({ data: null } as any),
        contractData.client_id
          ? supabase
              .from('profiles')
              .select('full_name, email')
              .eq('id', contractData.client_id)
              .maybeSingle()
          : Promise.resolve({ data: null } as any),
      ]);
      const profile = (await clientPromise)?.data ?? null;

      const clientName =
        profile?.full_name || profile?.email || 'Private Client';

      setContract({
        ...contractData,
        jobs: jobRow ?? null,
        client_name: clientName,
      });
    } catch (err: any) {
      console.error('[contracts/[id]] fetch error →', err);
      Alert.alert('Error', err?.message ?? 'Failed to load contract');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  const handleSign = async () => {
    Alert.alert('Sign Contract', 'Confirm your digital signature?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Now',
        onPress: async () => {
          setSigning(true);
          const { error } = await supabase
            .from('contracts')
            .update({ status: 'signed', signed_at: new Date().toISOString() })
            .eq('id', id);

          if (!error) {
            setContract({ ...contract, status: 'signed', signed_at: new Date().toISOString() });
            Alert.alert('Success', 'Contract Signed Successfully!');
          }
          setSigning(false);
        }
      }
    ]);
  };

  if (loading) return (
    <SafeAreaView style={styles.container}>
      <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Contract Agreement</Text>
        <View style={{width: 40}} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Status Banner */}
        <View style={[styles.statusCard, { borderColor: contract.status === 'signed' ? COLORS.success : COLORS.warning }]}>
          <Ionicons name={contract.status === 'signed' ? "checkmark-circle" : "time"} size={24} color={contract.status === 'signed' ? COLORS.success : COLORS.warning} />
          <Text style={[styles.statusText, { color: contract.status === 'signed' ? COLORS.success : COLORS.warning }]}>
            Status: {contract.status.toUpperCase()}
          </Text>
        </View>

        {/* Details Card */}
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Client:</Text>
            <Text style={styles.value}>{contract.client_name}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>Project:</Text>
            <Text style={styles.value}>{contract.jobs?.title}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>Location:</Text>
            <Text style={styles.value}>{contract.jobs?.location}</Text>
          </View>
        </View>

        {/* Contract Text */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Terms & Conditions</Text>
          <Text style={styles.contractText}>
            {contract.contract_text || "1. Services: The Inspector agrees to perform the services described...\n\n2. Payment: Payment will be released upon approval...\n\n3. Confidentiality: All data remains the property of the client..."}
          </Text>
        </View>

        {/* PDF Viewer */}
        {contract.pdf_file_name && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Contract PDF</Text>
            <TouchableOpacity 
              style={styles.pdfToggleBtn} 
              onPress={() => setShowPdf(!showPdf)}
            >
              <Ionicons name={showPdf ? "document-text-outline" : "document-text-outline"} size={20} color="#FFF" />
              <Text style={styles.pdfToggleText}>
                {showPdf ? "Hide PDF" : "View PDF Contract"}
              </Text>
              <Ionicons name={showPdf ? "chevron-up" : "chevron-down"} size={20} color="#FFF" />
            </TouchableOpacity>
            
            {showPdf && (
              <View style={styles.pdfContainer}>
                <PdfViewer uri={contract.pdf_file_name} />
              </View>
            )}
            
            {/* Full Screen PDF View Button */}
            <TouchableOpacity 
              style={styles.fullScreenBtn} 
              onPress={() => {
                // Get the public URL for the PDF
                const { data: publicUrlData } = supabase.storage
                  .from('contracts')
                  .getPublicUrl(contract.pdf_file_name);
                
                router.push({
                  pathname: '/contracts/view',
                  params: {
                    pdfUrl: publicUrlData.publicUrl,
                    contractNumber: contract.jobs?.title || 'Contract'
                  }
                });
              }}
            >
              <Ionicons name="expand" size={20} color="#FFF" />
              <Text style={styles.fullScreenText}>Full Screen View</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Signature Box */}
        {contract.status === 'signed' ? (
          <View style={styles.signedBox}>
            <Ionicons name="ribbon" size={24} color={COLORS.success} />
            <Text style={styles.signedMsg}>Digitally Signed on {new Date(contract.signed_at).toLocaleDateString()}</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.signBtn} onPress={handleSign} disabled={signing}>
            {signing ? <ActivityIndicator color="#FFF" /> : <Text style={styles.signBtnText}>Sign Contract</Text>}
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  backBtn: { padding: 8 },
  headerTitle: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  content: { padding: 20 },
  card: { backgroundColor: COLORS.card, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: COLORS.border },
  statusCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card, padding: 16, borderRadius: 12, marginBottom: 16, borderWidth: 1, gap: 10 },
  statusText: { fontSize: 16, fontWeight: 'bold' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  label: { color: COLORS.textDim, fontSize: 14 },
  value: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 4 },
  sectionTitle: { color: '#FFF', fontSize: 16, fontWeight: '700', marginBottom: 12 },
  contractText: { color: '#CBD5E1', lineHeight: 22, fontSize: 14 },
  signBtn: { backgroundColor: COLORS.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  signBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  signedBox: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, padding: 20, backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: 12 },
  signedMsg: { color: COLORS.success, fontWeight: 'bold' },
  pdfToggleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 16, backgroundColor: COLORS.primary, borderRadius: 8, marginBottom: 12 },
  pdfToggleText: { color: '#FFF', fontWeight: '600', flex: 1, marginLeft: 10 },
  pdfContainer: { height: Dimensions.get('window').height * 0.6, backgroundColor: '#000', borderRadius: 8, overflow: 'hidden' },
  pdfViewer: { flex: 1 },
  fullScreenBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#1C6BB1', borderRadius: 8, marginTop: 8 },
  fullScreenText: { color: '#FFF', fontWeight: '600', flex: 1, marginLeft: 10, textAlign: 'center' },
});