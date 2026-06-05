// ════════════════════════════════════════════════════════════════════════════
//  components/forms/InspectionModePicker.tsx
//
//  Two-card radio for inspection_type ∈ {'quality', 'compliance'}, plus a
//  conditional sub-form revealed only in compliance mode (scope template
//  picker + claimed_address_text). When 'quality' is selected, the
//  compliance fields are not rendered, so they don't submit values and
//  the DB CHECK `jobs_compliance_requires_template` is satisfied.
//
//  Mirrors the mobile app/post-compliance-job.tsx contract exactly:
//    inspection_type      → form name "inspectionType"
//    scope_template_id    → form name "scopeTemplateId"
//    claimed_address_text → form name "claimedAddressText"
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useState } from 'react';
import { ShieldCheck, Wrench } from 'lucide-react';
import {
  CCI_TIER_LABELS,
  type InspectionTypeKind,
  type ScopeTemplate,
} from '@/lib/data/scopeTemplates.types';

interface Props {
  templates: ScopeTemplate[];
  /** Override for echo-on-error rerenders. */
  initialMode?: InspectionTypeKind;
  initialTemplateId?: string;
  initialAddress?: string;
}

export function InspectionModePicker({
  templates,
  initialMode = 'quality',
  initialTemplateId = '',
  initialAddress = '',
}: Props) {
  const [mode, setMode] = useState<InspectionTypeKind>(initialMode);
  const [templateId, setTemplateId] = useState(initialTemplateId);

  const selectedTemplate = templates.find((t) => t.id === templateId);

  return (
    <>
      {/* ── Mode picker ─────────────────────────────────────────────── */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <header className="mb-6">
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Inspection mode
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Compliance jobs route to CCI-credentialed inspectors and produce
            a regulator-grade affidavit. Quality jobs follow the standard
            marketplace flow.
          </p>
        </header>

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <legend className="sr-only">Inspection mode</legend>
          <ModeCard
            value="quality"
            checked={mode === 'quality'}
            onChange={() => setMode('quality')}
            title="Quality inspection"
            blurb="Standard inspection. Open to all vetted inspectors. Released on a signed report."
            icon={<Wrench className="h-5 w-5" strokeWidth={1.75} />}
          />
          <ModeCard
            value="compliance"
            checked={mode === 'compliance'}
            onChange={() => setMode('compliance')}
            title="Compliance / CCI inspection"
            blurb="CCI-certified inspectors only. Trust-grade affidavit + public verifier."
            icon={<ShieldCheck className="h-5 w-5" strokeWidth={1.75} />}
          />
        </fieldset>
      </section>

      {/* ── Compliance sub-form (only when mode=compliance) ─────────── */}
      {mode === 'compliance' && (
        <section className="rounded-3xl border border-violet/30 bg-violet/[0.04] p-6 sm:p-8">
          <header className="mb-6">
            <h2 className="font-display text-lg font-semibold tracking-tight text-white">
              Compliance scope
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Pick the admin-curated scope template. The selected template
              determines which CCI tier is eligible to bid and which evidence
              an inspector must capture on-site.
            </p>
          </header>

          {templates.length === 0 ? (
            <div className="rounded-2xl border border-accent-amber/30 bg-accent-amber/10 p-4 text-sm text-accent-amber">
              No active scope templates available. Contact support so admin
              can publish one for your region.
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <label
                  htmlFor="scopeTemplateId"
                  className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
                >
                  Scope template <span className="ml-1 text-violet-glow">*</span>
                </label>
                <select
                  id="scopeTemplateId"
                  name="scopeTemplateId"
                  required
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
                >
                  <option value="" disabled>
                    Select a template…
                  </option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id} className="bg-ink-900">
                      {t.name}, {CCI_TIER_LABELS[t.requiresCredentialTier]}
                    </option>
                  ))}
                </select>
                {selectedTemplate?.description && (
                  <p className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[12px] leading-relaxed text-zinc-400">
                    <span className="font-semibold text-zinc-200">
                      {selectedTemplate.name}
                    </span>{' '}
                    validity {selectedTemplate.validityMonths} months,
                    requires{' '}
                    <span className="font-mono text-violet-glow">
                      {CCI_TIER_LABELS[selectedTemplate.requiresCredentialTier]}
                    </span>
                    <br />
                    {selectedTemplate.description}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="claimedAddressText"
                  className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
                >
                  Supplier / site address{' '}
                  <span className="ml-1 text-violet-glow">*</span>
                </label>
                <input
                  id="claimedAddressText"
                  name="claimedAddressText"
                  type="text"
                  required
                  maxLength={400}
                  defaultValue={initialAddress}
                  placeholder="123 Industrial Blvd, Calgary, AB T2P 1A1"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
                />
                <p className="mt-1.5 text-[11px] text-zinc-500">
                  The address the inspector will physically visit. The
                  inspector pins exact GPS on-site during capture.
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* The mode itself is always submitted, even in quality mode. */}
      <input type="hidden" name="inspectionType" value={mode} />
    </>
  );
}

function ModeCard({
  value,
  checked,
  onChange,
  title,
  blurb,
  icon,
}: {
  value: InspectionTypeKind;
  checked: boolean;
  onChange: () => void;
  title: string;
  blurb: string;
  icon: React.ReactNode;
}) {
  return (
    <label
      className={
        'group flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-4 transition-colors ' +
        (checked
          ? 'border-violet/50 bg-violet/10 ring-1 ring-violet/30'
          : 'border-white/[0.06] bg-white/[0.02] hover:border-violet/30 hover:bg-white/[0.04]')
      }
    >
      <input
        type="radio"
        // Note: NOT named "inspectionType" because we submit a hidden
        // input below (radio name conflicts can submit twice). The radios
        // are visual controls; the hidden input carries the value.
        name="_inspectionMode"
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span
        className={
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ' +
          (checked
            ? 'bg-violet/20 text-violet-glow ring-violet/40'
            : 'bg-white/[0.04] text-zinc-400 ring-white/10')
        }
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
          {blurb}
        </p>
      </div>
    </label>
  );
}
