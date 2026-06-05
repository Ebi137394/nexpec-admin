// ════════════════════════════════════════════════════════════════════════════
//  app/(inspector)/calendar.tsx — Mobile Inspector Calendar (web parity)
//
//  Mirrors web /inspector/calendar. Reads the inspector's assigned, scheduled
//  jobs (jobs.contractor_id = me, scheduled_date in the 6-week grid range,
//  deleted_at IS NULL) — all columns verified against migrations. Renders a
//  month grid + selected-day agenda with overlap/conflict flags. Read-only,
//  plus a native "add to device calendar" via src/services/CalendarSync
//  (expo-calendar) — the mobile edge over the web's iCal feed.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';
import { syncJobToCalendar } from '@/src/services/CalendarSync';

const C = {
  bg: '#020420', card: '#0B1138', cardDeep: '#080C2A',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED', primaryDim: 'rgba(124,58,237,0.14)',
  cyan: '#00FFFF', green: '#10B981', amber: '#F59E0B', red: '#EF4444', redDim: 'rgba(239,68,68,0.14)',
};

const DUR_MIN = 60;
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Evt {
  id: string; title: string; status: string; domain: string | null;
  start: Date; end: Date; location: string | null; conflicts: number;
}

const STATUS_TONE: Record<string, string> = {
  open: C.primary, assigned: C.cyan, in_progress: C.amber, completed: C.green, disputed: C.red, cancelled: C.textMute,
};

export default function InspectorCalendarScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [anchor, setAnchor] = useState(() => startOfMonth(new Date()));
  const [events, setEvents] = useState<Evt[]>([]);
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const grid = useMemo(() => gridDays(anchor), [anchor]);

  const load = useCallback(async (monthAnchor: Date) => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('You must be signed in.'); return; }
      const days = gridDays(monthAnchor);
      const from = days[0]; const to = addDays(days[days.length - 1], 1);
      const { data, error: qErr } = await supabase
        .from('jobs')
        .select('id, title, status, domain, scheduled_date, location, location_city')
        .eq('contractor_id', user.id)
        .gte('scheduled_date', from.toISOString())
        .lt('scheduled_date', to.toISOString())
        .not('scheduled_date', 'is', null)
        .is('deleted_at', null)
        .order('scheduled_date', { ascending: true });
      if (qErr) { setError(qErr.message); return; }

      const evs: Evt[] = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
        const start = new Date(String(r.scheduled_date));
        return {
          id: String(r.id), title: String(r.title ?? 'Untitled job'),
          status: String(r.status ?? 'unknown'), domain: (r.domain as string | null) ?? null,
          start, end: new Date(start.getTime() + DUR_MIN * 60000),
          location: (r.location as string | null) || (r.location_city as string | null) || null,
          conflicts: 0,
        };
      });
      // overlap detection (in-memory)
      for (let i = 0; i < evs.length; i++) {
        for (let j = i + 1; j < evs.length; j++) {
          if (evs[i].start < evs[j].end && evs[j].start < evs[i].end) { evs[i].conflicts++; evs[j].conflicts++; }
        }
      }
      setEvents(evs);
    } catch (e: unknown) {
      console.warn('[calendar] load threw:', e);
      setError((e as Error)?.message ?? 'Could not load the calendar.');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(anchor); }, [load, anchor]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(anchor); }, [load, anchor]);

  const countByDay = useMemo(() => {
    const m = new Map<string, number>();
    events.forEach((e) => { const k = dayKey(e.start); m.set(k, (m.get(k) ?? 0) + 1); });
    return m;
  }, [events]);

  const dayEvents = useMemo(
    () => events.filter((e) => sameDay(e.start, selected)).sort((a, b) => a.start.getTime() - b.start.getTime()),
    [events, selected],
  );
  const totalConflicts = useMemo(() => events.filter((e) => e.conflicts > 0).length, [events]);

  const addToCalendar = useCallback(async (e: Evt) => {
    setSyncing(e.id);
    try {
      await syncJobToCalendar({
        id: e.id, title: e.title,
        clientName: e.domain ? domainLabel(e.domain) : 'NEXPEC inspection',
        location: e.location ?? '—',
        scheduledDate: e.start, estimatedDurationMinutes: DUR_MIN,
      });
    } finally { setSyncing(null); }
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}><StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}><ActivityIndicator size="large" color={C.primary} /><Text style={s.centerText}>Loading calendar…</Text></View>
      </SafeAreaView>
    );
  }

  const todayKey = dayKey(new Date());
  const selKey = dayKey(selected);

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><Ionicons name="arrow-back" size={22} color={C.text} /></TouchableOpacity>
        <Text style={s.headerTitle}>Calendar</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
      >
        {/* Month nav */}
        <Animated.View entering={FadeIn.duration(200)} style={s.monthBar}>
          <TouchableOpacity onPress={() => setAnchor(addMonths(anchor, -1))} hitSlop={10} style={s.navBtn}><Ionicons name="chevron-back" size={18} color={C.textSec} /></TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={s.monthTitle}>{fmtMonthYear(anchor)}</Text>
            <TouchableOpacity onPress={() => { const t = new Date(); setAnchor(startOfMonth(t)); setSelected(startOfDay(t)); }}><Text style={s.todayLink}>Today</Text></TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => setAnchor(addMonths(anchor, 1))} hitSlop={10} style={s.navBtn}><Ionicons name="chevron-forward" size={18} color={C.textSec} /></TouchableOpacity>
        </Animated.View>

        {error ? (<View style={s.errorBanner}><Ionicons name="alert-circle" size={16} color={C.red} /><Text style={s.errorText}>{error}</Text></View>) : null}

        {totalConflicts > 0 && (
          <View style={s.conflictChip}><Ionicons name="warning-outline" size={13} color={C.amber} /><Text style={s.conflictChipText}>{totalConflicts} job{totalConflicts === 1 ? '' : 's'} with a scheduling overlap this month</Text></View>
        )}

        {/* Grid */}
        <View style={s.gridCard}>
          <View style={s.weekRow}>{WEEKDAYS.map((d, i) => <Text key={i} style={s.weekday}>{d}</Text>)}</View>
          <View style={s.grid}>
            {grid.map((d) => {
              const k = dayKey(d);
              const inMonth = d.getMonth() === anchor.getMonth();
              const isToday = k === todayKey;
              const isSel = k === selKey;
              const n = countByDay.get(k) ?? 0;
              return (
                <TouchableOpacity key={k} style={s.cell} activeOpacity={0.7} onPress={() => setSelected(startOfDay(d))}>
                  <View style={[s.cellInner, isSel && s.cellSel, isToday && !isSel && s.cellToday]}>
                    <Text style={[s.cellNum, !inMonth && s.cellNumMuted, (isSel || isToday) && s.cellNumActive]}>{d.getDate()}</Text>
                    {n > 0 && <View style={[s.cellDot, isSel && { backgroundColor: '#fff' }]}>{n > 1 ? <Text style={[s.cellDotText, isSel && { color: C.primary }]}>{n}</Text> : null}</View>}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Agenda for selected day */}
        <View style={s.agendaHead}>
          <Text style={s.agendaTitle}>{fmtFullDate(selected)}</Text>
          <Text style={s.agendaCount}>{dayEvents.length} job{dayEvents.length === 1 ? '' : 's'}</Text>
        </View>

        {dayEvents.length === 0 ? (
          <View style={s.emptyState}><Ionicons name="calendar-clear-outline" size={28} color={C.textMute} /><Text style={s.emptyText}>No scheduled jobs on this day.</Text></View>
        ) : (
          <View style={{ gap: 10 }}>
            {dayEvents.map((e) => {
              const tone = STATUS_TONE[e.status] ?? C.textMute;
              return (
                <View key={e.id} style={[s.evtCard, e.conflicts > 0 && s.evtCardConflict]}>
                  <View style={s.evtTimeCol}>
                    <Text style={s.evtTime}>{fmtTime(e.start)}</Text>
                    <View style={[s.evtBar, { backgroundColor: tone }]} />
                    <Text style={s.evtTimeEnd}>{fmtTime(e.end)}</Text>
                  </View>
                  <TouchableOpacity style={{ flex: 1, minWidth: 0 }} activeOpacity={0.7} onPress={() => router.push(`/(inspector)/jobs/${e.id}` as any)}>
                    <View style={s.evtTopRow}>
                      <Text style={s.evtTitle} numberOfLines={1}>{e.title}</Text>
                      <View style={[s.statusPill, { borderColor: tone + '55', backgroundColor: tone + '1A' }]}><Text style={[s.statusPillText, { color: tone }]}>{e.status.replace(/_/g, ' ').toUpperCase()}</Text></View>
                    </View>
                    {e.location && <View style={s.evtMeta}><Ionicons name="location-outline" size={11} color={C.textMute} /><Text style={s.evtMetaText} numberOfLines={1}>{e.location}</Text></View>}
                    {e.domain && <View style={s.evtMeta}><Ionicons name="pricetag-outline" size={11} color={C.textMute} /><Text style={s.evtMetaText}>{domainLabel(e.domain)}</Text></View>}
                    {e.conflicts > 0 && <View style={s.evtMeta}><Ionicons name="warning-outline" size={11} color={C.amber} /><Text style={[s.evtMetaText, { color: C.amber }]}>{e.conflicts} overlap{e.conflicts === 1 ? '' : 's'}</Text></View>}
                  </TouchableOpacity>
                  <TouchableOpacity style={s.calBtn} onPress={() => addToCalendar(e)} disabled={syncing === e.id} hitSlop={6}>
                    {syncing === e.id ? <ActivityIndicator size="small" color={C.primary} /> : <Ionicons name="calendar-outline" size={18} color={C.primary} />}
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        <Text style={s.footnote}>Source, jobs assigned to you (contractor_id), scheduled_date, RLS-gated, tap the calendar icon to add to your device.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── date helpers ──────────────────────────────────────────────────────────
function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function sameDay(a: Date, b: Date): boolean { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function dayKey(d: Date): string { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function gridDays(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  const start = addDays(first, -first.getDay()); // back to Sunday
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
function fmtMonthYear(d: Date): string { return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); }
function fmtFullDate(d: Date): string { return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); }
function fmtTime(d: Date): string { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
function domainLabel(slug: string): string { return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

// ─── styles ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { padding: 16, paddingBottom: 56, gap: 14 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, padding: 32 },
  centerText: { color: C.textSec, fontSize: 13 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '700' },

  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  navBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)' },
  monthTitle: { color: C.text, fontSize: 18, fontWeight: '700' },
  todayLink: { color: C.primary, fontSize: 11, fontWeight: '700', marginTop: 1 },

  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.redDim, borderColor: 'rgba(239,68,68,0.32)', borderWidth: 1, padding: 12, borderRadius: 12 },
  errorText: { color: '#FCA5A5', fontSize: 13, flex: 1 },
  conflictChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(245,158,11,0.32)', backgroundColor: 'rgba(245,158,11,0.12)' },
  conflictChipText: { color: C.amber, fontSize: 10.5, fontWeight: '600' },

  gridCard: { borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 10 },
  weekRow: { flexDirection: 'row', marginBottom: 6 },
  weekday: { flex: 1, textAlign: 'center', color: C.textMute, fontSize: 10, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2 },
  cellInner: { flex: 1, borderRadius: 10, justifyContent: 'center', alignItems: 'center', gap: 2 },
  cellSel: { backgroundColor: C.primary },
  cellToday: { borderWidth: 1, borderColor: 'rgba(124,58,237,0.5)' },
  cellNum: { color: C.text, fontSize: 13, fontWeight: '600' },
  cellNumMuted: { color: C.textMute, opacity: 0.5 },
  cellNumActive: { fontWeight: '800' },
  cellDot: { minWidth: 6, height: 6, borderRadius: 3, paddingHorizontal: 3, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center' },
  cellDotText: { color: '#fff', fontSize: 7, fontWeight: '800', lineHeight: 8 },

  agendaHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  agendaTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  agendaCount: { color: C.textMute, fontSize: 12 },

  emptyState: { alignItems: 'center', padding: 28, gap: 8, borderRadius: 16, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed', backgroundColor: 'rgba(255,255,255,0.01)' },
  emptyText: { color: C.textSec, fontSize: 13, textAlign: 'center' },

  evtCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  evtCardConflict: { borderColor: 'rgba(245,158,11,0.4)' },
  evtTimeCol: { alignItems: 'center', width: 52, gap: 3 },
  evtTime: { color: C.text, fontSize: 12, fontWeight: '700' },
  evtBar: { width: 3, height: 16, borderRadius: 2 },
  evtTimeEnd: { color: C.textMute, fontSize: 10 },
  evtTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  evtTitle: { color: C.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  evtMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  evtMetaText: { color: C.textMute, fontSize: 10.5, flexShrink: 1 },
  statusPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  statusPillText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.3 },
  calBtn: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(124,58,237,0.3)', backgroundColor: C.primaryDim },

  footnote: { color: C.textMute, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 8 },
});
