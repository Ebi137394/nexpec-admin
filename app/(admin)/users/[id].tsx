// app/(admin)/users/[id].tsx
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Image, Alert, Linking, RefreshControl, Modal, TextInput, KeyboardAvoidingView, Platform, FlatList } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { SA, ago, statusColor } from '@/lib/super-admin/theme';
import { signedUrls, SIGNED_URL_TTL } from '@/src/core/storage/signedUrls';

interface ProfileDetail { id: string; full_name: string | null; email: string | null; role: string | null; avatar_url: string | null; phone: string | null; company_name: string | null; created_at: string; updated_at: string | null; bio: string | null; address: string | null; city: string | null; state: string | null; country: string | null; skills: any; rating: number | null; experience: string | number | null; }
interface InspectorDoc { id: string; user_id: string; document_type: string; document_url: string; status: string; created_at: string; reviewed_at: string | null; reviewed_by: string | null; notes: string | null; }
interface JobRow { id: string; title: string; status: string; inspector_payout_cents: number; created_at: string; }  // ★ Task 4
interface UserStats { totalJobs: number; completedJobs: number; activeJobs: number; totalEarned: number; pendingEarned: number; }
interface AdminMsg { id: string; user_id: string; sender_id: string; content: string; is_read: boolean; created_at: string; }

const roleBadgeColor = (role: string | null): string => { switch (role) { case 'inspector': return SA.info; case 'client': return SA.success; case 'agency': case 'enterprise': return SA.accent; case 'admin': return SA.warning; case 'super_admin': return SA.danger; default: return SA.textMuted; } };
const docStatusIcon = (status: string): { name: keyof typeof Ionicons.glyphMap; color: string } => { switch (status) { case 'approved': return { name: 'checkmark-circle', color: SA.success }; case 'rejected': return { name: 'close-circle', color: SA.danger }; case 'pending': default: return { name: 'time', color: SA.warning }; } };
// ★ Task 4: input is integer CENTS — divide by 100 before format.
const formatMoney = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents ?? 0) / 100);

export default function UserProfileDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [myId, setMyId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileDetail | null>(null);
  const [documents, setDocuments] = useState<InspectorDoc[]>([]);
  // document_url holds a storage PATH (inspector-docs is owner+admin-only).
  // Admin is authorized: batch-mint signed URLs (keyed by path) after fetch
  // and render/open from this cache. Never mint in render.
  const [docUrlCache, setDocUrlCache] = useState<Record<string, string | null>>({});
  const [jobsList, setJobsList] = useState<JobRow[]>([]);
  const [stats, setStats] = useState<UserStats>({ totalJobs: 0, completedJobs: 0, activeJobs: 0, totalEarned: 0, pendingEarned: 0 });
  
  const [chatVisible, setChatVisible] = useState(false);
  const [adminMsgs, setAdminMsgs] = useState<AdminMsg[]>([]);
  const [chatText, setChatText] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  // --- Auth Listener ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setMyId(session.user.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) setMyId(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const { data: profileData, error: profileError } = await supabase.from('profiles').select('*').eq('id', id).single();
      if (profileError) throw profileError;
      const p = profileData as ProfileDetail;
      setProfile(p);

      try {
        // ★ 20260801318000 — payout revoked on the base table. Admin surface:
        //   jobs_secure_view unmasks the payout when nx_is_admin().
        let jobQuery = supabase.from('jobs_secure_view').select('id, title, status, inspector_payout_cents, created_at').order('created_at', { ascending: false });
        if (p.role === 'inspector') jobQuery = jobQuery.eq('contractor_id', id);
        else if (p.role === 'client') jobQuery = jobQuery.eq('client_id', id);
        else if (p.role === 'agency' || p.role === 'enterprise') jobQuery = jobQuery.eq('agency_id', id);
        
        const { data: jobsData } = await jobQuery;
        const jobs = (jobsData as JobRow[]) ?? [];
        setJobsList(jobs);

        const activeStatuses = ['in_progress', 'assigned', 'on_site', 'active', 'confirmed'];
        const completed = jobs.filter(j => j.status === 'completed');
        const active = jobs.filter(j => activeStatuses.includes(j.status));

        setStats({ 
          totalJobs: jobs.length, 
          completedJobs: completed.length, 
          activeJobs: active.length,
          totalEarned: completed.reduce((sum, j) => sum + Number(j.inspector_payout_cents || 0), 0),
          pendingEarned: active.reduce((sum, j) => sum + Number(j.inspector_payout_cents || 0), 0)
        });
      } catch (err) { console.error('[admin/users] jobs/stats load failed:', err); }

      if (p.role === 'inspector') {
        try {
          const { data: docsData, error: docsError } = await supabase.from('inspector_documents').select('id, inspector_id, document_type:doc_name, document_url:file_url, status, created_at, reviewed_at, reviewed_by, notes').eq('inspector_id', id).order('created_at', { ascending: false });
          if (docsError) throw docsError;
          const docs = (docsData as unknown as InspectorDoc[]) ?? [];
          setDocuments(docs);

          // Batch-mint signed URLs for the doc paths (admin is authorized).
          const paths = Array.from(
            new Set(docs.map(d => d.document_url).filter(Boolean) as string[]),
          );
          if (paths.length > 0) {
            const minted = await signedUrls('inspector-docs', paths, SIGNED_URL_TTL.VIEW);
            setDocUrlCache(prev => ({ ...prev, ...minted }));
          }
        } catch { setDocuments([]); }
      } else { setDocuments([]); }

      try {
        const { data: msgsData } = await supabase.from('admin_direct_messages').select('*').eq('user_id', id).order('created_at', { ascending: false });
        const msgs = (msgsData as AdminMsg[]) ?? [];
        setAdminMsgs(msgs);
        setUnreadCount(msgs.filter(m => !m.is_read && m.sender_id === id).length);
      } catch {}

    } catch (err: any) { setError(err?.message ?? 'Failed to load user profile'); } finally { setLoading(false); setRefreshing(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  useEffect(() => {
    if (!id) return;
    const channel = supabase.channel(`admin_chat_${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_direct_messages', filter: `user_id=eq.${id}` }, (payload) => {
        const incoming = payload.new as AdminMsg;
        setAdminMsgs((prev) => [incoming, ...prev]);
        if (incoming.sender_id === id && !chatVisible) setUnreadCount(c => c + 1);
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, chatVisible]);

  const openChat = useCallback(async () => {
    setChatVisible(true);
    setUnreadCount(0);
    if (!id) return;
    try {
      const unreadIds = adminMsgs.filter(m => !m.is_read && m.sender_id === id).map(m => m.id);
      if (unreadIds.length > 0) {
        await supabase.from('admin_direct_messages').update({ is_read: true }).in('id', unreadIds);
        setAdminMsgs(prev => prev.map(m => unreadIds.includes(m.id) ? { ...m, is_read: true } : m));
      }
    } catch {}
  }, [adminMsgs, id]);

  const handleSendAdminMsg = useCallback(async () => {
    const body = chatText.trim();
    if (!body || sendingChat || !id) return;
    
    setSendingChat(true);
    try {
      let currentSenderId = myId;
      if (!currentSenderId) {
        const { data } = await supabase.auth.getUser();
        if (data?.user) {
          currentSenderId = data.user.id;
          setMyId(currentSenderId);
        }
      }

      if (!currentSenderId) throw new Error('Could not verify your admin session. Please restart the app.');

      const { error: sendErr } = await supabase.from('admin_direct_messages').insert({ user_id: id, sender_id: currentSenderId, content: body });
      if (sendErr) throw sendErr;
      setChatText('');
    } catch (err: any) {
      Alert.alert('Send Failed', err.message || 'Error sending message.');
    } finally {
      setSendingChat(false);
    }
  }, [chatText, sendingChat, id, myId]);

  const handleOpenDocument = useCallback((url: string) => { Linking.openURL(url).catch(() => Alert.alert('Error', 'Unable to open this document URL.')); }, []);
  const handleCallUser = useCallback(() => { if (!profile?.phone) { Alert.alert('No Phone', 'This user has no phone number on file.'); return; } Linking.openURL(`tel:${profile.phone}`).catch(() => Alert.alert('Error', 'Unable to open dialer.')); }, [profile]);
  const handleEmailUser = useCallback(() => { if (!profile?.email) { Alert.alert('No Email', 'This user has no email on file.'); return; } Linking.openURL(`mailto:${profile.email}`).catch(() => Alert.alert('Error', 'Unable to open mail client.')); }, [profile]);

  const InfoRow = ({ icon, label, value, mono }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; mono?: boolean }) => ( <View style={s.infoRow}><View style={s.infoIconWrap}><Ionicons name={icon} size={16} color={SA.textMuted} /></View><Text style={s.infoLabel}>{label}</Text><Text style={[s.infoValue, mono && { fontFamily: 'monospace', fontSize: 11 }]} numberOfLines={2} selectable>{value}</Text></View> );
  const StatCard = ({ label, value, color, icon, isMoney }: { label: string; value: number; color: string; icon: keyof typeof Ionicons.glyphMap; isMoney?: boolean }) => ( <View style={[s.statCard, { borderColor: color + '25' }]}><View style={[s.statIcon, { backgroundColor: color + '15' }]}><Ionicons name={icon} size={18} color={color} /></View><Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit>{isMoney ? formatMoney(value) : value}</Text><Text style={s.statLabel}>{label}</Text></View> );

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={SA.accent} /><Text style={[s.emptyText, { marginTop: 12 }]}>Loading profile…</Text></View>;
  if (error || !profile) return <View style={s.center}><Ionicons name="alert-circle-outline" size={52} color={SA.danger} /><Text style={s.errorTitle}>{error ?? 'User not found'}</Text><TouchableOpacity onPress={load} style={s.retryBtn}><Ionicons name="refresh" size={16} color={SA.accent} /><Text style={s.retryBtnText}>Retry</Text></TouchableOpacity></View>;

  const badgeColor = roleBadgeColor(profile.role);
  const initials = (profile.full_name ?? '?').split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  const locationParts = [profile.city, profile.state, profile.country].filter(Boolean);
  const locationString = locationParts.length > 0 ? locationParts.join(', ') : null;

  let parsedSkills: string[] = [];
  if (Array.isArray(profile.skills)) parsedSkills = profile.skills;
  else if (typeof profile.skills === 'string') parsedSkills = profile.skills.split(',').map(s => s.trim()).filter(Boolean);

  return (
    <>
      <Stack.Screen options={{ 
        title: profile.full_name ?? 'User Profile', 
        headerStyle: { backgroundColor: SA.bg }, 
        headerTintColor: SA.text, 
        headerTitleStyle: { fontWeight: '700', fontSize: 17 }, 
        headerShadowVisible: false
      }} />
      <View style={s.root}>
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={SA.accent} />}>
          
          <View style={s.heroCard}>
            {profile.avatar_url ? <Image source={{ uri: profile.avatar_url }} style={s.heroAvatar} /> : <View style={[s.heroAvatar, s.heroAvatarFallback]}><Text style={s.heroInitials}>{initials}</Text></View>}
            <Text style={s.heroName}>{profile.full_name ?? 'Unnamed User'}</Text>
            {profile.company_name ? <Text style={s.heroCompany}>🏢 {profile.company_name}</Text> : null}
            
            <View style={[s.heroBadge, { backgroundColor: badgeColor + '18', borderColor: badgeColor + '40' }]}><View style={[s.heroBadgeDot, { backgroundColor: badgeColor }]} /><Text style={[s.heroBadgeText, { color: badgeColor }]}>{(profile.role ?? 'unknown').toUpperCase()}</Text></View>
            
            {(profile.rating != null || profile.experience != null) && (
              <View style={s.ratingExpRow}>
                {profile.rating != null && ( <View style={s.ratingBadge}><Ionicons name="star" size={14} color="#F5A623" /><Text style={s.ratingText}>{profile.rating.toFixed(1)}</Text></View> )}
                {profile.experience != null && ( <View style={s.expBadge}><Ionicons name="briefcase-outline" size={14} color={SA.textSec} /><Text style={s.expText}>{profile.experience} Yrs Exp</Text></View> )}
              </View>
            )}

            <View style={s.heroActions}>
              <TouchableOpacity style={s.heroActionBtn} onPress={handleEmailUser} activeOpacity={0.7}><Ionicons name="mail-outline" size={20} color={SA.accent} /><Text style={s.heroActionLabel}>Email</Text></TouchableOpacity>
              <TouchableOpacity style={s.heroActionBtn} onPress={handleCallUser} activeOpacity={0.7}><Ionicons name="call-outline" size={20} color={SA.success} /><Text style={s.heroActionLabel}>Call</Text></TouchableOpacity>
              <TouchableOpacity style={s.heroActionBtn} onPress={openChat} activeOpacity={0.7}>
                <View>
                  <Ionicons name="chatbubble-outline" size={20} color={SA.warning} />
                  {unreadCount > 0 && <View style={s.badgeDot}><Text style={s.badgeDotText}>{unreadCount}</Text></View>}
                </View>
                <Text style={s.heroActionLabel}>Support</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.statsScrollRow}>
            <StatCard label="Total Jobs" value={stats.totalJobs} color={SA.accent} icon="briefcase-outline" />
            <StatCard label="Active" value={stats.activeJobs} color={SA.info} icon="pulse-outline" />
            <StatCard label="Completed" value={stats.completedJobs} color={SA.success} icon="checkmark-done-outline" />
            <StatCard label="Total Earned" value={stats.totalEarned} color="#E17055" icon="cash-outline" isMoney />
            <StatCard label="Pending" value={stats.pendingEarned} color={SA.warning} icon="hourglass-outline" isMoney />
          </ScrollView>

          {parsedSkills.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>Skills & Expertise</Text>
              <View style={s.skillsWrap}>
                {parsedSkills.map((skill, idx) => ( <View key={idx} style={s.skillBadge}><Text style={s.skillText}>{skill}</Text></View> ))}
              </View>
            </View>
          )}

          <View style={s.section}>
            <Text style={s.sectionTitle}>Contact & Details</Text>
            <InfoRow icon="mail-outline" label="Email" value={profile.email ?? '—'} />
            <InfoRow icon="call-outline" label="Phone" value={profile.phone ?? '—'} />
            {profile.company_name ? <InfoRow icon="business-outline" label="Company" value={profile.company_name} /> : null}
            {locationString ? <InfoRow icon="location-outline" label="Location" value={locationString} /> : null}
            {profile.address ? <InfoRow icon="map-outline" label="Address" value={profile.address} /> : null}
            <InfoRow icon="calendar-outline" label="Joined" value={new Date(profile.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} />
            <InfoRow icon="finger-print-outline" label="User ID" value={profile.id} mono />
          </View>

          {profile.bio ? <View style={s.section}><Text style={s.sectionTitle}>Bio</Text><Text style={s.bioText}>{profile.bio}</Text></View> : null}

          {jobsList.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>Job History ({jobsList.length})</Text>
              {jobsList.slice(0, 5).map((job) => (
                <TouchableOpacity key={job.id} style={s.historyCard} onPress={() => router.push(`/(admin)/jobs/${job.id}` as any)}>
                  <View style={s.historyLeft}>
                    <Text style={s.historyTitle} numberOfLines={1}>{job.title || 'Untitled Job'}</Text>
                    <Text style={s.historyDate}>{ago(job.created_at)}</Text>
                  </View>
                  <View style={s.historyRight}>
                    <Text style={[s.historyPayout, { color: job.status === 'completed' ? SA.success : SA.text }]}>{formatMoney(job.inspector_payout_cents || 0)}</Text>
                    <View style={[s.historyStatus, { backgroundColor: statusColor(job.status) + '20' }]}><Text style={[s.historyStatusText, { color: statusColor(job.status) }]}>{job.status.replace(/_/g, ' ').toUpperCase()}</Text></View>
                  </View>
                </TouchableOpacity>
              ))}
              {jobsList.length > 5 && <Text style={s.moreText}>+ {jobsList.length - 5} more jobs</Text>}
            </View>
          )}

          {profile.role === 'inspector' && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>🎓 Certificates & Documents ({documents.length})</Text>
              {documents.length === 0 ? ( <View style={s.docsEmpty}><Ionicons name="documents-outline" size={36} color={SA.textMuted} /><Text style={s.docsEmptyText}>No documents submitted yet</Text></View> ) : (
                documents.map((doc) => {
                  const si = docStatusIcon(doc.status);
                  const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(doc.document_url ?? '');
                  const signedDocUrl = doc.document_url ? docUrlCache[doc.document_url] : null;
                  return (
                    <View key={doc.id} style={s.docCard}>
                      <View style={s.docHeader}>
                        <View style={s.docTypeWrap}><Ionicons name="document-text-outline" size={16} color={SA.accent} /><Text style={s.docType}>{doc.document_type.replace(/_/g, ' ').toUpperCase()}</Text></View>
                        <View style={[s.docStatusBadge, { backgroundColor: statusColor(doc.status) + '18' }]}><Ionicons name={si.name} size={12} color={si.color} /><Text style={[s.docStatusText, { color: si.color }]}>{doc.status.toUpperCase()}</Text></View>
                      </View>
                      {isImage && signedDocUrl && ( <TouchableOpacity onPress={() => handleOpenDocument(signedDocUrl)} activeOpacity={0.8}><Image source={{ uri: signedDocUrl }} style={s.docPreview} resizeMode="cover" /></TouchableOpacity> )}
                      <View style={s.docMeta}><Text style={s.docDate}>Submitted {ago(doc.created_at)}</Text>{doc.reviewed_at && <Text style={s.docDate}>Reviewed {ago(doc.reviewed_at)}</Text>}</View>
                      {doc.notes ? ( <View style={s.docNotes}><Text style={s.docNotesLabel}>Review Notes:</Text><Text style={s.docNotesContent}>{doc.notes}</Text></View> ) : null}
                      <TouchableOpacity style={s.openDocBtn} onPress={() => signedDocUrl && handleOpenDocument(signedDocUrl)} disabled={!signedDocUrl} activeOpacity={0.7}><Ionicons name="open-outline" size={16} color={SA.accent} /><Text style={s.openDocText}>{signedDocUrl ? 'Open Document' : 'Loading…'}</Text></TouchableOpacity>
                    </View>
                  );
                })
              )}
            </View>
          )}

          <TouchableOpacity style={s.primaryBtn} onPress={openChat} activeOpacity={0.75}>
            <Ionicons name="chatbubbles" size={20} color="#fff" />
            <Text style={s.primaryBtnText}>Open Support Chat</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* ─── INLINE CHAT MODAL ─── */}
        <Modal visible={chatVisible} animationType="slide" transparent={true} onRequestClose={() => setChatVisible(false)}>
          <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={s.chatSheet}>
              <View style={s.chatHeader}>
                <View>
                  <Text style={s.chatHeaderTitle}>Support Direct Chat</Text>
                  <Text style={s.chatHeaderSub}>with {profile?.full_name ?? 'User'}</Text>
                </View>
                <TouchableOpacity onPress={() => setChatVisible(false)} style={s.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={24} color={SA.textSec} />
                </TouchableOpacity>
              </View>

              <FlatList
                ref={flatListRef}
                data={adminMsgs}
                keyExtractor={(item) => item.id}
                inverted
                showsVerticalScrollIndicator={false}
                contentContainerStyle={s.chatList}
                renderItem={({ item }) => {
                  const isMe = item.sender_id === myId;
                  return (
                    <View style={[s.chatRow, isMe ? s.chatRowMe : s.chatRowThem]}>
                      <View style={[s.chatBubble, isMe ? s.chatBubbleMe : s.chatBubbleThem]}>
                        <Text style={[s.chatText, { color: isMe ? '#fff' : SA.text }]}>{item.content}</Text>
                        <Text style={[s.chatTime, { color: isMe ? 'rgba(255,255,255,0.6)' : SA.textMuted }]}>{new Date(item.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</Text>
                      </View>
                    </View>
                  );
                }}
                ListEmptyComponent={
                  <View style={{ transform: [{ scaleY: -1 }], paddingVertical: 40, alignItems: 'center' }}>
                    <Text style={{ color: SA.textMuted, fontStyle: 'italic', fontSize: 13 }}>No messages yet. Start the conversation!</Text>
                  </View>
                }
              />

              <View style={s.chatInputWrap}>
                <TextInput style={s.chatInput} value={chatText} onChangeText={setChatText} placeholder="Type a message..." placeholderTextColor={SA.textMuted} multiline />
                <TouchableOpacity style={[s.chatSendBtn, (!chatText.trim() || sendingChat) && { opacity: 0.5 }]} disabled={!chatText.trim() || sendingChat} onPress={handleSendAdminMsg}>
                  {sendingChat ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={16} color="#fff" style={{ marginLeft: 2 }} />}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

      </View>
    </>
  );
}

const s = StyleSheet.create({ root: { flex: 1, backgroundColor: SA.bg, paddingHorizontal: 16, paddingTop: 8 }, center: { flex: 1, backgroundColor: SA.bg, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }, heroCard: { backgroundColor: SA.surface, borderRadius: SA.radius, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: SA.border, marginBottom: 16 }, heroAvatar: { width: 88, height: 88, borderRadius: 44, marginBottom: 16 }, heroAvatarFallback: { backgroundColor: SA.accentSoft, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: SA.accent + '40' }, heroInitials: { color: SA.accent, fontSize: 28, fontWeight: '800', letterSpacing: 1 }, heroName: { color: SA.text, fontSize: 22, fontWeight: '800', marginBottom: 4, textAlign: 'center' }, heroCompany: { color: SA.textSec, fontSize: 14, marginBottom: 10 }, heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, marginBottom: 16 }, heroBadgeDot: { width: 7, height: 7, borderRadius: 3.5 }, heroBadgeText: { fontSize: 11, fontWeight: '900', letterSpacing: 1 }, ratingExpRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 }, ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F5A623' + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#F5A623' + '40' }, ratingText: { color: '#F5A623', fontSize: 13, fontWeight: '800' }, expBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: SA.surfaceLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: SA.border }, expText: { color: SA.textSec, fontSize: 12, fontWeight: '600' }, heroActions: { flexDirection: 'row', gap: 24 }, heroActionBtn: { alignItems: 'center', gap: 4 }, heroActionLabel: { color: SA.textMuted, fontSize: 11, fontWeight: '600' }, badgeDot: { position: 'absolute', top: -5, right: -10, backgroundColor: SA.danger, borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 2, borderColor: SA.surface }, badgeDotText: { color: '#fff', fontSize: 9, fontWeight: '800' }, statsScrollRow: { gap: 10, paddingBottom: 16 }, statCard: { width: 110, backgroundColor: SA.surface, borderRadius: SA.radiusSm, padding: 14, alignItems: 'center', borderWidth: 1 }, statIcon: { width: 32, height: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 8 }, statValue: { color: SA.text, fontSize: 16, fontWeight: '800', marginBottom: 2, textAlign: 'center' }, statLabel: { color: SA.textMuted, fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' }, section: { backgroundColor: SA.surface, borderRadius: SA.radius, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: SA.border }, sectionTitle: { color: SA.textSec, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 14 }, skillsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, skillBadge: { backgroundColor: SA.accent + '15', borderWidth: 1, borderColor: SA.accent + '30', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }, skillText: { color: SA.accent, fontSize: 12, fontWeight: '600' }, historyCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: SA.border }, historyLeft: { flex: 1, paddingRight: 10 }, historyTitle: { color: SA.text, fontSize: 14, fontWeight: '600', marginBottom: 4 }, historyDate: { color: SA.textMuted, fontSize: 11 }, historyRight: { alignItems: 'flex-end', gap: 4 }, historyPayout: { fontSize: 14, fontWeight: '800' }, historyStatus: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }, historyStatusText: { fontSize: 9, fontWeight: '800' }, moreText: { color: SA.textMuted, fontSize: 12, textAlign: 'center', marginTop: 12, fontWeight: '600' }, infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 }, infoIconWrap: { width: 24, alignItems: 'center', paddingTop: 1 }, infoLabel: { color: SA.textMuted, fontSize: 13, width: 75, fontWeight: '500' }, infoValue: { color: SA.text, fontSize: 13, fontWeight: '600', flex: 1 }, bioText: { color: SA.textSec, fontSize: 14, lineHeight: 21 }, docsEmpty: { alignItems: 'center', paddingVertical: 28, gap: 8 }, docsEmptyText: { color: SA.textMuted, fontSize: 13 }, docCard: { backgroundColor: SA.bg, borderRadius: SA.radiusSm, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: SA.border }, docHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }, docTypeWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }, docType: { color: SA.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 }, docStatusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }, docStatusText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }, docPreview: { width: '100%', height: 140, borderRadius: 8, marginBottom: 10, backgroundColor: SA.surfaceLight }, docMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }, docDate: { color: SA.textMuted, fontSize: 11 }, docNotes: { backgroundColor: SA.surfaceLight, borderRadius: 8, padding: 10, marginBottom: 10 }, docNotesLabel: { color: SA.textMuted, fontSize: 10, fontWeight: '700', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 }, docNotesContent: { color: SA.textSec, fontSize: 13, lineHeight: 18 }, openDocBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: SA.accent + '30', backgroundColor: SA.accentSoft }, openDocText: { color: SA.accent, fontSize: 13, fontWeight: '700' }, primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: SA.accent, borderRadius: SA.radiusSm, paddingVertical: 16, marginTop: 4, marginBottom: 20 }, primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' }, errorTitle: { color: SA.textSec, fontSize: 15, fontWeight: '600', marginTop: 14, marginBottom: 16, textAlign: 'center' }, retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: SA.accentSoft, borderWidth: 1, borderColor: SA.accent + '30' }, retryBtnText: { color: SA.accent, fontSize: 14, fontWeight: '700' }, emptyText: { color: SA.textMuted, fontSize: 13, textAlign: 'center' }, modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }, chatSheet: { backgroundColor: SA.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '80%', paddingBottom: 20 }, chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: SA.border }, chatHeaderTitle: { color: SA.text, fontSize: 18, fontWeight: '800' }, chatHeaderSub: { color: SA.textSec, fontSize: 13, marginTop: 2 }, closeBtn: { backgroundColor: SA.surface, padding: 6, borderRadius: 20 }, chatList: { padding: 16, flexGrow: 1, justifyContent: 'flex-end' }, chatRow: { marginBottom: 12, flexDirection: 'row' }, chatRowMe: { justifyContent: 'flex-end' }, chatRowThem: { justifyContent: 'flex-start' }, chatBubble: { maxWidth: '80%', padding: 14, borderRadius: 18 }, chatBubbleMe: { backgroundColor: SA.accent, borderBottomRightRadius: 4 }, chatBubbleThem: { backgroundColor: SA.surface, borderWidth: 1, borderColor: SA.border, borderBottomLeftRadius: 4 }, chatText: { fontSize: 14, lineHeight: 20 }, chatTime: { fontSize: 10, marginTop: 6, textAlign: 'right' }, chatInputWrap: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingTop: 12 }, chatInput: { flex: 1, backgroundColor: SA.surface, borderWidth: 1, borderColor: SA.border, borderRadius: 20, color: SA.text, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, maxHeight: 100, fontSize: 14 }, chatSendBtn: { backgroundColor: SA.accent, width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginLeft: 10, marginBottom: 2 } });