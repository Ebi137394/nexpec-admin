// ─────────────────────────────────────────────────────────────────
//  src/core/offline/OutboxInspector.tsx
//  DEV-ONLY floating overlay for watching the offline-sync state machine live
//  during chaos testing. Renders nothing in production.
//
//  Shows live counts (pending / in_flight / conflict / abandoned), the online
//  flag, and every outbox row with its status + attempt count + last error.
//  Buttons to flush / retry / discard so you can drive the state machine by
//  hand. The list polls fast so the brief 'in_flight' transition (which does not
//  emit a change event) is visible as ops drain.
//
//  Mounted dev-only from app/_layout.tsx: {__DEV__ ? <OutboxInspector /> : null}
// ─────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { onOutboxChange, flushQueue, resumeSync } from './sync';
import { onNetworkChange, isOnline } from './network';
import {
  counts as outboxCounts,
  listAll,
  retryAbandoned,
  retryConflict,
  discardOperation,
  type OutboxRow,
  type OutboxCounts,
} from './outbox';

const ZERO: OutboxCounts = { pending: 0, in_flight: 0, abandoned: 0, conflict: 0 };

const STATUS_COLOR: Record<string, string> = {
  pending: '#f59e0b', // amber — waiting
  in_flight: '#22d3ee', // cyan — actively draining
  conflict: '#7C3AED', // violet — needs resolution
  abandoned: '#ef4444', // red — gave up / fatal
  failed: '#ef4444',
};

export function OutboxInspector() {
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<OutboxCounts>(ZERO);
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [online, setOnline] = useState(isOnline());

  const refresh = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([outboxCounts(), listAll()]);
      setCounts(c);
      setRows(r);
    } catch {
      /* db not ready yet — ignore */
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsubOutbox = onOutboxChange(refresh);
    const unsubNet = onNetworkChange(setOnline);
    // 'in_flight' is set inside nextPending() without emitting a change event,
    // so poll fast to make that transition visible during a drain.
    const id = setInterval(refresh, 750);
    return () => {
      unsubOutbox();
      unsubNet();
      clearInterval(id);
    };
  }, [refresh]);

  // Production guard AFTER hooks (keeps hook order stable / rules-of-hooks safe).
  if (!__DEV__) return null;

  if (!open) {
    return (
      <Pressable style={styles.pill} onPress={() => setOpen(true)} accessibilityLabel="Open outbox inspector">
        <Dot color={online ? '#22c55e' : '#ef4444'} />
        <Text style={styles.pillText}>
          OBX {counts.pending}·{counts.in_flight}·{counts.conflict}·{counts.abandoned}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.panel} pointerEvents="box-none">
      <View style={styles.panelInner}>
        <View style={styles.header}>
          <Dot color={online ? '#22c55e' : '#ef4444'} />
          <Text style={styles.title}>OUTBOX · {online ? 'online' : 'offline'}</Text>
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => setOpen(false)} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.countsRow}>
          <Count label="pending" n={counts.pending} color={STATUS_COLOR.pending} />
          <Count label="in_flight" n={counts.in_flight} color={STATUS_COLOR.in_flight} />
          <Count label="conflict" n={counts.conflict} color={STATUS_COLOR.conflict} />
          <Count label="abandoned" n={counts.abandoned} color={STATUS_COLOR.abandoned} />
        </View>

        <View style={styles.actions}>
          <Btn label="Flush now" onPress={() => void resumeSync()} />
          <Btn label="Drain" onPress={() => void flushQueue()} />
          <Btn label="Refresh" onPress={() => void refresh()} />
        </View>

        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 8 }}>
          {rows.length === 0 ? (
            <Text style={styles.empty}>queue empty</Text>
          ) : (
            rows.map((r) => <Row key={r.id} row={r} onChanged={refresh} />)
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function Row({ row, onChanged }: { row: OutboxRow; onChanged: () => void }) {
  const color = STATUS_COLOR[row.status] ?? '#94a3b8';
  const resolvable = row.status === 'conflict' || row.status === 'abandoned' || row.status === 'failed';
  return (
    <View style={styles.row}>
      <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color }]}>
        <Text style={[styles.badgeText, { color }]}>{row.status}</Text>
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.rowKind}>
          #{row.id} · {row.kind} · try {row.attempts}
          {row.failure_class ? ` · ${row.failure_class}` : ''}
        </Text>
        {row.last_error ? (
          <Text style={styles.rowErr} numberOfLines={1}>
            {row.last_error}
          </Text>
        ) : null}
      </View>
      {resolvable && (
        <View style={styles.rowBtns}>
          <Pressable
            hitSlop={8}
            onPress={async () => {
              if (row.status === 'conflict') await retryConflict(row.id);
              else await retryAbandoned(row.id);
              void resumeSync();
              onChanged();
            }}
          >
            <Text style={styles.rowBtn}>retry</Text>
          </Pressable>
          <Pressable
            hitSlop={8}
            onPress={async () => {
              await discardOperation(row.id);
              onChanged();
            }}
          >
            <Text style={[styles.rowBtn, { color: '#ef4444' }]}>discard</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Count({ label, n, color }: { label: string; n: number; color: string }) {
  return (
    <View style={styles.count}>
      <Text style={[styles.countN, { color }]}>{n}</Text>
      <Text style={styles.countL}>{label}</Text>
    </View>
  );
}
function Dot({ color }: { color: string }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}
function Btn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.btn} onPress={onPress} hitSlop={6}>
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute', left: 10, bottom: 40, flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(2,4,32,0.92)', borderColor: '#7C3AED', borderWidth: 1, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 6, zIndex: 99999,
  },
  pillText: { color: '#e2e8f0', fontSize: 11, fontWeight: '700', marginLeft: 6, fontVariant: ['tabular-nums'] },
  panel: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end', zIndex: 99999 },
  panelInner: {
    margin: 10, marginBottom: 40, maxHeight: '62%', backgroundColor: 'rgba(2,4,32,0.97)',
    borderColor: '#7C3AED', borderWidth: 1, borderRadius: 14, padding: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  title: { color: '#fff', fontWeight: '800', fontSize: 13, marginLeft: 8, letterSpacing: 1 },
  close: { color: '#94a3b8', fontSize: 16, fontWeight: '700' },
  countsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  count: { alignItems: 'center', flex: 1 },
  countN: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  countL: { color: '#64748b', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  btn: {
    backgroundColor: 'rgba(124,58,237,0.18)', borderColor: '#7C3AED', borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  btnText: { color: '#c4b5fd', fontWeight: '700', fontSize: 12 },
  list: { borderTopColor: 'rgba(255,255,255,0.08)', borderTopWidth: 1, paddingTop: 6 },
  empty: { color: '#475569', fontSize: 12, textAlign: 'center', paddingVertical: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 6,
    borderBottomColor: 'rgba(255,255,255,0.05)', borderBottomWidth: 1,
  },
  rowMain: { flex: 1, marginLeft: 8 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, minWidth: 66, alignItems: 'center' },
  badgeText: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  rowKind: { color: '#e2e8f0', fontSize: 11, fontWeight: '600' },
  rowErr: { color: '#94a3b8', fontSize: 10, marginTop: 1 },
  rowBtns: { flexDirection: 'row', gap: 10, marginLeft: 6 },
  rowBtn: { color: '#a78bfa', fontSize: 11, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
