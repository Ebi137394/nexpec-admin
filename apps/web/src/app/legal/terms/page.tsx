// ════════════════════════════════════════════════════════════════════════════
//  app/legal/terms/page.tsx — Terms of Service
//
//  ⚠️ THIS IS PLACEHOLDER COPY. Final terms must be drafted by counsel
//  before public launch. The shape + headings here exist so the
//  sign-up footer links don't 404 and so counsel has a working
//  structure to fill in.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service',
};

export default function TermsPage() {
  return (
    <article className="prose-legal">
      <p className="eyebrow">Legal</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
        Terms of Service
      </h1>
      <p className="mt-4 text-sm text-zinc-500">
        Effective date: TBD · Last updated: TBD
      </p>

      <Banner>
        These Terms are a working draft and will be finalised by counsel
        before public launch. Continued use of NEXPEC during the
        pre-launch period constitutes acceptance of the operational
        rules below; the final binding terms will be posted here and
        users will be notified by email at least 14 days before they
        take effect.
      </Banner>

      <Section title="1. Who we are">
        <p>
          NEXPEC operates an industrial-inspection marketplace connecting
          vetted inspectors with clients posting inspection jobs. NEXPEC,
          Inc. (&ldquo;we,&rdquo; &ldquo;us,&rdquo; &ldquo;our&rdquo;)
          provides this platform; legal entity details are available on
          request to sales@nexpecapp.com.
        </p>
      </Section>

      <Section title="2. Accounts + eligibility">
        <p>
          Sign-up is restricted by jurisdiction (see Compliance Notices).
          Account holders represent that they are legally permitted to
          transact in the country of residence they declare and are
          authorised to perform inspections in any country they list as
          work-authorised.
        </p>
      </Section>

      <Section title="3. Marketplace role">
        <p>
          NEXPEC mediates between clients and inspectors. Inspector pricing
          is set by NEXPEC operations; clients post budgets, NEXPEC
          dispatches eligible inspectors, and final assignments are
          confirmed by NEXPEC. We are not a party to the underlying
          inspection contract.
        </p>
      </Section>

      <Section title="4. Funds + escrow">
        <p>
          All payments are processed through Stripe. Client funds are
          held in escrow until both NEXPEC and the client confirm the
          inspector&apos;s report. Inspector payouts are released via
          Stripe Connect; NEXPEC never holds inspector funds directly.
        </p>
      </Section>

      <Section title="5. Reports + intellectual property">
        <p>
          Reports submitted by inspectors are reviewed by NEXPEC before
          being forwarded to the client. Once accepted by the client, the
          report and its underlying evidence are licensed to the client
          for their internal use; the inspector retains authorship and
          may not be identified to third parties without consent.
        </p>
      </Section>

      <Section title="6. Acceptable use">
        <p>
          Misrepresentation of qualifications, falsified evidence, direct
          off-platform contact between clients and inspectors, and
          circumvention of NEXPEC payment flows are all material breaches
          and grounds for immediate suspension.
        </p>
      </Section>

      <Section title="7. Termination">
        <p>
          Either party may terminate an account with notice; outstanding
          inspections in progress must be completed unless mutually
          released. Pending payouts settle on Stripe&apos;s normal cadence
          after termination.
        </p>
      </Section>

      <Section title="8. Disputes">
        <p>
          Disputes between client and inspector are mediated by NEXPEC
          operations. Funds remain in escrow during mediation. Final
          allocation is at NEXPEC&apos;s reasonable discretion; recourse
          to courts is available only after the internal dispute process
          has been exhausted.
        </p>
      </Section>

      <Section title="9. Contact">
        <p>
          Legal notices: legal@nexpecapp.com. Disputes:
          support@nexpecapp.com. Security disclosures:
          security@nexpecapp.com.
        </p>
      </Section>
    </article>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-8 rounded-2xl border border-accent-amber/30 bg-accent-amber/5 p-4 text-sm leading-relaxed text-accent-amber">
      <strong className="block text-xs font-semibold uppercase tracking-industrial text-accent-amber/90">
        Draft notice
      </strong>
      <p className="mt-1.5 text-zinc-200">{children}</p>
    </div>
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
