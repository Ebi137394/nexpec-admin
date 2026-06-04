// ════════════════════════════════════════════════════════════════════════════
//  components/auth/OnboardingWizard.tsx — multi-step signup wizard
//
//  Four steps:
//    1. Role selection — Inspector / Client / Agency / Enterprise
//    2. Profile data    — role-specific fields (specialties for inspectors,
//                         company / contact name for clients)
//    3. Terms           — mandatory checkbox + email
//    4. Auth method     — Google / Magic link / Password
//
//  Pure client-side state machine. All collected fields are submitted as
//  hidden inputs on the final step's form.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  HardHat,
  Building2,
  Briefcase,
  Globe2,
  Store,
  ArrowRight,
  ArrowLeft,
  Check,
  CircleCheck,
  ShieldCheck,
  Mail,
  KeyRound,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { useFormStatus } from 'react-dom';
import {
  signUpWithProfileAndPassword,
  signUpWithProfileAndMagicLink,
  signUpWithProfileAndOAuth,
} from '@/lib/auth/onboardingActions';
import { SPECIALTY_GROUPS } from '@/lib/data/specialtyTaxonomy';

type Role = 'inspector' | 'client' | 'agency' | 'enterprise' | 'supplier';

const ROLE_CARDS: ReadonlyArray<{
  key: Role;
  title: string;
  pitch: string;
  Icon: typeof HardHat;
  tone: 'cyan' | 'violet' | 'amber' | 'green';
  bullets: string[];
}> = [
  {
    key: 'inspector',
    title: 'I am an Inspector',
    pitch: 'Get paid for signed reports. Certifications-first matching.',
    Icon: HardHat,
    tone: 'cyan',
    bullets: [
      'Global projects across NDT, API, CWI, coatings',
      'Stripe Connect payout after report sign-off',
      'Reputation grows with every completed inspection',
    ],
  },
  {
    key: 'client',
    title: 'I am a Client',
    pitch: 'Post an inspection. Get vetted experts dispatched in hours.',
    Icon: Building2,
    tone: 'violet',
    bullets: [
      'Vetted, certified inspectors on demand',
      'Escrow until report is signed — no Net 60 risk',
      'Audit-grade evidence packs by default',
    ],
  },
  {
    key: 'agency',
    title: 'I am an Inspection Agency',
    pitch: 'Route work to your bench. White-label your roster.',
    Icon: Briefcase,
    tone: 'amber',
    bullets: [
      'Manage a roster from a single console',
      'Brand the client surface as your firm',
      'Spread editor for margin control',
    ],
  },
  {
    key: 'enterprise',
    title: 'I am an Enterprise Buyer',
    pitch: 'Multi-site programmes. Procurement contracts. SLA tracking.',
    Icon: Globe2,
    tone: 'green',
    bullets: [
      'MSA + DPA + NDA pack on signup',
      'Cost-centre & PO codes baked into invoices',
      'SOC2 + ISO27001 trail',
    ],
  },
  {
    key: 'supplier',
    title: 'I am a Vendor',
    pitch: 'Supply goods, labs & equipment. Bid on RFQs across every discipline.',
    Icon: Store,
    tone: 'cyan',
    bullets: [
      'Win RFQs from qualified, vetted buyers',
      'Seal ISO certs & accreditations once — Bitcoin-timestamped',
      'Get discovered in the supplier directory',
    ],
  },
];

interface Props {
  defaultEmail?: string;
  initialError?: string;
  initialRole?: Role | '';
  pendingMode?: 'magic' | '1' | null;
}

export function OnboardingWizard({
  defaultEmail = '',
  initialError = '',
  initialRole = '',
  pendingMode = null,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(initialRole ? 2 : 1);
  const [role, setRole] = useState<Role | ''>(initialRole);
  const [fullName, setFullName] = useState('');
  const [contactPersonName, setContactPersonName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [specialtySlugs, setSpecialtySlugs] = useState<Set<string>>(new Set());
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState(initialError);

  // Pending banners (after magic-link send / email confirmation request)
  if (pendingMode === 'magic') {
    return (
      <PendingPanel
        title="Check your inbox"
        body={
          <>
            We sent a magic link to{' '}
            <span className="text-white">{defaultEmail || 'your email'}</span>.
            Click it to finish signing in. The link expires in 1 hour.
          </>
        }
      />
    );
  }
  if (pendingMode === '1') {
    return (
      <PendingPanel
        title="Confirm your email"
        body={
          <>
            We sent a confirmation link to{' '}
            <span className="text-white">{defaultEmail || 'your email'}</span>.
            Click it to activate your account.
          </>
        }
      />
    );
  }

  function toggleSpecialty(slug: string) {
    setSpecialtySlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function canAdvanceFromStep2(): boolean {
    if (role === 'inspector') return fullName.trim().length >= 2;
    return (
      contactPersonName.trim().length >= 2 &&
      companyName.trim().length >= 2
    );
  }
  function canAdvanceFromStep3(): boolean {
    return termsAccepted && email.trim().length > 0 && /.+@.+\..+/.test(email);
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Branded header */}
      <header className="mb-8 text-center">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-glow shadow-[0_0_8px_rgba(124,58,237,0.7)]" />
          Welcome to NEXPEC
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {step === 1 && 'Tell us who you are.'}
          {step === 2 && 'A few details about you.'}
          {step === 3 && 'Agree and continue.'}
          {step === 4 && 'How would you like to sign in?'}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {step === 1 &&
            'Industrial inspection, engineered for trust. Pick your path.'}
          {step === 2 &&
            'This is what admin and counterparties will see on your profile.'}
          {step === 3 &&
            'Standard MSA + Privacy. You can re-read either at any time from your dashboard.'}
          {step === 4 &&
            'Google for instant signup, Magic link for no-password access, or a classic password.'}
        </p>
      </header>

      <Stepper current={step} />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-accent-red/30 bg-accent-red/10 p-4 text-sm text-accent-red">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* STEP 1 — Role selection */}
      {step === 1 && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ROLE_CARDS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                setRole(c.key);
                setError('');
                setStep(2);
              }}
              className={
                'group relative overflow-hidden rounded-3xl border bg-gradient-to-br p-6 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-20px_rgba(124,58,237,0.4)] ' +
                toneClasses(c.tone)
              }
            >
              <span className="absolute -right-4 -top-4 inline-flex h-16 w-16 items-center justify-center rounded-full opacity-20 transition-opacity duration-200 group-hover:opacity-30">
                <c.Icon className="h-10 w-10" strokeWidth={1.5} />
              </span>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] ring-1 ring-inset ring-white/15">
                <c.Icon className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <h3 className="mt-4 font-display text-lg font-semibold text-white">
                {c.title}
              </h3>
              <p className="mt-1 text-xs text-zinc-300">{c.pitch}</p>
              <ul className="mt-4 space-y-1.5">
                {c.bullets.map((b) => (
                  <li
                    key={b}
                    className="flex items-start gap-2 text-[11px] text-zinc-400"
                  >
                    <CircleCheck className="mt-0.5 h-3 w-3 shrink-0 opacity-70" strokeWidth={2} />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <span className="mt-5 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-industrial opacity-80 group-hover:opacity-100">
                Continue
                <ArrowRight className="h-3 w-3" strokeWidth={2} />
              </span>
            </button>
          ))}
        </section>
      )}

      {/* STEP 2 — Profile data */}
      {step === 2 && role && (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
          {role === 'inspector' ? (
            <InspectorFields
              fullName={fullName}
              setFullName={setFullName}
              specialtySlugs={specialtySlugs}
              toggleSpecialty={toggleSpecialty}
            />
          ) : (
            <BusinessFields
              role={role}
              contactPersonName={contactPersonName}
              setContactPersonName={setContactPersonName}
              companyName={companyName}
              setCompanyName={setCompanyName}
            />
          )}

          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-zinc-300 hover:border-violet/40 hover:text-white"
            >
              <ArrowLeft className="h-3 w-3" strokeWidth={2} />
              Back
            </button>
            <button
              type="button"
              disabled={!canAdvanceFromStep2()}
              onClick={() => {
                setError('');
                setStep(3);
              }}
              className="inline-flex items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm transition-colors hover:bg-violet/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
              <ArrowRight className="h-3 w-3" strokeWidth={2} />
            </button>
          </div>
        </section>
      )}

      {/* STEP 3 — Terms + email */}
      {step === 3 && (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
          <Field
            label="Work email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            placeholder="you@company.com"
            required
          />

          <label className="group mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-violet/40 has-[:checked]:border-violet/40 has-[:checked]:bg-violet/10">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-transparent text-violet focus:ring-violet/40 focus:ring-offset-0"
            />
            <span className="flex-1 text-sm text-zinc-300">
              I agree to the{' '}
              <Link
                href="/legal/terms"
                target="_blank"
                className="text-violet-glow underline hover:text-white"
              >
                NEXPEC Terms of Service
              </Link>{' '}
              and{' '}
              <Link
                href="/legal/privacy"
                target="_blank"
                className="text-violet-glow underline hover:text-white"
              >
                Privacy Policy
              </Link>
              .
            </span>
          </label>

          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
            <ShieldCheck className="h-3 w-3 text-cyan-glow" strokeWidth={1.75} />
            Your acceptance is timestamped and stored on your profile.
          </p>

          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-zinc-300 hover:border-violet/40 hover:text-white"
            >
              <ArrowLeft className="h-3 w-3" strokeWidth={2} />
              Back
            </button>
            <button
              type="button"
              disabled={!canAdvanceFromStep3()}
              onClick={() => {
                setError('');
                setStep(4);
              }}
              className="inline-flex items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm transition-colors hover:bg-violet/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
              <ArrowRight className="h-3 w-3" strokeWidth={2} />
            </button>
          </div>
        </section>
      )}

      {/* STEP 4 — Auth method */}
      {step === 4 && (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
          {/* Hidden fields shared by all three forms */}
          <HiddenFieldsRenderer
            role={role as Role}
            fullName={fullName}
            contactPersonName={contactPersonName}
            companyName={companyName}
            email={email}
            specialtySlugs={specialtySlugs}
            termsAccepted={termsAccepted}
          />

          {/* Google */}
          <form action={signUpWithProfileAndOAuth}>
            <PassthroughInputs
              role={role as Role}
              fullName={fullName}
              contactPersonName={contactPersonName}
              companyName={companyName}
              email={email}
              specialtySlugs={specialtySlugs}
              termsAccepted={termsAccepted}
            />
            <input type="hidden" name="provider" value="google" />
            <SubmitButton tone="white" icon={<GoogleGlyph />}>
              Continue with Google
            </SubmitButton>
          </form>

          {/* Apple */}
          <form action={signUpWithProfileAndOAuth} className="mt-3">
            <PassthroughInputs
              role={role as Role}
              fullName={fullName}
              contactPersonName={contactPersonName}
              companyName={companyName}
              email={email}
              specialtySlugs={specialtySlugs}
              termsAccepted={termsAccepted}
            />
            <input type="hidden" name="provider" value="apple" />
            <SubmitButton tone="dark" icon={<AppleGlyph />}>
              Continue with Apple
            </SubmitButton>
          </form>

          <Divider label="or" />

          {/* Magic link */}
          <form action={signUpWithProfileAndMagicLink}>
            <PassthroughInputs
              role={role as Role}
              fullName={fullName}
              contactPersonName={contactPersonName}
              companyName={companyName}
              email={email}
              specialtySlugs={specialtySlugs}
              termsAccepted={termsAccepted}
            />
            <SubmitButton tone="violet-outline" icon={<Mail className="h-4 w-4" strokeWidth={1.75} />}>
              Email me a magic link
            </SubmitButton>
          </form>

          <Divider label="or use a password" />

          {/* Password */}
          <form action={signUpWithProfileAndPassword} className="space-y-3">
            <PassthroughInputs
              role={role as Role}
              fullName={fullName}
              contactPersonName={contactPersonName}
              companyName={companyName}
              email={email}
              specialtySlugs={specialtySlugs}
              termsAccepted={termsAccepted}
            />
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                Password (10+ characters)
              </span>
              <input
                type="password"
                name="password"
                required
                minLength={10}
                maxLength={72}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 10 characters"
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
              />
            </label>
            <SubmitButton tone="violet" icon={<KeyRound className="h-4 w-4" strokeWidth={1.75} />}>
              Create account
            </SubmitButton>
          </form>

          <div className="mt-6">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white"
            >
              <ArrowLeft className="h-3 w-3" strokeWidth={2} />
              Back
            </button>
          </div>
        </section>
      )}

      {/* Footer */}
      <p className="mt-8 text-center text-xs text-zinc-500">
        Already have an account?{' '}
        <Link href="/sign-in" className="text-violet-glow hover:text-white">
          Sign in
        </Link>
        .
      </p>
    </div>
  );
}

/* ─── sub-components ──────────────────────────────────────────────────── */

function Stepper({ current }: { current: 1 | 2 | 3 | 4 }) {
  const labels = ['Role', 'Profile', 'Terms', 'Sign in'];
  return (
    <ol className="mb-8 grid grid-cols-4 gap-1.5">
      {labels.map((l, i) => {
        const step = (i + 1) as 1 | 2 | 3 | 4;
        const done = step < current;
        const active = step === current;
        return (
          <li key={l} className="flex flex-col items-center gap-1.5">
            <span
              className={
                'inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold transition-all ' +
                (done
                  ? 'bg-accent-green text-white'
                  : active
                    ? 'bg-violet text-white shadow-[0_0_12px_rgba(124,58,237,0.5)]'
                    : 'border border-white/10 bg-white/[0.04] text-zinc-500')
              }
            >
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : step}
            </span>
            <span
              className={
                'text-[9px] font-semibold uppercase tracking-industrial ' +
                (active ? 'text-violet-glow' : done ? 'text-accent-green' : 'text-zinc-600')
              }
            >
              {l}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Field({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  required,
  autoComplete,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
        {required && <span className="ml-1 text-violet-glow">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
      />
    </label>
  );
}

function InspectorFields({
  fullName,
  setFullName,
  specialtySlugs,
  toggleSpecialty,
}: {
  fullName: string;
  setFullName: (v: string) => void;
  specialtySlugs: Set<string>;
  toggleSpecialty: (slug: string) => void;
}) {
  return (
    <div className="space-y-5">
      <Field
        label="Full name"
        value={fullName}
        onChange={setFullName}
        placeholder="Alex Doe"
        required
        autoComplete="name"
      />
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          Pick the specialties you cover (you can refine later)
        </p>
        <p className="mt-1 text-[11px] text-zinc-600">
          Optional at this stage. Full taxonomy with 200+ items is available in
          your settings after signup.
        </p>
        <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-white/[0.06] bg-white/[0.01] p-3">
          {SPECIALTY_GROUPS.slice(0, 4).map((g) => (
            <fieldset key={g.title} className="mb-3 last:mb-0">
              <legend className="mb-2 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
                {g.title}
              </legend>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {g.items.slice(0, 10).map((s) => {
                  const checked = specialtySlugs.has(s.slug);
                  return (
                    <label
                      key={s.slug}
                      className={
                        'group flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition-all ' +
                        (checked
                          ? 'border-violet/50 bg-violet/15 text-white shadow-[0_0_0_1px_rgba(124,58,237,0.30)]'
                          : 'border-white/[0.06] bg-white/[0.02] text-zinc-300 hover:border-violet/30 hover:text-white')
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSpecialty(s.slug)}
                        className="peer sr-only"
                      />
                      <span
                        className={
                          'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ' +
                          (checked
                            ? 'border-violet-glow bg-violet'
                            : 'border-white/20 bg-white/[0.04]')
                        }
                      >
                        <Check
                          className={
                            'h-3 w-3 text-white transition-opacity ' +
                            (checked ? 'opacity-100' : 'opacity-0')
                          }
                          strokeWidth={3}
                        />
                      </span>
                      <span className="truncate">{s.label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </div>
    </div>
  );
}

function BusinessFields({
  role,
  contactPersonName,
  setContactPersonName,
  companyName,
  setCompanyName,
}: {
  role: Role;
  contactPersonName: string;
  setContactPersonName: (v: string) => void;
  companyName: string;
  setCompanyName: (v: string) => void;
}) {
  const orgLabel =
    role === 'agency' ? 'Agency name' : role === 'enterprise' ? 'Company / enterprise name' : 'Company name';
  return (
    <div className="space-y-5">
      <Field
        label="Contact person name"
        value={contactPersonName}
        onChange={setContactPersonName}
        placeholder="Alex Doe"
        required
        autoComplete="name"
      />
      <Field
        label={orgLabel}
        value={companyName}
        onChange={setCompanyName}
        placeholder="Acme Industrial Inc."
        required
        autoComplete="organization"
      />
    </div>
  );
}

function HiddenFieldsRenderer(_: HiddenFieldsProps) {
  return null;
}

interface HiddenFieldsProps {
  role: Role;
  fullName: string;
  contactPersonName: string;
  companyName: string;
  email: string;
  specialtySlugs: Set<string>;
  termsAccepted: boolean;
}

function PassthroughInputs({
  role,
  fullName,
  contactPersonName,
  companyName,
  email,
  specialtySlugs,
  termsAccepted,
}: HiddenFieldsProps) {
  return (
    <>
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="fullName" value={fullName} />
      <input type="hidden" name="contactPersonName" value={contactPersonName} />
      <input type="hidden" name="companyName" value={companyName} />
      <input type="hidden" name="email" value={email} />
      <input
        type="hidden"
        name="termsAccepted"
        value={termsAccepted ? 'on' : 'off'}
      />
      {Array.from(specialtySlugs).map((slug) => (
        <input key={slug} type="hidden" name="specialtySlugs" value={slug} />
      ))}
    </>
  );
}

function SubmitButton({
  children,
  icon,
  tone,
}: {
  children: ReactNode;
  icon: ReactNode;
  tone: 'violet' | 'violet-outline' | 'white' | 'dark';
}) {
  const { pending } = useFormStatus();
  const cls =
    tone === 'violet'
      ? 'bg-violet text-white hover:bg-violet/90'
      : tone === 'violet-outline'
        ? 'border border-violet/40 bg-violet/10 text-violet-glow hover:bg-violet/20'
        : tone === 'white'
          ? 'border border-white/20 bg-white text-ink-950 hover:bg-zinc-100'
          : 'border border-white/10 bg-ink-900 text-white hover:bg-ink-800';
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        'inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60 ' +
        cls
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-white/10" />
      <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </span>
      <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}

function PendingPanel({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md rounded-3xl border border-violet/30 bg-violet/[0.05] p-8 text-center">
      <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/40">
        <Mail className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <h2 className="mt-4 font-display text-xl font-semibold text-white">{title}</h2>
      <p className="mt-2 text-sm text-zinc-300">{body}</p>
      <Link
        href="/sign-in"
        className="mt-6 inline-block rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-zinc-200 hover:border-violet/40 hover:text-white"
      >
        Back to sign in
      </Link>
    </div>
  );
}

function toneClasses(tone: 'cyan' | 'violet' | 'amber' | 'green'): string {
  switch (tone) {
    case 'cyan':
      return 'border-cyan-glow/30 from-cyan-glow/[0.10] to-transparent hover:border-cyan-glow/60';
    case 'amber':
      return 'border-accent-amber/30 from-accent-amber/[0.10] to-transparent hover:border-accent-amber/60';
    case 'green':
      return 'border-accent-green/30 from-accent-green/[0.10] to-transparent hover:border-accent-green/60';
    case 'violet':
    default:
      return 'border-violet/30 from-violet/[0.10] to-transparent hover:border-violet/60';
  }
}

function GoogleGlyph() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.7 4.7-6.2 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.4 4 9.8 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.3 26.7 36 24 36c-5.1 0-9.6-3.3-11.3-7.9l-6.5 5C9.8 39.7 16.4 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.7l6.2 5.2C40.9 35 44 30 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

function AppleGlyph() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M16.365 1.43c0 1.14-.413 2.234-1.21 3.05-.798.82-2.1 1.46-3.32 1.36-.144-1.15.412-2.32 1.18-3.13.86-.92 2.33-1.6 3.35-1.28zM20.43 17.07c-.572 1.32-.853 1.91-1.6 3.08-1.04 1.62-2.51 3.64-4.33 3.66-1.62.02-2.04-1.06-4.24-1.05-2.2.02-2.66 1.07-4.28 1.05-1.82-.02-3.21-1.83-4.25-3.45C-.97 16.95-.42 11.4 1.95 8.86c1.69-1.82 4.36-2.88 6.87-2.83 1.59.05 3.09 1.07 4.13 1.07 1.04 0 2.86-1.32 4.83-1.13.83.04 3.16.34 4.66 2.55-.12.08-2.79 1.62-2.75 4.83.04 3.84 3.4 5.12 3.44 5.14-.02.08-.53 1.85-1.7 4.58z" />
    </svg>
  );
}
