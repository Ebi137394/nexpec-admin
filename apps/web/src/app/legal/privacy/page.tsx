// ════════════════════════════════════════════════════════════════════════════
//  app/legal/privacy/page.tsx — Privacy Policy
//  ⚠️ PLACEHOLDER. Final wording must come from counsel; structure here
//  is a working scaffold so the sign-up flow stops 404ing.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
};

export default function PrivacyPage() {
  return (
    <article>
      <p className="eyebrow">Legal</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
        Privacy Policy
      </h1>
      <p className="mt-4 text-sm text-zinc-500">
        Effective date: TBD · Last updated: TBD
      </p>

      <div className="mt-8 rounded-2xl border border-accent-amber/30 bg-accent-amber/5 p-4 text-sm leading-relaxed">
        <strong className="block text-xs font-semibold uppercase tracking-industrial text-accent-amber/90">
          Draft notice
        </strong>
        <p className="mt-1.5 text-zinc-200">
          This Privacy Policy is a working draft pending counsel review.
          It accurately describes what data NEXPEC collects today and how
          we use it, but final binding language will be posted before
          public launch.
        </p>
      </div>

      <Section title="1. Data we collect">
        <p>
          <strong className="text-zinc-100">Account data:</strong> email,
          full name, phone, company (optional), country of residence,
          professional title, certifications, NDT methods, work-authorisation
          countries, hourly rate (inspector-side only).
        </p>
        <p>
          <strong className="text-zinc-100">Operational data:</strong>{' '}
          jobs you post or apply to, applications you submit, reports you
          deliver, photos uploaded as inspection evidence, escrow status,
          payout records.
        </p>
        <p>
          <strong className="text-zinc-100">Audit data:</strong> every
          state-changing action across the platform is recorded in our
          internal audit trail (actor identity, timestamp, subject, delta).
          This is operational telemetry, not analytics; we do not sell or
          share audit data with third parties.
        </p>
      </Section>

      <Section title="2. How we use it">
        <p>
          To match inspectors to jobs, mediate communication between
          clients and inspectors via admin chat, process payments through
          Stripe, comply with KYC/AML obligations on the inspector
          side, and improve platform safety.
        </p>
        <p>
          <strong className="text-zinc-100">
            Strict price-visibility boundary:
          </strong>{' '}
          inspector pricing is never disclosed to clients; client budgets
          are never disclosed to inspectors. This isolation is enforced at
          the database and application layers (see our public engineering
          notes for technical detail).
        </p>
      </Section>

      <Section title="3. Sub-processors">
        <p>
          <strong className="text-zinc-100">Supabase</strong> — database,
          auth, storage, edge functions. EU + US regions.
        </p>
        <p>
          <strong className="text-zinc-100">Stripe</strong> — payment
          processing, Connect inspector payouts, KYC verification.
        </p>
        <p>
          <strong className="text-zinc-100">Vercel</strong> — web app
          hosting, edge caching.
        </p>
        <p>
          <strong className="text-zinc-100">Resend</strong> — transactional
          email (sign-up confirmations, dispatch notifications).
        </p>
      </Section>

      <Section title="4. Your rights">
        <p>
          Access, correction, export, and erasure requests should be sent
          to <span className="font-mono text-zinc-200">privacy@nexpecapp.com</span>.
          We respond within 30 days. Erasure may be limited by record-retention
          obligations for completed inspections (typically 7 years).
        </p>
      </Section>

      <Section title="5. Contact">
        <p>
          Privacy questions: privacy@nexpecapp.com. Security disclosures:
          security@nexpecapp.com (we follow the IETF security.txt standard).
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
