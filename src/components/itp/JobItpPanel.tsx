// src/components/itp/JobItpPanel.tsx — the inspector's Inspection & Test Plan,
// executed in the field.
//
// Drops into the existing Job Details screen beside JobTeamPanel and
// JobVisitsPanel. There is deliberately no second mobile job-detail system and
// no second evidence capture: this panel records ITP RESULTS and hands every
// piece of evidence off to the workflows that already exist (submit-report for
// photos/report evidence, flash-reports for an NCR).
//
// ── THE CONTRACT IS FROZEN ELSEWHERE ────────────────────────────────────────
// Every type, label, ordering rule and RPC name comes from
// @nexpec/shared-core/domain/itp. This file defines no ITP vocabulary of its
// own and — critically — computes no blocking rule. `isBlockingNow` is backend
// truth; deriving it here from point_type/result is how a UI ends up telling an
// inspector the line is clear when it is not.
//
// ── READ HERE, WRITE THROUGH THE EXECUTION MODULE ───────────────────────────
// Reads go straight to ITP_RPC.jobItp through the existing mobile Supabase
// client, exactly like JobVisitsPanel and JobTeamPanel: a read needs no outbox.
// The WRITE goes through src/lib/itp/execution.recordItpResult, which owns the
// online path and the offline outbox. This file never calls the record RPC
// directly, so it cannot become an offline-losing write surface.
//
// ── OFFLINE HONESTY ─────────────────────────────────────────────────────────
// recordItpResult returns `queued: true` when the act went to the outbox. That
// is NOT a recorded result, so the panel does not repaint the point as though
// the server accepted it. It keeps showing the server's last known result and
// adds an explicit "saved on this device, will sync" marker until a refresh
// proves the replay landed.
//
// ── AUTHORISATION IS THE SERVER'S, NOT THIS FILE'S ──────────────────────────
// nx_job_itp authorises the caller in its own body; an unrelated inspector gets
// an error and the panel hides itself rather than implying "no plan". Releasing
// a hold belongs to an admin or the buyer (nx_itp_release_hold 42501s anyone
// else), so no release control is drawn on this surface at all.
//
// ── NO MONEY ────────────────────────────────────────────────────────────────
// nx_job_itp returns no pricing column, nothing here joins payments, payouts,
// invoices or the ledger, and recording a point triggers no payment behaviour.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { NEXPEC_THEME as T } from '../DynamicForm/theme';
import { supabase } from '@/lib/supabase';
import {
  ITP_RPC,
  ITP_RESULTS,
  ITP_RESULT_LABELS,
  ITP_POINT_TYPE_LABELS,
  ITP_POINT_TYPE_MEANING,
  groupItpByStage,
  itpProgress,
  canOfferHoldRelease,
  itpWitnessNameRequired,
  coerceItpPointType,
  coerceItpResult,
  type ItpPoint,
  type ItpResult,
  type ItpPointType,
} from '@nexpec/shared-core';
// Owned by the execution lane. Online path + offline outbox live behind this
// one call; `queued` tells us which one actually happened.
import { recordItpResult } from '@/src/lib/itp/execution';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/** One row of nx_job_itp before it is narrowed onto the frozen ItpPoint. */
interface ItpRow {
  point_id: string;
  stage: string | null;
  sequence_no: number | null;
  point_type: string | null;
  title: string | null;
  requirement: string | null;
  acceptance_criteria: string | null;
  responsible_party: string | null;
  reference_document: string | null;
  blocks_progress: boolean | null;
  requires_signoff: boolean | null;
  result: string | null;
  inspector_id: string | null;
  recorded_at: string | null;
  signed_off_at: string | null;
  released_at: string | null;
  flash_report_id: string | null;
  is_blocking_now: boolean | null;
}

/** Visit context, read from the same canonical RPC JobVisitsPanel uses. */
interface ItpVisitOption {
  visitId: string;
  visitNumber: number;
  title: string | null;
  status: string;
}

/**
 * A result that went to the outbox instead of the server.
 *
 * Keyed per (point, visit) because the same point can carry one result at job
 * level and another on a specific visit — that is the whole point of visit
 * scoping, and collapsing them would show the wrong pending state.
 */
interface QueuedMark {
  result: ItpResult;
  at: number;
  visitId: string | null;
}

const RESULT_ICONS: Record<ItpResult, IoniconName> = {
  pending: 'ellipse-outline',
  passed: 'checkmark-circle',
  failed: 'close-circle',
  waived: 'remove-circle-outline',
  not_applicable: 'ban-outline',
};

const RESULT_COLORS: Record<ItpResult, string> = {
  pending: T.colors.textMuted,
  passed: T.colors.success,
  failed: T.colors.error,
  waived: '#F5A524',
  not_applicable: T.colors.textSecondary,
};

const POINT_TYPE_ICONS: Record<ItpPointType, IoniconName> = {
  normal: 'ellipse-outline',
  hold: 'lock-closed',
  witness: 'eye-outline',
  review: 'document-text-outline',
  surveillance: 'pulse-outline',
};

/** nx_job_itp row → the frozen ItpPoint. Unknown enum values narrow, never throw. */
export function mapItpRow(r: ItpRow): ItpPoint {
  return {
    pointId: String(r.point_id),
    stage: r.stage ?? '',
    sequenceNo: Number(r.sequence_no ?? 0),
    pointType: coerceItpPointType(r.point_type),
    title: r.title ?? 'Inspection point',
    requirement: r.requirement ?? null,
    acceptanceCriteria: r.acceptance_criteria ?? null,
    responsibleParty: r.responsible_party ?? null,
    referenceDocument: r.reference_document ?? null,
    blocksProgress: Boolean(r.blocks_progress),
    requiresSignoff: Boolean(r.requires_signoff),
    result: coerceItpResult(r.result),
    inspectorId: r.inspector_id ?? null,
    recordedAt: r.recorded_at ?? null,
    signedOffAt: r.signed_off_at ?? null,
    releasedAt: r.released_at ?? null,
    flashReportId: r.flash_report_id ?? null,
    // BACKEND TRUTH. Read, never recomputed.
    isBlockingNow: Boolean(r.is_blocking_now),
  };
}

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d);
  } catch {
    // Hermes' Intl is not guaranteed on every device; a timestamp must degrade,
    // not crash the panel an inspector is standing in front of.
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

export interface JobItpPanelProps {
  jobId: string;
  /** The signed-in user. Drives "you" attribution, never a fabricated name. */
  viewerId?: string | null;
  /** Advisory only — see the hold-release note below. */
  isAdmin?: boolean;
  clientId?: string | null;
  agencyId?: string | null;
}

export function JobItpPanel({
  jobId,
  viewerId = null,
  isAdmin = false,
  clientId = null,
  agencyId = null,
}: JobItpPanelProps) {
  const router = useRouter();

  const [points, setPoints] = useState<ItpPoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Multi-Visit context. NULL = job level, the same meaning
  // inspection_captures.visit_id carries.
  const [visits, setVisits] = useState<ItpVisitOption[]>([]);
  const [visitId, setVisitId] = useState<string | null>(null);

  // Multi-Inspector attribution. Names arrive already resolved under the
  // server's identity rules from nx_job_inspectors — this panel does no name
  // lookup of its own and invents nothing when the map has no entry.
  const [names, setNames] = useState<Record<string, string>>({});

  const [expanded, setExpanded] = useState<string | null>(null);
  const [queued, setQueued] = useState<Record<string, QueuedMark>>({});

  // Recording sheet
  const [sheetPoint, setSheetPoint] = useState<ItpPoint | null>(null);
  const [draftResult, setDraftResult] = useState<ItpResult>('passed');
  const [draftComments, setDraftComments] = useState('');
  const [draftWitness, setDraftWitness] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(ITP_RPC.jobItp, {
      p_job_id: jobId,
      p_visit_id: visitId,
    });

    if (rpcError) {
      // Not authorised is the normal case for someone merely browsing an open
      // job — that is not an error worth showing, so the panel hides itself.
      const notAuthorised = /not authorized|not authorised|42501/i.test(rpcError.message);
      setError(notAuthorised ? null : rpcError.message);
      setPoints(notAuthorised ? [] : null);
      setLoading(false);
      return;
    }

    const rows = ((data ?? []) as ItpRow[]).map(mapItpRow);
    setPoints(rows);
    setLoading(false);

    // A job with no scope template has no ITP at all — don't spend two more
    // round trips on context nobody will see.
    if (rows.length === 0) return;

    // Context reads are best-effort decoration. A refusal on either must not
    // remove the plan itself.
    void (async () => {
      const [teamRes, visitRes] = await Promise.all([
        supabase.rpc('nx_job_inspectors', { p_job_id: jobId }),
        supabase.rpc('nx_job_visits', { p_job_id: jobId }),
      ]);

      if (!teamRes.error) {
        const map: Record<string, string> = {};
        for (const m of (teamRes.data ?? []) as Array<Record<string, unknown>>) {
          const id = m.inspector_id ? String(m.inspector_id) : null;
          const name = (m.full_name as string | null) ?? null;
          if (id && name) map[id] = name;
        }
        setNames(map);
      }

      if (!visitRes.error) {
        const list = ((visitRes.data ?? []) as Array<Record<string, unknown>>)
          // The synthetic legacy row has no database identity, so a result can
          // never belong to it. Job level is what that job actually has.
          .filter((v) => v.visit_id != null && !v.from_fallback)
          .map((v) => ({
            visitId: String(v.visit_id),
            visitNumber: Number(v.visit_number ?? 0),
            title: (v.title as string | null) ?? null,
            status: (v.status as string | null) ?? 'scheduled',
          }))
          .sort((a, b) => a.visitNumber - b.visitNumber);
        setVisits(list);
      }
    })();
  }, [jobId, visitId]);

  useEffect(() => { void load(); }, [load]);

  // Drop a queued marker once the server has visibly caught up: the replayed
  // result is the live one AND was recorded no earlier than we queued it.
  useEffect(() => {
    if (!points || Object.keys(queued).length === 0) return;
    setQueued((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const p of points) {
        const key = `${p.pointId}|${visitId ?? 'job'}`;
        const q = next[key];
        if (!q) continue;
        const landed =
          p.result === q.result &&
          p.recordedAt != null &&
          new Date(p.recordedAt).getTime() >= q.at;
        if (landed) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [points, visitId, queued]);

  const grouped = useMemo(() => groupItpByStage(points ?? []), [points]);
  const progress = useMemo(() => itpProgress(points ?? []), [points]);

  /**
   * ADVISORY ONLY, and on this surface purely cosmetic.
   *
   * nx_itp_release_hold re-decides server-side and is the only authority; it
   * raises 42501 for anyone who is not an admin or the buyer. This flag decides
   * nothing but which sentence an inspector reads about who clears a hold — no
   * release control is drawn on the field surface either way, so UI state
   * cannot stand in for the backend rule.
   */
  const viewerMayRelease = canOfferHoldRelease({
    isAdmin,
    viewerId,
    clientId,
    agencyId,
  });

  const openSheet = useCallback((p: ItpPoint) => {
    setSheetPoint(p);
    setDraftResult(p.result === 'pending' ? 'passed' : p.result);
    setDraftComments('');
    setDraftWitness('');
    setSheetError(null);
  }, []);

  const witnessRequired = sheetPoint
    ? itpWitnessNameRequired(sheetPoint.pointType, draftResult)
    : false;

  const submit = useCallback(async () => {
    if (!sheetPoint || submitting) return;
    const witness = draftWitness.trim();
    if (itpWitnessNameRequired(sheetPoint.pointType, draftResult) && witness.length === 0) {
      // Mirrors the DB check so the field is marked required before the round
      // trip. The database still enforces it — this is not the rule.
      setSheetError('A witness point needs the name of who witnessed it.');
      return;
    }

    setSubmitting(true);
    setSheetError(null);
    const at = Date.now();
    const outcome = await recordItpResult({
      pointId: sheetPoint.pointId,
      jobId,
      visitId,
      result: draftResult,
      comments: draftComments.trim() || null,
      witnessedBy: witness || null,
    });
    setSubmitting(false);

    if (!outcome.ok) {
      // Surface the refusal. A 42501 from the RPC means the server said no, and
      // no amount of local state may paper over that.
      setSheetError(outcome.error ?? 'The result was not recorded. Nothing has changed.');
      return;
    }

    const key = `${sheetPoint.pointId}|${visitId ?? 'job'}`;
    if (outcome.queued) {
      // Saved to this device's outbox. It has NOT reached the server, so the
      // point keeps showing the server's last known result and picks up an
      // explicit pending-sync marker instead.
      setQueued((prev) => ({ ...prev, [key]: { result: draftResult, at, visitId } }));
      setNotice('Saved on this device. It will sync when you have signal.');
      setSheetPoint(null);
      return;
    }

    setQueued((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setNotice(null);
    setSheetPoint(null);
    // Re-read rather than patch locally: inspector attribution and the recorded
    // timestamp are the server's to state, never this client's to invent.
    await load();
  }, [sheetPoint, submitting, draftWitness, draftResult, draftComments, jobId, visitId, load]);

  // ── shell states ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.card}>
        <Header />
        <ActivityIndicator style={{ marginTop: 12 }} color={T.colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.card}>
        <Header />
        <Text style={s.error}>Could not load the inspection plan. {error}</Text>
        <TouchableOpacity onPress={() => void load()} style={s.retry} accessibilityRole="button">
          <Text style={s.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const all = points ?? [];
  // No plan attached (a quality job simply has no ITP), or not this viewer's to
  // see. Either way, render nothing rather than an empty "ITP" card.
  if (all.length === 0) return null;

  return (
    <View style={s.card}>
      <Header count={all.length} />

      <Text style={s.progress}>
        {progress.recorded} of {progress.total} recorded
        {progress.failed > 0 ? ` · ${progress.failed} failed` : ''}
        {progress.outstanding > 0 ? ` · ${progress.outstanding} outstanding` : ''}
      </Text>
      <View style={s.bar}>
        <View
          style={[
            s.barFill,
            { width: `${progress.total > 0 ? Math.round((progress.recorded / progress.total) * 100) : 0}%` },
          ]}
        />
      </View>

      {/* Blocking state is the database's answer, not ours. */}
      {progress.blocking > 0 && (
        <View style={s.holdBanner}>
          <Ionicons name="lock-closed" size={14} color="#F5A524" />
          <Text style={s.holdText}>
            {progress.blocking === 1 ? '1 point is holding work' : `${progress.blocking} points are holding work`}
            {'. '}
            {viewerMayRelease
              ? 'Release is an acceptance decision and is made on the admin surface, not here.'
              : 'Recording a result does not clear a hold — an admin or the buyer releases it.'}
          </Text>
        </View>
      )}

      {notice && (
        <View style={s.queueBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color={T.colors.primaryLight} />
          <Text style={s.queueBannerText}>{notice}</Text>
        </View>
      )}

      {/* ── Visit context. NULL = job level. ─────────────────────────────── */}
      {visits.length > 0 && (
        <View style={s.visitRow}>
          <Text style={s.visitLabel}>Recording against</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.visitChips}>
            <TouchableOpacity
              onPress={() => setVisitId(null)}
              style={[s.visitChip, visitId === null && s.visitChipOn]}
              accessibilityRole="button"
            >
              <Text style={[s.visitChipText, visitId === null && s.visitChipTextOn]}>Job level</Text>
            </TouchableOpacity>
            {visits.map((v) => (
              <TouchableOpacity
                key={v.visitId}
                onPress={() => setVisitId(v.visitId)}
                style={[s.visitChip, visitId === v.visitId && s.visitChipOn]}
                accessibilityRole="button"
              >
                <Text style={[s.visitChipText, visitId === v.visitId && s.visitChipTextOn]}>
                  Visit {v.visitNumber}
                  {v.title ? ` · ${v.title}` : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── The plan, in canonical stage/sequence order ──────────────────── */}
      {grouped.map((group) => (
        <View key={group.stage || 'unstaged'} style={s.stage}>
          <Text style={s.stageName}>{group.stage || 'Unstaged'}</Text>

          {group.points.map((p) => {
            const q = queued[`${p.pointId}|${visitId ?? 'job'}`];
            const isOpen = expanded === p.pointId;
            const when = formatWhen(p.recordedAt);
            const who =
              p.inspectorId == null
                ? null
                : p.inspectorId === viewerId
                  ? 'you'
                  : (names[p.inspectorId] ?? 'another inspector on this job');

            return (
              <View key={p.pointId} style={[s.point, p.isBlockingNow && s.pointBlocking]}>
                <TouchableOpacity
                  onPress={() => setExpanded(isOpen ? null : p.pointId)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  style={s.pointHead}
                >
                  <View style={s.pointMain}>
                    <Text style={s.pointTitle} numberOfLines={isOpen ? undefined : 2}>
                      {p.sequenceNo}. {p.title}
                    </Text>
                    <View style={s.chipLine}>
                      <View style={s.typeChip}>
                        <Ionicons
                          name={POINT_TYPE_ICONS[p.pointType]}
                          size={10}
                          color={T.colors.textSecondary}
                        />
                        <Text style={s.typeChipText}>{ITP_POINT_TYPE_LABELS[p.pointType]}</Text>
                      </View>
                      <View style={s.resultChip}>
                        <Ionicons name={RESULT_ICONS[p.result]} size={11} color={RESULT_COLORS[p.result]} />
                        <Text style={[s.resultChipText, { color: RESULT_COLORS[p.result] }]}>
                          {ITP_RESULT_LABELS[p.result]}
                        </Text>
                      </View>
                      {p.isBlockingNow && (
                        <View style={s.blockChip}>
                          <Ionicons name="lock-closed" size={10} color="#F5A524" />
                          <Text style={s.blockChipText}>Holding work</Text>
                        </View>
                      )}
                      {q && (
                        <View style={s.syncChip}>
                          <Ionicons name="cloud-offline-outline" size={10} color={T.colors.primaryLight} />
                          <Text style={s.syncChipText}>
                            {ITP_RESULT_LABELS[q.result]} · will sync
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <Ionicons
                    name={isOpen ? 'chevron-down' : 'chevron-forward'}
                    size={16}
                    color={T.colors.textMuted}
                  />
                </TouchableOpacity>

                {q && (
                  <Text style={s.syncNote}>
                    Saved on this device, not yet on the server. The result above is
                    still what the server last recorded.
                  </Text>
                )}

                {isOpen && (
                  <View style={s.detail}>
                    <Text style={s.meaning}>{ITP_POINT_TYPE_MEANING[p.pointType]}</Text>

                    {p.requirement && <Field label="Requirement" value={p.requirement} />}
                    {p.acceptanceCriteria && (
                      <Field label="Acceptance criteria" value={p.acceptanceCriteria} />
                    )}
                    {p.referenceDocument && (
                      <Field label="Reference document" value={p.referenceDocument} />
                    )}
                    {p.responsibleParty && (
                      <Field label="Responsible party" value={p.responsibleParty} />
                    )}
                    {p.requiresSignoff && (
                      <Field
                        label="Sign-off"
                        value="This point needs an attestation as well as a result."
                      />
                    )}

                    {/* History, as far as this read allows: the live result row
                        with the server's own attribution and timestamps. */}
                    {p.result !== 'pending' && (
                      <View style={s.history}>
                        <Ionicons name="time-outline" size={12} color={T.colors.textMuted} />
                        <Text style={s.historyText}>
                          {ITP_RESULT_LABELS[p.result]}
                          {who ? ` · recorded by ${who}` : ''}
                          {when ? ` · ${when}` : ''}
                          {p.signedOffAt ? ' · signed off' : ''}
                          {p.releasedAt ? ` · released ${formatWhen(p.releasedAt) ?? ''}` : ''}
                        </Text>
                      </View>
                    )}

                    {/* Evidence lives in the workflows this app already has.
                        No second capture surface is built here. */}
                    <View style={s.evidence}>
                      <Text style={s.evidenceLabel}>Evidence</Text>
                      <TouchableOpacity
                        style={s.evidenceBtn}
                        accessibilityRole="button"
                        onPress={() => router.push(`/(inspector)/jobs/${jobId}/submit-report` as never)}
                      >
                        <Ionicons name="camera-outline" size={13} color={T.colors.primaryLight} />
                        <Text style={s.evidenceBtnText}>Attach in the inspection report</Text>
                      </TouchableOpacity>
                      {p.flashReportId ? (
                        <TouchableOpacity
                          style={s.evidenceBtn}
                          accessibilityRole="button"
                          onPress={() =>
                            router.push(`/jobs/${jobId}/flash-reports/${p.flashReportId}` as never)
                          }
                        >
                          <Ionicons name="warning-outline" size={13} color={T.colors.error} />
                          <Text style={[s.evidenceBtnText, { color: T.colors.error }]}>
                            Open the NCR raised from this point
                          </Text>
                        </TouchableOpacity>
                      ) : p.result === 'failed' ? (
                        <TouchableOpacity
                          style={s.evidenceBtn}
                          accessibilityRole="button"
                          onPress={() => router.push(`/jobs/${jobId}/flash-reports/new` as never)}
                        >
                          <Ionicons name="warning-outline" size={13} color={T.colors.error} />
                          <Text style={[s.evidenceBtnText, { color: T.colors.error }]}>
                            Raise an NCR for this failure
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    <TouchableOpacity
                      style={s.recordBtn}
                      accessibilityRole="button"
                      onPress={() => openSheet(p)}
                    >
                      <Ionicons name="create-outline" size={14} color="#FFFFFF" />
                      <Text style={s.recordBtnText}>
                        {p.result === 'pending' ? 'Record result' : 'Update result'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ))}

      <Text style={s.footer}>
        Results are attributed to whoever records them and timestamped by the
        server. Recording a point moves no money.
      </Text>

      {/* ── Recording sheet ───────────────────────────────────────────────── */}
      <Modal
        visible={sheetPoint != null}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetPoint(null)}
      >
        <View style={s.sheetBackdrop}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle} numberOfLines={2}>
                {sheetPoint ? `${sheetPoint.sequenceNo}. ${sheetPoint.title}` : ''}
              </Text>
              <TouchableOpacity onPress={() => setSheetPoint(null)} accessibilityRole="button">
                <Ionicons name="close" size={20} color={T.colors.textMuted} />
              </TouchableOpacity>
            </View>

            {sheetPoint && (
              <Text style={s.sheetMeaning}>
                {ITP_POINT_TYPE_LABELS[sheetPoint.pointType]} ·{' '}
                {ITP_POINT_TYPE_MEANING[sheetPoint.pointType]}
              </Text>
            )}

            <Text style={s.sheetSubject}>
              {visitId
                ? `Visit ${visits.find((v) => v.visitId === visitId)?.visitNumber ?? ''}`.trim()
                : 'Job level (no specific visit)'}
            </Text>

            <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
              <Text style={s.fieldLabel}>Result</Text>
              {ITP_RESULTS.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[s.option, draftResult === r && s.optionOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: draftResult === r }}
                  onPress={() => setDraftResult(r)}
                >
                  <Ionicons name={RESULT_ICONS[r]} size={16} color={RESULT_COLORS[r]} />
                  <Text style={[s.optionText, draftResult === r && s.optionTextOn]}>
                    {ITP_RESULT_LABELS[r]}
                    {r === 'pending' ? ' — puts the point back to outstanding' : ''}
                  </Text>
                </TouchableOpacity>
              ))}

              {witnessRequired && (
                <>
                  <Text style={s.fieldLabel}>Witnessed by (required)</Text>
                  <TextInput
                    style={s.input}
                    value={draftWitness}
                    onChangeText={setDraftWitness}
                    placeholder="Name of the party who attended"
                    placeholderTextColor={T.colors.textMuted}
                  />
                </>
              )}

              <Text style={s.fieldLabel}>Comments</Text>
              <TextInput
                style={[s.input, s.inputMulti]}
                value={draftComments}
                onChangeText={setDraftComments}
                placeholder="What you observed, measured or referenced"
                placeholderTextColor={T.colors.textMuted}
                multiline
              />

              {sheetPoint?.blocksProgress && (
                <Text style={s.sheetNote}>
                  This point holds work. Recording a result here does not release
                  the hold — an admin or the buyer clears it.
                </Text>
              )}

              {sheetError && <Text style={s.error}>{sheetError}</Text>}
            </ScrollView>

            <TouchableOpacity
              style={[s.submit, submitting && s.submitBusy]}
              disabled={submitting}
              accessibilityRole="button"
              onPress={() => void submit()}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="checkmark" size={16} color="#FFFFFF" />
              )}
              <Text style={s.submitText}>{submitting ? 'Recording…' : 'Record result'}</Text>
            </TouchableOpacity>
            <Text style={s.sheetFoot}>
              Your name and the time are stamped by the server. Offline, this is
              held on the device and replayed when signal returns.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Header({ count }: { count?: number }) {
  return (
    <View style={s.headerRow}>
      <Ionicons name="clipboard-outline" size={16} color={T.colors.textMuted} />
      <Text style={s.header}>
        Inspection & Test Plan{count && count > 0 ? ` · ${count}` : ''}
      </Text>
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldName}>{label}</Text>
      <Text style={s.fieldValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: T.colors.cardBackground,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: T.colors.inputBorder,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  header: { color: T.colors.text, fontSize: 14, fontWeight: '700' },

  progress: { color: T.colors.textMuted, fontSize: 11, marginTop: 10 },
  bar: {
    height: 3,
    borderRadius: 999,
    backgroundColor: T.colors.inputBorder,
    marginTop: 6,
    overflow: 'hidden',
  },
  barFill: { height: 3, borderRadius: 999, backgroundColor: T.colors.success },

  holdBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(245,165,36,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(245,165,36,0.35)',
  },
  holdText: { color: '#F5A524', fontSize: 11, lineHeight: 16, flexShrink: 1 },

  queueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 8,
    padding: 9,
    borderRadius: 10,
    backgroundColor: 'rgba(124,58,237,0.10)',
  },
  queueBannerText: { color: T.colors.primaryLight, fontSize: 11, flexShrink: 1 },

  visitRow: { marginTop: 12 },
  visitLabel: {
    color: T.colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  visitChips: { flexDirection: 'row', gap: 6, paddingVertical: 7 },
  visitChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: T.colors.inputBorder,
    backgroundColor: T.colors.inputBackground,
  },
  visitChipOn: { borderColor: T.colors.primary, backgroundColor: 'rgba(124,58,237,0.16)' },
  visitChipText: { color: T.colors.textSecondary, fontSize: 11, fontWeight: '600' },
  visitChipTextOn: { color: T.colors.text },

  stage: { marginTop: 14 },
  stageName: {
    color: T.colors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  point: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.colors.inputBorder,
    backgroundColor: T.colors.inputBackground,
    padding: 10,
  },
  pointBlocking: { borderColor: 'rgba(245,165,36,0.45)' },
  pointHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  pointMain: { flexShrink: 1, flexGrow: 1 },
  pointTitle: { color: T.colors.text, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  chipLine: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 },

  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(148,163,184,0.12)',
  },
  typeChipText: { color: T.colors.textSecondary, fontSize: 10, fontWeight: '700' },
  resultChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  resultChipText: { fontSize: 10, fontWeight: '700' },
  blockChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(245,165,36,0.14)',
  },
  blockChipText: { color: '#F5A524', fontSize: 10, fontWeight: '700' },
  syncChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(124,58,237,0.16)',
  },
  syncChipText: { color: T.colors.primaryLight, fontSize: 10, fontWeight: '700' },
  syncNote: { color: T.colors.primaryLight, fontSize: 10, lineHeight: 15, marginTop: 6 },

  detail: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: T.colors.inputBorder,
  },
  meaning: { color: T.colors.textSecondary, fontSize: 11, lineHeight: 16, fontStyle: 'italic' },
  field: { marginTop: 9 },
  fieldName: {
    color: T.colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  fieldValue: { color: T.colors.text, fontSize: 12, lineHeight: 17, marginTop: 2 },

  history: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 10 },
  historyText: { color: T.colors.textMuted, fontSize: 10.5, lineHeight: 15, flexShrink: 1 },

  evidence: { marginTop: 10 },
  evidenceLabel: {
    color: T.colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  evidenceBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  evidenceBtnText: { color: T.colors.primaryLight, fontSize: 11.5, fontWeight: '600' },

  recordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: T.colors.primary,
  },
  recordBtnText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '700' },

  footer: { color: T.colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 14 },

  sheetBackdrop: { flex: 1, backgroundColor: T.colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: T.colors.cardBackground,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    borderColor: T.colors.inputBorder,
    padding: 16,
    paddingBottom: 26,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  sheetTitle: { color: T.colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  sheetMeaning: { color: T.colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 6 },
  sheetSubject: { color: T.colors.textMuted, fontSize: 10.5, marginTop: 4 },

  fieldLabel: {
    color: T.colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginTop: 14,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 7,
    paddingVertical: 10,
    paddingHorizontal: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.colors.inputBorder,
    backgroundColor: T.colors.inputBackground,
  },
  optionOn: { borderColor: T.colors.primary, backgroundColor: 'rgba(124,58,237,0.14)' },
  optionText: { color: T.colors.textSecondary, fontSize: 12.5, fontWeight: '600', flexShrink: 1 },
  optionTextOn: { color: T.colors.text },

  input: {
    marginTop: 7,
    borderWidth: 1,
    borderColor: T.colors.inputBorder,
    backgroundColor: T.colors.inputBackground,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 10,
    color: T.colors.text,
    fontSize: 13,
  },
  inputMulti: { minHeight: 78, textAlignVertical: 'top' },

  sheetNote: { color: '#F5A524', fontSize: 10.5, lineHeight: 15, marginTop: 12 },
  sheetFoot: { color: T.colors.textMuted, fontSize: 10, lineHeight: 14, marginTop: 10 },

  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 14,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: T.colors.primary,
  },
  submitBusy: { opacity: 0.6 },
  submitText: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '800' },

  error: { color: T.colors.error, fontSize: 12, marginTop: 10 },
  retry: { marginTop: 8, alignSelf: 'flex-start' },
  retryText: { color: T.colors.primary, fontSize: 12, fontWeight: '700' },
});

export default JobItpPanel;
