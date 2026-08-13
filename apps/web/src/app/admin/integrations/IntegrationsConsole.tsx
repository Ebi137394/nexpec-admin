'use client';
// ════════════════════════════════════════════════════════════════════════════
//  app/admin/integrations/IntegrationsConsole.tsx — ERP Integration Core console
//
//  Recovered file. page.tsx imported and rendered <IntegrationsConsole/> but the
//  component itself was never written (the lane stopped mid-write), so the route
//  did not compile. Props here match page.tsx's call site exactly.
//
//  TWO RULES THIS FILE EXISTS TO HONOUR
//
//  1. RAW TENANT PAYLOADS ARE NEVER RENDERED. Only the dead-letter queue carries
//     `payload` at all, and it goes through redactPayload() from ./contract
//     before a single key reaches the DOM. Redaction is allowlist-shaped: a key
//     is shown only if the ACTIVE mapping version maps it. Anything unmapped, and
//     anything on the direction deny-list or the ERP money list, is withheld and
//     COUNTED — "redacted" must never read as "empty".
//
//  2. REPLAY IS DESCRIBED, NOT GUESSED. replayVerdict() is the same status→effect
//     table the claim RPC uses, so the operator is told whether a redelivery would
//     change state before they act. This console does not itself replay anything:
//     it has no write path, by design.
//
//  No money is displayed anywhere on this surface, and no control here settles,
//  pays or refunds. ERP sync is operational, never financial.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import {
  redactPayload,
  replayVerdict,
  shortDigest,
  type OrgKind,
} from './contract';
import type {
  ConnectorRow,
  ConnectorHealthRow,
  EntitySyncRow,
  MessageRow,
  DeadLetterRow,
  MappingVersionRow,
  FieldMappingRow,
  CanonicalEntityRow,
  CanonicalFieldRow,
  RecordLinkRow,
  OrgRow,
} from './page';

type TabId = 'health' | 'messages' | 'deadletters' | 'mappings' | 'canonical';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'health', label: 'Connector health' },
  { id: 'messages', label: 'Recent messages' },
  { id: 'deadletters', label: 'Dead letters' },
  { id: 'mappings', label: 'Mappings' },
  { id: 'canonical', label: 'Canonical model' },
];

const CARD = 'rounded-2xl border border-white/10 bg-white/[0.02] p-4';
const TH = 'py-2 pr-4 text-left text-[11px] uppercase tracking-wide text-zinc-500';
const TD = 'py-2.5 pr-4 text-xs text-zinc-300 align-top';

function fmt(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function statusTone(status: string): string {
  switch (status) {
    case 'completed':
    case 'active':
      return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300';
    case 'dead_letter':
    case 'rejected':
    case 'revoked':
      return 'border-rose-400/30 bg-rose-500/10 text-rose-300';
    case 'retrying':
    case 'in_flight':
    case 'pending':
      return 'border-amber-400/30 bg-amber-500/10 text-amber-300';
    default:
      return 'border-white/10 bg-white/5 text-zinc-400';
  }
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] ${
        tone ?? 'border-white/10 bg-white/5 text-zinc-400'
      }`}
    >
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-8 text-center text-xs text-zinc-500">{children}</p>
  );
}

export function IntegrationsConsole({
  connectors,
  health,
  entitySync,
  messages,
  deadLetters,
  versions,
  fieldMappings,
  canonicalEntities,
  canonicalFields,
  links,
  organizations,
}: {
  connectors: ConnectorRow[];
  health: ConnectorHealthRow[];
  entitySync: EntitySyncRow[];
  messages: MessageRow[];
  deadLetters: DeadLetterRow[];
  versions: MappingVersionRow[];
  fieldMappings: FieldMappingRow[];
  canonicalEntities: CanonicalEntityRow[];
  canonicalFields: CanonicalFieldRow[];
  links: RecordLinkRow[];
  organizations: OrgRow[];
}) {
  const [tab, setTab] = useState<TabId>('health');
  const [orgScope, setOrgScope] = useState<string>('all');

  const orgById = useMemo(() => {
    const m: Record<string, OrgRow> = {};
    for (const o of organizations) m[o.id] = o;
    return m;
  }, [organizations]);

  const inScope = <T extends { organization_id: string }>(rows: T[]): T[] =>
    orgScope === 'all' ? rows : rows.filter((r) => r.organization_id === orgScope);

  const scopedHealth = inScope(health);
  const scopedMessages = inScope(messages);
  const scopedDead = inScope(deadLetters);
  const scopedLinks = inScope(links);
  const scopedEntitySync = inScope(entitySync);

  /**
   * External field names the ACTIVE mapping version allows through, per
   * connector+entity. This is the allowlist redactPayload() checks against — an
   * unmapped key is never rendered, so a tenant cannot smuggle a field onto this
   * screen simply by sending it.
   */
  const mappedFieldsFor = useMemo(() => {
    const versionById: Record<string, MappingVersionRow> = {};
    for (const v of versions) versionById[v.id] = v;

    const byKey: Record<string, Set<string>> = {};
    for (const fm of fieldMappings) {
      const v = versionById[fm.version_id];
      if (!v || v.status !== 'active') continue;
      const key = `${v.connector_id}::${v.entity_type}`;
      (byKey[key] ??= new Set<string>()).add(fm.external_field);
    }
    return byKey;
  }, [versions, fieldMappings]);

  const totals = useMemo(() => {
    let dead = 0;
    let inFlight = 0;
    let conflicts = 0;
    for (const h of scopedHealth) {
      dead += h.dead_letter_count;
      inFlight += h.in_flight_count + h.retrying_count;
      conflicts += h.payload_conflict_count;
    }
    return { dead, inFlight, conflicts };
  }, [scopedHealth]);

  return (
    <section className="space-y-4">
      {/* ── Scope + headline counters ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label
            htmlFor="erp-org-scope"
            className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500"
          >
            Organization
          </label>
          <select
            id="erp-org-scope"
            value={orgScope}
            onChange={(e) => setOrgScope(e.target.value)}
            className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            <option value="all">All organizations</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.kind})
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2" role="status" aria-live="polite">
          <Chip tone={totals.dead ? statusTone('dead_letter') : undefined}>
            {totals.dead} dead-lettered
          </Chip>
          <Chip tone={totals.inFlight ? statusTone('retrying') : undefined}>
            {totals.inFlight} in flight
          </Chip>
          <Chip tone={totals.conflicts ? statusTone('rejected') : undefined}>
            {totals.conflicts} payload conflicts
          </Chip>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div role="tablist" aria-label="Integration views" className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`erp-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`erp-panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
              tab === t.id
                ? 'border-sky-400/40 bg-sky-500/10 text-sky-200'
                : 'border-white/10 text-zinc-400 hover:bg-white/5'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Health ────────────────────────────────────────────────────────── */}
      {tab === 'health' && (
        <div
          role="tabpanel"
          id="erp-panel-health"
          aria-labelledby="erp-tab-health"
          className={CARD}
        >
          {scopedHealth.length === 0 ? (
            <Empty>
              No connectors are configured for this scope. A connector is created
              per organization and adapter.
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className={TH}>Connector</th>
                    <th className={TH}>Adapter</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Total</th>
                    <th className={TH}>Done</th>
                    <th className={TH}>In flight</th>
                    <th className={TH}>Dead</th>
                    <th className={TH}>Last success</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedHealth.map((h) => (
                    <tr key={h.connector_id} className="border-b border-white/5">
                      <td className={TD}>
                        <span className="text-zinc-200">{h.display_name}</span>
                        <span className="block text-[11px] text-zinc-500">
                          {h.slug} · {orgById[h.organization_id]?.name ?? 'unknown org'}
                        </span>
                      </td>
                      <td className={TD}>{h.adapter_kind}</td>
                      <td className={TD}>
                        <Chip tone={statusTone(h.connector_status)}>
                          {h.connector_status}
                        </Chip>
                      </td>
                      <td className={TD}>{h.total_messages}</td>
                      <td className={TD}>{h.completed_count}</td>
                      <td className={TD}>{h.in_flight_count + h.retrying_count}</td>
                      <td className={TD}>
                        {h.dead_letter_count > 0 ? (
                          <span className="text-rose-300">{h.dead_letter_count}</span>
                        ) : (
                          0
                        )}
                      </td>
                      <td className={TD}>{fmt(h.last_success_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {scopedEntitySync.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
                By entity type
              </h3>
              <div className="flex flex-wrap gap-2">
                {scopedEntitySync.map((e) => (
                  <Chip key={`${e.connector_id}-${e.entity_type}`}>
                    {e.entity_type}: {e.completed_count}/{e.total_messages}
                    {e.dead_letter_count > 0 && (
                      <span className="ml-1 text-rose-300">
                        · {e.dead_letter_count} dead
                      </span>
                    )}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Recent messages ───────────────────────────────────────────────── */}
      {tab === 'messages' && (
        <div
          role="tabpanel"
          id="erp-panel-messages"
          aria-labelledby="erp-tab-messages"
          className={CARD}
        >
          <p className="mb-3 text-[11px] text-zinc-500">
            Payload bodies are deliberately not selected for this list — only the
            digest. Use the dead-letter queue to diagnose a failure.
          </p>
          {scopedMessages.length === 0 ? (
            <Empty>No messages received yet for this scope.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className={TH}>External ID</th>
                    <th className={TH}>Entity</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Attempts</th>
                    <th className={TH}>Digest</th>
                    <th className={TH}>Replay effect</th>
                    <th className={TH}>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedMessages.map((m) => {
                    const v = replayVerdict(m.status);
                    return (
                      <tr key={m.id} className="border-b border-white/5">
                        <td className={TD}>
                          <span className="font-mono text-[11px]">{m.external_id}</span>
                          {m.replay_count > 0 && (
                            <span className="block text-[11px] text-zinc-500">
                              replayed {m.replay_count}× · {fmt(m.last_replayed_at)}
                            </span>
                          )}
                        </td>
                        <td className={TD}>{m.entity_type}</td>
                        <td className={TD}>
                          <Chip tone={statusTone(m.status)}>{m.status}</Chip>
                        </td>
                        <td className={TD}>{m.attempts}</td>
                        <td className={TD}>
                          <span className="font-mono text-[11px] text-zinc-500">
                            {shortDigest(m.payload_digest)}
                          </span>
                          {m.payload_conflict_count > 0 && (
                            <span className="block text-[11px] text-amber-300">
                              {m.payload_conflict_count} conflict
                              {m.payload_conflict_count === 1 ? '' : 's'}
                            </span>
                          )}
                        </td>
                        <td className={TD}>
                          <span
                            className={
                              v.wouldChangeState ? 'text-amber-300' : 'text-zinc-400'
                            }
                          >
                            {v.wouldChangeState ? 'would change state' : 'no-op'}
                          </span>
                          <span className="block text-[11px] text-zinc-500">
                            {v.explanation}
                          </span>
                        </td>
                        <td className={TD}>{fmt(m.received_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Dead letters ──────────────────────────────────────────────────── */}
      {tab === 'deadletters' && (
        <div
          role="tabpanel"
          id="erp-panel-deadletters"
          aria-labelledby="erp-tab-deadletters"
          className={CARD}
        >
          {scopedDead.length === 0 ? (
            <Empty>
              No dead-lettered messages. A message dead-letters once it exhausts
              its connector&rsquo;s retry budget.
            </Empty>
          ) : (
            <ul className="space-y-3">
              {scopedDead.map((d) => {
                const org = orgById[d.organization_id];
                const kind: OrgKind | null =
                  org?.kind === 'enterprise' || org?.kind === 'agency'
                    ? (org.kind as OrgKind)
                    : null;
                const allow =
                  mappedFieldsFor[`${d.connector_id}::${d.entity_type}`] ??
                  new Set<string>();
                const red = redactPayload(d.payload, allow, kind);
                const v = replayVerdict(d.status);

                return (
                  <li
                    key={d.message_id}
                    className="rounded-xl border border-rose-400/20 bg-rose-500/[0.04] p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={statusTone(d.status)}>{d.status}</Chip>
                      <span className="font-mono text-[11px] text-zinc-300">
                        {d.external_id}
                      </span>
                      <span className="text-[11px] text-zinc-500">
                        {d.connector_slug} · {d.entity_type} · {d.attempts} attempts
                      </span>
                      <span className="ml-auto text-[11px] text-zinc-500">
                        {fmt(d.dead_lettered_at)}
                      </span>
                    </div>

                    {d.last_error && (
                      <p className="mt-2 rounded-lg bg-black/30 px-2.5 py-1.5 font-mono text-[11px] text-rose-200">
                        {d.last_error}
                      </p>
                    )}

                    <p className="mt-2 text-[11px] text-zinc-500">
                      Replay: {v.explanation}
                      {!v.operatorReplayable && ' — the replay RPC would refuse this message.'}
                    </p>

                    {/* Redacted payload. Never raw. */}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-zinc-400 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400">
                        Payload ({red.shown.length} shown
                        {red.withheldUnmapped + red.withheldCommercial.length > 0 &&
                          `, ${red.withheldUnmapped + red.withheldCommercial.length} withheld`}
                        )
                      </summary>
                      <div className="mt-2 space-y-1">
                        {red.noMappingKnown && (
                          <p className="text-[11px] text-amber-300">
                            No active mapping version for this connector and entity, so
                            nothing can be allowlisted — every key is withheld.
                          </p>
                        )}
                        {red.shown.map((kv) => (
                          <div key={kv.key} className="flex gap-2 font-mono text-[11px]">
                            <span className="text-zinc-500">{kv.key}</span>
                            <span className="text-zinc-300">{kv.value}</span>
                          </div>
                        ))}
                        {red.withheldUnmapped > 0 && (
                          <p className="text-[11px] text-zinc-500">
                            {red.withheldUnmapped} unmapped key
                            {red.withheldUnmapped === 1 ? '' : 's'} withheld.
                          </p>
                        )}
                        {red.withheldCommercial.length > 0 && (
                          <p className="text-[11px] text-amber-300">
                            Withheld as commercial: {red.withheldCommercial.join(', ')}
                          </p>
                        )}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* ── Mappings ──────────────────────────────────────────────────────── */}
      {tab === 'mappings' && (
        <div
          role="tabpanel"
          id="erp-panel-mappings"
          aria-labelledby="erp-tab-mappings"
          className={CARD}
        >
          {versions.length === 0 ? (
            <Empty>No mapping versions defined.</Empty>
          ) : (
            <ul className="space-y-3">
              {versions.map((v) => {
                const fields = fieldMappings.filter((f) => f.version_id === v.id);
                return (
                  <li key={v.id} className="rounded-xl border border-white/10 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={statusTone(v.status)}>{v.status}</Chip>
                      <span className="text-sm text-zinc-200">
                        {v.entity_type} v{v.version}
                      </span>
                      <span className="ml-auto text-[11px] text-zinc-500">
                        activated {fmt(v.activated_at)}
                        {v.retired_at && ` · retired ${fmt(v.retired_at)}`}
                      </span>
                    </div>
                    {v.notes && (
                      <p className="mt-1 text-[11px] text-zinc-500">{v.notes}</p>
                    )}
                    {fields.length === 0 ? (
                      <p className="mt-2 text-[11px] text-zinc-500">
                        No field mappings — every inbound key would be withheld.
                      </p>
                    ) : (
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full min-w-[36rem] text-sm">
                          <thead>
                            <tr className="border-b border-white/10">
                              <th className={TH}>External field</th>
                              <th className={TH}>Canonical field</th>
                              <th className={TH}>Transform</th>
                              <th className={TH}>Default</th>
                            </tr>
                          </thead>
                          <tbody>
                            {fields.map((f) => (
                              <tr key={f.id} className="border-b border-white/5">
                                <td className={`${TD} font-mono text-[11px]`}>
                                  {f.external_field}
                                </td>
                                <td className={`${TD} font-mono text-[11px]`}>
                                  {f.canonical_field}
                                </td>
                                <td className={TD}>{f.transform}</td>
                                <td className={TD}>{f.default_value ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* ── Canonical model + record links ────────────────────────────────── */}
      {tab === 'canonical' && (
        <div
          role="tabpanel"
          id="erp-panel-canonical"
          aria-labelledby="erp-tab-canonical"
          className={`${CARD} space-y-5`}
        >
          <div>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
              Canonical entities
            </h3>
            {canonicalEntities.length === 0 ? (
              <Empty>No canonical entities registered.</Empty>
            ) : (
              <ul className="space-y-2">
                {canonicalEntities.map((e) => (
                  <li key={e.entity_type} className="rounded-xl border border-white/10 p-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm text-zinc-200">{e.label}</span>
                      <span className="font-mono text-[11px] text-zinc-500">
                        {e.entity_type}
                      </span>
                    </div>
                    {e.description && (
                      <p className="mt-1 text-[11px] text-zinc-500">{e.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {canonicalFields
                        .filter((f) => f.entity_type === e.entity_type)
                        .map((f) => (
                          <Chip key={`${f.entity_type}-${f.canonical_field}`}>
                            {f.canonical_field}
                            <span className="ml-1 text-zinc-500">{f.data_type}</span>
                            {f.is_required && (
                              <span className="ml-1 text-amber-300">required</span>
                            )}
                          </Chip>
                        ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
              Record links
            </h3>
            {scopedLinks.length === 0 ? (
              <Empty>
                No external record has been bound to an internal row yet.
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className={TH}>Entity</th>
                      <th className={TH}>External ref</th>
                      <th className={TH}>Internal</th>
                      <th className={TH}>Bound</th>
                      <th className={TH}>Last synced</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scopedLinks.map((l) => (
                      <tr key={l.id} className="border-b border-white/5">
                        <td className={TD}>{l.entity_type}</td>
                        <td className={`${TD} font-mono text-[11px]`}>
                          {l.external_ref}
                        </td>
                        <td className={TD}>
                          {l.internal_table && l.internal_id ? (
                            <span className="font-mono text-[11px]">
                              {l.internal_table}/{l.internal_id.slice(0, 8)}
                            </span>
                          ) : (
                            <span className="text-zinc-600">unbound</span>
                          )}
                        </td>
                        <td className={TD}>{fmt(l.bound_at)}</td>
                        <td className={TD}>{fmt(l.last_synced_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
