// src/components/meetings/MeetingsPanel.tsx — Brokered War Room panel.
//
// Drop into any Job or RFQ workspace. Lists meetings (RLS-scoped — you only see
// the ones you're a participant on), launches the video link, and schedules new
// ones. The golden-rule guard lives in schedule_meeting() (a client↔inspector
// room requires an admin host) — this panel surfaces that error plainly.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, Alert, ActivityIndicator, Linking, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NEXPEC_THEME as T } from '../DynamicForm/theme';
import { useMeetings, scheduleMeeting, type Meeting } from '@/src/hooks/useMeetings';

interface Party { id: string; label: string; role: string; }
const PROVIDERS: ReadonlyArray<readonly [string, string]> = [['zoom', 'Zoom'], ['teams', 'Teams'], ['meet', 'Meet'], ['other', 'Other']];

export function MeetingsPanel({ jobId, rfqId, parties = [] }: { jobId?: string; rfqId?: string; parties?: Party[] }) {
  const { items, loading, refetch } = useMeetings({ jobId, rfqId });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [provider, setProvider] = useState('zoom');
  const [whenLabel, setWhenLabel] = useState('In 1 hour');
  const [when, setWhen] = useState<Date>(() => new Date(Date.now() + 3600000));
  const [invited, setInvited] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const launch = (m: Meeting) => Linking.openURL(m.url).catch(() => Alert.alert('Could not open link'));
  const toggle = (id: string) => setInvited((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const quick = (label: string, d: Date) => { setWhenLabel(label); setWhen(d); };

  const submit = async () => {
    if (!title.trim()) { Alert.alert('Title required'); return; }
    if (!/^https?:\/\//i.test(url.trim())) { Alert.alert('Enter a valid meeting URL'); return; }
    setBusy(true);
    try {
      const { error } = await scheduleMeeting({
        title: title.trim(), url: url.trim(), scheduled_at: when.toISOString(), participant_ids: invited,
        job_id: jobId ?? null, rfq_id: rfqId ?? null, provider, duration_min: 30,
      });
      if (error) {
        const isGuard = error.message.includes('admin_host_required');
        Alert.alert(isGuard ? 'Admin host required' : 'Could not schedule',
          isGuard ? 'Client↔inspector meetings must be hosted by a NEXPEC admin. Ask operations to convene this call.' : error.message);
        return;
      }
      setOpen(false); setTitle(''); setUrl(''); setInvited([]); await refetch();
    } finally { setBusy(false); }
  };

  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Text style={s.title}>Meetings</Text>
        <TouchableOpacity style={s.add} onPress={() => setOpen(true)} activeOpacity={0.85}>
          <Ionicons name="videocam" size={14} color="#fff" /><Text style={s.addTxt}>Schedule</Text>
        </TouchableOpacity>
      </View>

      {loading ? <ActivityIndicator color={T.colors.primary} style={{ marginVertical: 12 }} />
        : items.length === 0 ? <Text style={s.empty}>No meetings scheduled.</Text>
        : items.map((m) => (
          <View key={m.id} style={[s.card, m.status === 'cancelled' && { opacity: 0.5 }]}>
            <View style={{ flex: 1 }}>
              <Text style={s.mTitle} numberOfLines={1}>{m.title}</Text>
              <Text style={s.mMeta}>{m.provider.toUpperCase()}, {new Date(m.scheduled_at).toLocaleString()}{m.status !== 'scheduled' ? `, ${m.status}` : ''}</Text>
            </View>
            {m.status !== 'cancelled' && (
              <TouchableOpacity style={s.launch} onPress={() => launch(m)} activeOpacity={0.85}>
                <Ionicons name="open-outline" size={14} color={T.colors.primary} /><Text style={s.launchTxt}>Join</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={s.modalRoot}><View style={s.sheet}>
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>Schedule meeting</Text>
            <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8}><Ionicons name="close" size={22} color={T.colors.text} /></TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <TextInput value={title} onChangeText={setTitle} placeholder="Title, e.g. FAT pre-sync" placeholderTextColor={T.colors.textMuted} style={s.input} />
            <View style={s.segRow}>
              {PROVIDERS.map(([v, l]) => (
                <TouchableOpacity key={v} onPress={() => setProvider(v)} style={[s.seg, provider === v && s.segOn]}><Text style={[s.segTxt, provider === v && { color: '#fff' }]}>{l}</Text></TouchableOpacity>
              ))}
            </View>
            <TextInput value={url} onChangeText={setUrl} placeholder="Paste meeting link (https://…)" placeholderTextColor={T.colors.textMuted} autoCapitalize="none" autoCorrect={false} style={s.input} />
            <View style={s.segRow}>
              <TouchableOpacity onPress={() => quick('In 1 hour', new Date(Date.now() + 3600000))} style={[s.seg, whenLabel === 'In 1 hour' && s.segOn]}><Text style={[s.segTxt, whenLabel === 'In 1 hour' && { color: '#fff' }]}>In 1h</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => quick('In 3 hours', new Date(Date.now() + 3 * 3600000))} style={[s.seg, whenLabel === 'In 3 hours' && s.segOn]}><Text style={[s.segTxt, whenLabel === 'In 3 hours' && { color: '#fff' }]}>In 3h</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => { const d = new Date(Date.now() + 86400000); d.setHours(9, 0, 0, 0); quick('Tomorrow 9am', d); }} style={[s.seg, whenLabel === 'Tomorrow 9am' && s.segOn]}><Text style={[s.segTxt, whenLabel === 'Tomorrow 9am' && { color: '#fff' }]}>Tmrw 9am</Text></TouchableOpacity>
            </View>
            <Text style={s.when}>{when.toLocaleString()}</Text>
            {parties.length > 0 && (
              <>
                <Text style={s.label}>Invite</Text>
                <View style={s.chips}>
                  {parties.map((p) => {
                    const on = invited.includes(p.id);
                    return <TouchableOpacity key={p.id} onPress={() => toggle(p.id)} style={[s.chip, on && s.segOn]}><Text style={[s.chipTxt, on && { color: '#fff' }]}>{p.label}</Text></TouchableOpacity>;
                  })}
                </View>
                <Text style={s.hint}>Client↔inspector calls are hosted by a NEXPEC admin.</Text>
              </>
            )}
            <TouchableOpacity style={[s.submit, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy} activeOpacity={0.85}>
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="videocam" size={16} color="#fff" />}
              <Text style={s.submitTxt}>{busy ? 'Scheduling…' : 'Schedule & notify'}</Text>
            </TouchableOpacity>
            <View style={{ height: 20 }} />
          </ScrollView>
        </View></View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, padding: T.spacing.md, marginVertical: T.spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: T.spacing.sm },
  title: { color: T.colors.text, fontSize: T.fontSize.md, fontWeight: '700' },
  add: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: T.colors.primary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: T.borderRadius.full },
  addTxt: { color: '#fff', fontSize: T.fontSize.xs, fontWeight: '700' },
  empty: { color: T.colors.textMuted, fontSize: T.fontSize.sm, paddingVertical: 8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: T.colors.inputBorder },
  mTitle: { color: T.colors.text, fontSize: T.fontSize.sm, fontWeight: '600' },
  mMeta: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, marginTop: 2 },
  launch: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: T.colors.primary, borderRadius: T.borderRadius.md, paddingHorizontal: 12, paddingVertical: 7 },
  launchTxt: { color: T.colors.primary, fontSize: T.fontSize.xs, fontWeight: '700' },
  modalRoot: { flex: 1, backgroundColor: T.colors.overlay ?? 'rgba(2,4,32,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: T.colors.background, borderTopLeftRadius: T.borderRadius.xl, borderTopRightRadius: T.borderRadius.xl, borderWidth: 1, borderColor: T.colors.inputBorder, maxHeight: '88%', paddingHorizontal: T.spacing.lg, paddingTop: T.spacing.lg },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: T.spacing.md },
  sheetTitle: { color: T.colors.text, fontSize: T.fontSize.lg, fontWeight: '700' },
  input: { backgroundColor: T.colors.inputBackground, borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: T.borderRadius.md, paddingHorizontal: 12, paddingVertical: 12, color: T.colors.text, fontSize: T.fontSize.sm, marginBottom: T.spacing.sm },
  segRow: { flexDirection: 'row', gap: 8, marginBottom: T.spacing.sm },
  seg: { flex: 1, alignItems: 'center', borderWidth: 1, borderColor: T.colors.inputBorder, borderRadius: T.borderRadius.md, paddingVertical: 9, backgroundColor: T.colors.inputBackground },
  segOn: { backgroundColor: T.colors.primary, borderColor: T.colors.primary },
  segTxt: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, fontWeight: '700' },
  when: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, marginBottom: T.spacing.md },
  label: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: T.borderRadius.full, borderWidth: 1, borderColor: T.colors.inputBorder, backgroundColor: T.colors.inputBackground },
  chipTxt: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, fontWeight: '600' },
  hint: { color: T.colors.textMuted, fontSize: T.fontSize.xs, marginTop: 8 },
  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: T.colors.primary, borderRadius: T.borderRadius.md, paddingVertical: T.spacing.md, marginTop: T.spacing.md },
  submitTxt: { color: '#fff', fontSize: T.fontSize.sm, fontWeight: '700' },
});
