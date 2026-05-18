// ════════════════════════════════════════════════════════════════════════════
//  app/legal/compliance-notices/page.tsx — Compliance Notices
//
//  Web parity of the mobile profile/legal/compliance-notices.tsx file.
//  Captures the jurisdictional restrictions + sanction-list exclusions
//  enforced by the platform.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Compliance Notices',
};

export default function ComplianceNoticesPage() {
  return (
    <article>
      <p className="eyebrow">Legal</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
        Compliance Notices
      </h1>
      <p className="mt-4 text-sm text-zinc-500">
        Effective date: TBD · Last updated: TBD
      </p>

      <div className="mt-8 rounded-2xl border border-accent-amber/30 bg-accent-amber/5 p-4 text-sm leading-relaxed">
        <strong className="block text-xs font-semibold uppercase tracking-industrial text-accent-amber/90">
          Draft notice
        </strong>
        <p className="mt-1.5 text-zinc-200">
          These notices describe our current platform-enforced jurisdiction
          and sanctions policy. Final compliance language is pending counsel
          review; the operational rules below are accurate today.
        </p>
      </div>

      <Section title="Market gating">
        <p>
          NEXPEC operates an industrial-inspection marketplace subject to
          multiple jurisdictions&apos; trade-controls and professional-licensure
          regimes. Sign-up is gated by country of residence at the
          database layer; inspectors and clients in restricted markets
          cannot create accounts.
        </p>
        <p>
          Inspectors declare their countries of work-authorisation at
          profile setup; the job-matching system filters listings to only
          those inspections the inspector is legally permitted to perform.
        </p>
      </Section>

      <Section title="Excluded markets">
        <p>
          As of the effective date, NEXPEC does not accept registrations
          from individuals or entities resident in jurisdictions on
          OFAC&apos;s Specially Designated Nationals list, the EU
          consolidated financial-sanctions list, or the equivalent
          domestic lists of NEXPEC&apos;s primary operating country. The
          full exclusion list is enforced at the
          <span className="font-mono"> profiles.country_of_residence</span>{' '}
          foreign key against
          <span className="font-mono"> public.country_codes</span>; rows
          for restricted countries are not present in the reference table.
        </p>
        <p>
          Mainland China (CN) is currently excluded by policy pending
          completion of our local-counsel review (ADDENDUM-CN-001).
          Hong Kong (HK), Macao (MO), and Taiwan (TW) are not affected by
          this exclusion.
        </p>
      </Section>

      <Section title="Sponsored-work disclosure">
        <p>
          Inspectors who opt into &ldquo;sponsored work&rdquo; (visa
          assistance or full relocation sponsorship) appear in the
          dispatch queue for jobs in countries outside their declared
          work-authorisation list. Sponsorship terms are negotiated per
          assignment by NEXPEC operations; clients pay the platform spread
          set per-job and never see sponsorship arrangements directly.
        </p>
      </Section>

      <Section title="Inspection report retention">
        <p>
          Signed inspection reports are retained for seven (7) years from
          the date of client acceptance, in line with prevailing
          professional-standards retention norms. Underlying evidence
          (photos, attachments, signatures) are retained for the same
          period. Inspector and client erasure requests are honoured for
          all non-report data; the retained reports are anonymised at
          erasure (inspector identity becomes &ldquo;Inspector
          [hash]&rdquo;).
        </p>
      </Section>

      <Section title="Audit trail">
        <p>
          Every state-changing action on the platform is recorded in our
          internal audit ledger
          (<span className="font-mono">public.audit_events</span>) with
          actor identity, timestamp, subject, and a JSON delta. The audit
          trail is append-only, RLS-restricted to operators, and is the
          source-of-truth for inspector payout releases and client
          dispute resolutions.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Compliance + sanctions questions:{' '}
          <span className="font-mono">compliance@nexpecapp.com</span>.
          Disclosures + appeals:{' '}
          <span className="font-mono">legal@nexpecapp.com</span>.
        </p>
      </Section>
    </article>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-semibold tracking-tight text-white">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-zinc-300">
        {children}
      </div>
    </section>
  );
}
