// ════════════════════════════════════════════════════════════════════════════
//  components/admin/scope-templates/ScopeTemplateForm.tsx
//
//  Shared client form used by both the Create page
//  (/admin/compliance/templates/new) and the Edit page
//  (/admin/compliance/templates/[id]).
//
//  Behavior:
//    • Drives one of two Server Actions via useActionState (React 19)
//        — createScopeTemplateAction  (mode === 'create')
//        — updateScopeTemplateAction  (mode === 'edit')
//    • Slug is editable only in create mode; the column is a stable
//      identifier referenced by historical jobs, so we never let an edit
//      change it. The Edit page renders slug as a read-only label and the
//      form omits the field entirely.
//    • Base price is exposed as DOLLARS in the UI for human ergonomics —
//      the Server Action converts to cents.
//    • All categories are free-text (lowercased on save). The parent page
//      may supply a `categorySuggestions` list to power a <datalist>.
//    • Errors surface inline next to the offending field via fieldErrors.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import {
  Save,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Tag,
  MapPin,
  Calendar,
  Wallet,
  ShieldCheck,
  FileText,
  Hash,
  Eye,
} from 'lucide-react';
import {
  createScopeTemplateAction,
  updateScopeTemplateAction,
} from '@/lib/actions/scopeTemplates';
import {
  scopeTemplateInitialState,
  type ScopeTemplateFormState,
} from '@/lib/actions/scopeTemplates.types';
import {
  CCI_TIER_LABELS,
  type CciCredentialTier,
} from '@/lib/data/scopeTemplates.types';

const TIER_VALUES: CciCredentialTier[] = ['cci_basic', 'cci_advanced', 'cci_lead'];

const REGION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'global', label: 'Global' },
  { value: 'us', label: 'United States' },
  { value: 'eu', label: 'European Union' },
  { value: 'uk', label: 'United Kingdom' },
  { value: 'mena', label: 'Middle East & North Africa' },
  { value: 'apac', label: 'Asia-Pacific' },
  { value: 'latam', label: 'Latin America' },
  { value: 'africa', label: 'Africa' },
];

export interface ScopeTemplateFormDefaults {
  id?: string;
  slug?: string;
  name?: string;
  category?: string;
  region?: string;
  validityMonths?: number;
  basePriceCents?: number;
  requiresCredentialTier?: CciCredentialTier;
  description?: string | null;
  isActive?: boolean;
  version?: number;
}

interface Props {
  mode: 'create' | 'edit';
  defaults?: ScopeTemplateFormDefaults;
  categorySuggestions?: string[];
}

export function ScopeTemplateForm({
  mode,
  defaults = {},
  categorySuggestions = [],
}: Props) {
  const action =
    mode === 'create' ? createScopeTemplateAction : updateScopeTemplateAction;

  const [state, formAction] = useActionState<ScopeTemplateFormState, FormData>(
    action,
    scopeTemplateInitialState,
  );

  // Local mirror so we can show the live char counter and dollar/SAR preview.
  const [description, setDescription] = useState<string>(
    defaults.description ?? '',
  );
  const [basePriceDollars, setBasePriceDollars] = useState<string>(
    defaults.basePriceCents != null
      ? (defaults.basePriceCents / 100).toFixed(2)
      : '',
  );

  // Reset local state if the parent swaps in a different template (rare).
  useEffect(() => {
    setDescription(defaults.description ?? '');
    setBasePriceDollars(
      defaults.basePriceCents != null
        ? (defaults.basePriceCents / 100).toFixed(2)
        : '',
    );
  }, [defaults.id, defaults.description, defaults.basePriceCents]);

  const slugId = useId();
  const nameId = useId();
  const catId = useId();
  const regId = useId();
  const valId = useId();
  const priceId = useId();
  const tierId = useId();
  const descId = useId();
  const activeId = useId();
  const catListId = useId();
  const regListId = useId();

  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-6">
      {/* Hidden identifiers for edit mode */}
      {mode === 'edit' && defaults.id ? (
        <input type="hidden" name="id" value={defaults.id} />
      ) : null}
      {mode === 'edit' && typeof defaults.version === 'number' ? (
        <input
          type="hidden"
          name="expectedVersion"
          value={String(defaults.version)}
        />
      ) : null}

      {/* Top-level alerts */}
      {state.error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-red-300"
            strokeWidth={2}
          />
          <div>
            <p className="font-semibold text-red-100">
              We could not save this template.
            </p>
            <p className="mt-0.5 text-red-200/90">{state.error}</p>
          </div>
        </div>
      ) : null}
      {state.ok && state.updated ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200"
        >
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300"
            strokeWidth={2}
          />
          <div>
            <p className="font-semibold text-emerald-100">
              Saved · now at v{state.updated.newVersion}.
            </p>
            <p className="mt-0.5 text-emerald-200/90">
              Earlier versions stay readable for any historical compliance jobs.
            </p>
          </div>
        </div>
      ) : null}

      {/* ── Identity section ──────────────────────────────────────────── */}
      <FormSection
        icon={<Tag className="h-3.5 w-3.5" strokeWidth={2} />}
        title="Identity"
        hint="A name clients see, a slug your engineers grep for."
      >
        <Field
          id={nameId}
          label="Display name"
          required
          error={fe.name}
          hint="Shown verbatim on the client's compliance-mode picker."
        >
          <input
            id={nameId}
            name="name"
            type="text"
            required
            defaultValue={defaults.name ?? ''}
            maxLength={120}
            placeholder="e.g. Supplier Existence Verification"
            className={inputCls(fe.name != null)}
          />
        </Field>

        {mode === 'create' ? (
          <Field
            id={slugId}
            label="Slug"
            required
            error={fe.slug}
            hint="Lowercase letters, numbers, underscores — used in URLs and audit logs. Immutable after creation."
          >
            <input
              id={slugId}
              name="slug"
              type="text"
              required
              defaultValue={defaults.slug ?? ''}
              maxLength={64}
              pattern="[a-z0-9_]+"
              placeholder="supplier_existence_verification"
              className={`${inputCls(fe.slug != null)} font-mono`}
            />
          </Field>
        ) : (
          <Field
            id={slugId}
            label="Slug"
            hint="Slug is locked once a template exists — historical jobs reference it."
          >
            <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5">
              <Hash className="h-3.5 w-3.5 text-zinc-500" strokeWidth={1.75} />
              <code className="font-mono text-sm text-zinc-300">
                {defaults.slug ?? '—'}
              </code>
            </div>
          </Field>
        )}
      </FormSection>

      {/* ── Classification section ────────────────────────────────────── */}
      <FormSection
        icon={<MapPin className="h-3.5 w-3.5" strokeWidth={2} />}
        title="Classification"
        hint="Bucket clients filter by + the geography this scope applies to."
      >
        <Field
          id={catId}
          label="Category"
          required
          error={fe.category}
          hint="Free-text, lowercased on save. Used to group templates in the library."
        >
          <input
            id={catId}
            name="category"
            type="text"
            required
            defaultValue={defaults.category ?? ''}
            maxLength={64}
            list={catListId}
            placeholder="supplier_verification"
            className={inputCls(fe.category != null)}
          />
          {categorySuggestions.length > 0 ? (
            <datalist id={catListId}>
              {categorySuggestions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          ) : null}
        </Field>

        <Field
          id={regId}
          label="Region"
          required
          error={fe.region}
          hint="ISO-ish region code. Use `global` if the scope is jurisdiction-independent."
        >
          <input
            id={regId}
            name="region"
            type="text"
            required
            defaultValue={defaults.region ?? 'global'}
            maxLength={32}
            list={regListId}
            placeholder="global"
            className={inputCls(fe.region != null)}
          />
          <datalist id={regListId}>
            {REGION_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </datalist>
        </Field>
      </FormSection>

      {/* ── Commercial section ────────────────────────────────────────── */}
      <FormSection
        icon={<Wallet className="h-3.5 w-3.5" strokeWidth={2} />}
        title="Commercial"
        hint="Default price + how long the resulting trust certificate stays valid."
      >
        <Field
          id={priceId}
          label="Base price (USD)"
          required
          error={fe.basePriceCents}
          hint={`Stored as cents internally. ${
            basePriceDollars && Number.isFinite(Number(basePriceDollars))
              ? `Preview: ${formatPreview(Number(basePriceDollars))}`
              : 'Enter dollars (e.g. 499.00).'
          }`}
        >
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-500">
              $
            </span>
            <input
              id={priceId}
              name="basePriceDollars"
              type="number"
              step="0.01"
              min="0"
              max="100000"
              required
              value={basePriceDollars}
              onChange={(e) => setBasePriceDollars(e.target.value)}
              placeholder="499.00"
              className={`${inputCls(fe.basePriceCents != null)} pl-7 font-mono`}
            />
          </div>
        </Field>

        <Field
          id={valId}
          label="Validity (months)"
          required
          error={fe.validityMonths}
          hint="How long the resulting trust certificate remains valid after issuance."
        >
          <div className="relative">
            <Calendar
              className="pointer-events-none absolute inset-y-0 left-3 my-auto h-4 w-4 text-zinc-500"
              strokeWidth={1.75}
            />
            <input
              id={valId}
              name="validityMonths"
              type="number"
              step="1"
              min="1"
              max="120"
              required
              defaultValue={defaults.validityMonths ?? 12}
              className={`${inputCls(fe.validityMonths != null)} pl-9 font-mono`}
            />
          </div>
        </Field>
      </FormSection>

      {/* ── Credential gate section ───────────────────────────────────── */}
      <FormSection
        icon={<ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />}
        title="Credential gate"
        hint="Inspectors below this CCI tier are filtered out at bid time."
      >
        <Field
          id={tierId}
          label="Required CCI tier"
          required
          error={fe.requiresCredentialTier}
        >
          <select
            id={tierId}
            name="requiresCredentialTier"
            required
            defaultValue={defaults.requiresCredentialTier ?? 'cci_basic'}
            className={inputCls(fe.requiresCredentialTier != null)}
          >
            {TIER_VALUES.map((tier) => (
              <option key={tier} value={tier}>
                {CCI_TIER_LABELS[tier]}
              </option>
            ))}
          </select>
        </Field>

        {mode === 'create' ? (
          <Field
            id={activeId}
            label="Visibility"
            hint="Inactive templates stay in the database but disappear from the client picker."
          >
            <label
              htmlFor={activeId}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5"
            >
              <input
                id={activeId}
                name="isActive"
                type="checkbox"
                defaultChecked={defaults.isActive ?? true}
                className="h-4 w-4 rounded border-white/20 bg-white/[0.04] text-violet-glow focus:ring-violet-glow/40"
              />
              <Eye className="h-4 w-4 text-emerald-400" strokeWidth={1.75} />
              <span className="text-sm text-zinc-200">
                Publish as <strong className="text-white">Active</strong> immediately
              </span>
            </label>
          </Field>
        ) : null}
      </FormSection>

      {/* ── Description section ───────────────────────────────────────── */}
      <FormSection
        icon={<FileText className="h-3.5 w-3.5" strokeWidth={2} />}
        title="Description"
        hint="Markdown supported. Clients read this when deciding which template fits."
      >
        <Field
          id={descId}
          label="What inspectors will be asked to do"
          error={fe.description}
        >
          <textarea
            id={descId}
            name="description"
            rows={6}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={4000}
            placeholder="Verifies that the supplier physically exists at the claimed address, has visible commercial signage…"
            className={`${inputCls(fe.description != null)} resize-y leading-relaxed`}
          />
          <p className="mt-1.5 text-right text-[10px] font-mono text-zinc-500">
            {description.length} / 4000
          </p>
        </Field>
      </FormSection>

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/[0.05] pt-6">
        <Link
          href={
            mode === 'edit' && defaults.id
              ? `/admin/compliance/templates`
              : '/admin/compliance/templates'
          }
          className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5 text-sm font-semibold text-zinc-300 transition hover:border-white/20 hover:text-white"
        >
          Cancel
        </Link>
        <SubmitButton mode={mode} />
      </div>
    </form>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function SubmitButton({ mode }: { mode: 'create' | 'edit' }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-xl bg-violet-glow px-5 py-2.5 text-sm font-bold uppercase tracking-industrial text-ink-900 transition hover:bg-violet-glow/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
      ) : (
        <Save className="h-4 w-4" strokeWidth={2} />
      )}
      {pending
        ? mode === 'create'
          ? 'Creating…'
          : 'Saving…'
        : mode === 'create'
          ? 'Create template'
          : 'Save changes'}
    </button>
  );
}

function FormSection({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-3xl border border-white/[0.06] bg-white/[0.01] p-5 sm:p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow/90">
            <span className="text-violet-glow">{icon}</span>
            {title}
          </h3>
          {hint ? (
            <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>
          ) : null}
        </div>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  required,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-industrial text-zinc-400"
      >
        <span>
          {label}
          {required ? <span className="ml-1 text-violet-glow">*</span> : null}
        </span>
        {error ? (
          <span className="text-[10px] font-semibold normal-case tracking-normal text-red-300">
            {error}
          </span>
        ) : null}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && !error ? (
        <p className="mt-1.5 text-[10px] text-zinc-500">{hint}</p>
      ) : null}
    </div>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function inputCls(hasError: boolean): string {
  return [
    'w-full rounded-xl border bg-white/[0.02] px-3.5 py-2.5 text-sm text-white',
    'placeholder:text-zinc-600 focus:outline-none focus:ring-2',
    hasError
      ? 'border-red-500/40 focus:border-red-400 focus:ring-red-400/30'
      : 'border-white/[0.08] focus:border-violet-glow/40 focus:ring-violet-glow/30',
  ].join(' ');
}

function formatPreview(dollars: number): string {
  if (!Number.isFinite(dollars)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(dollars);
}
