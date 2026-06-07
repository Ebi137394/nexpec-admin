// ════════════════════════════════════════════════════════════════════════════
//  components/flash-reports/FlashReportCard.tsx — one NCR, all parties.
//
//  Pure server component. Reuses the existing portal visual language only:
//  ink/violet/cyan-glow/accent-* tokens, the rounded-xl card shell, the Pill
//  treatment, and <form action> transitions (no client JS). NO new patterns.
//
//  Identity-safe: shows reporter ROLE ("Inspector"), never a name — anti-poaching
//  is unaffected. Transition buttons are gated by legalTransitions(); the server
//  RPC re-enforces the state machine and role rules.
// ════════════════════════════════════════════════════════════════════════════

import { Clock, MapPin, Paperclip, FileText, ShieldAlert } from 'lucide-react';
import { transitionFlashReport } from '@/lib/actions/flashReports';
import {
  legalTransitions,
  CATEGORY_LABEL,
  SEVERITY_LABEL,
  STATUS_LABEL,
  REPORTER_ROLE_LABEL,
  type FlashReportView,
  type FlashReportSeverity,
  type FlashReportStatus,
  type FlashReportViewerRole,
} from '@/lib/data/flashReports';

type PillTone = 'cyan' | 'violet' | 'green' | 'amber' | 'red' | 'zinc';

const SEVERITY_TONE: Record<FlashReportSeverity, PillTone> = {
  observation: 'zinc',
  minor: 'cyan',
  major: 'amber',
  critical: 'red',
};

const STATUS_TONE: Record<FlashReportStatus, PillTone> = {
  open: 'red',
  acknowledged: 'amber',
  in_remediation: 'cyan',
  resolved: 'green',
  closed: 'zinc',
  disputed: 'red',
};

const SEVERITY_BORDER: Record<FlashReportSeverity, string> = {
  observation: 'border-l-white/20',
  minor: 'border-l-cyan-glow/50',
  major: 'border-l-accent-amber/60',
  critical: 'border-l-accent-red/70',
};

function Pill({ label, tone }: { label: string; tone: PillTone }) {
  const classes: Record<PillTone, string> = {
    cyan: 'border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow',
    violet: 'border-violet/30 bg-violet/10 text-violet-glow',
    green: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
    amber: 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber',
    red: 'border-accent-red/30 bg-accent-red/10 text-accent-red',
    zinc: 'border-white/[0.06] bg-white/[0.04] text-zinc-400',
  };
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${classes[tone]}`}
    >
      {label}
    </span>
  );
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function FlashReportCard({
  report,
  viewerId,
  viewerRole,
  portal,
  jobId,
}: {
  report: FlashReportView;
  viewerId: string | null;
  viewerRole: FlashReportViewerRole;
  portal: 'inspector' | 'admin' | 'client';
  jobId: string;
}) {
  const callerIsReporter = !!viewerId && report.reporterId === viewerId;
  const transitions = legalTransitions({
    current: report.status,
    callerRoleOnJob: viewerRole,
    callerIsReporter,
  });

  const photos = report.attachments.filter((a) => a.kind === 'photo');
  const docs = report.attachments.filter((a) => a.kind !== 'photo');

  return (
    <article
      className={`rounded-xl border border-l-2 border-white/[0.06] bg-white/[0.02] p-4 ${SEVERITY_BORDER[report.severity]}`}
    >
      {/* Header: severity + status + category */}
      <div className="flex flex-wrap items-center gap-2">
        <Pill
          label={SEVERITY_LABEL[report.severity]}
          tone={SEVERITY_TONE[report.severity]}
        />
        <Pill label={STATUS_LABEL[report.status]} tone={STATUS_TONE[report.status]} />
        <span className="inline-flex items-center rounded-full border border-violet/30 bg-violet/10 px-2 py-0.5 text-[10px] font-medium text-violet-glow">
          {CATEGORY_LABEL[report.category]}
        </span>
      </div>

      {/* Title + description */}
      <h3 className="mt-3 font-display text-base font-semibold tracking-tight text-white">
        {report.title}
      </h3>
      <p className="mt-1.5 whitespace-pre-line text-pretty text-sm leading-relaxed text-zinc-300">
        {report.description}
      </p>

      {/* Critical attention strip */}
      {report.severity === 'critical' && report.status === 'open' && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <p className="leading-relaxed">
            Critical non-conformance. Acknowledge and triage as a priority.
          </p>
        </div>
      )}

      {/* Meta */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-3 w-3" strokeWidth={1.75} />
          Raised {fmtTime(report.createdAt)}
        </span>
        <span>
          by{' '}
          <span className="text-zinc-300">
            {REPORTER_ROLE_LABEL[report.reporterRole]}
          </span>
        </span>
        {report.locationText && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3 w-3" strokeWidth={1.75} />
            {report.locationText}
          </span>
        )}
      </div>

      {/* Resolution notes, if resolved */}
      {report.resolutionNotes && (
        <p className="mt-2 rounded-lg border border-accent-green/20 bg-accent-green/[0.05] px-3 py-2 text-xs text-zinc-300">
          <span className="font-semibold text-accent-green">Resolution: </span>
          {report.resolutionNotes}
        </p>
      )}

      {/* Evidence */}
      {report.attachments.length > 0 && (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            <Paperclip className="h-3 w-3" strokeWidth={2} />
            Evidence, {report.attachments.length}
          </p>
          {photos.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {photos.map((a) =>
                a.signedUrl ? (
                  <a
                    key={a.id}
                    href={a.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="group block h-16 w-16 overflow-hidden rounded-lg border border-white/[0.08]"
                  >
                    <img
                      src={a.signedUrl}
                      alt={a.caption ?? 'Evidence photo'}
                      className="h-full w-full object-cover transition group-hover:opacity-80"
                    />
                  </a>
                ) : (
                  <span
                    key={a.id}
                    className="flex h-16 w-16 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.02] text-[9px] text-zinc-600"
                  >
                    unavailable
                  </span>
                ),
              )}
            </div>
          )}
          {docs.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {docs.map((a) =>
                a.signedUrl ? (
                  <a
                    key={a.id}
                    href={a.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-medium text-zinc-300 transition hover:border-violet/40 hover:text-white"
                  >
                    <FileText className="h-3 w-3" strokeWidth={2} />
                    {a.caption ?? (a.kind === 'pdf' ? 'PDF document' : 'Document')}
                  </a>
                ) : (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1 text-[11px] text-zinc-600"
                  >
                    <FileText className="h-3 w-3" strokeWidth={2} />
                    unavailable
                  </span>
                ),
              )}
            </div>
          )}
        </div>
      )}

      {/* Transitions — gated by role + state machine */}
      {transitions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
          {transitions.map((t) => (
            <form key={t.to} action={transitionFlashReport}>
              <input type="hidden" name="reportId" value={report.id} />
              <input type="hidden" name="toStatus" value={t.to} />
              <input type="hidden" name="portal" value={portal} />
              <input type="hidden" name="jobId" value={jobId} />
              <button
                type="submit"
                className={
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-industrial transition ' +
                  (t.destructive
                    ? 'border-accent-red/40 bg-accent-red/10 text-accent-red hover:bg-accent-red/15'
                    : 'border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20')
                }
              >
                {t.label}
              </button>
            </form>
          ))}
        </div>
      )}
    </article>
  );
}
