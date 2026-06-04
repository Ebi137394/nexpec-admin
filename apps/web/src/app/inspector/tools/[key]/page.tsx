'use client';
// /inspector/tools/[key] — Tool Foundry runner. Renders the tool's input_schema,
// calls runTool (tool_invoke for DSL / tool-document for edge), and reveals the
// sealed result. Mirrors mobile app/tools/[key].tsx — same backend, same shape.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Calculator, FileText, Lock, AlertCircle, ShieldCheck } from 'lucide-react';
import {
  fetchEngineeringTools,
  runTool,
  catColor,
  type EngineeringTool,
  type ToolField,
  type ToolResult,
} from '@/lib/data/tools';

const TONE: Record<string, string> = {
  success: 'text-accent-green',
  warn: 'text-accent-amber',
  danger: 'text-accent-red',
  default: 'text-white',
};

const inputCls =
  'w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-sm text-white placeholder-white/40 outline-none focus:border-violet';

export default function ToolRunnerPage() {
  const params = useParams<{ key: string }>();
  const key = (params?.key ?? '') as string;

  const [tools, setTools] = useState<EngineeringTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);

  useEffect(() => {
    fetchEngineeringTools()
      .then(setTools)
      .catch(() => setTools([]))
      .finally(() => setLoading(false));
  }, []);

  const tool = useMemo(() => tools.find((t) => t.key === key), [tools, key]);

  // Seed defaults once the tool resolves.
  useEffect(() => {
    if (!tool) return;
    const seed: Record<string, string> = {};
    for (const f of tool.input_schema) {
      if (f.defaultValue != null) seed[f.name] = String(f.defaultValue);
    }
    setValues(seed);
    setResult(null);
    setErrors({});
  }, [tool]);

  const setField = (name: string, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => (e[name] ? { ...e, [name]: '' } : e));
  };

  const validate = (fields: ToolField[]): boolean => {
    const next: Record<string, string> = {};
    for (const f of fields) {
      const raw = (values[f.name] ?? '').trim();
      if (f.required && raw === '') {
        next[f.name] = 'Required';
        continue;
      }
      if (raw !== '' && f.type === 'number') {
        const n = Number(raw);
        if (Number.isNaN(n)) next[f.name] = 'Enter a number';
        else if (f.validation?.min != null && n < f.validation.min) next[f.name] = `Min ${f.validation.min}`;
        else if (f.validation?.max != null && n > f.validation.max) next[f.name] = `Max ${f.validation.max}`;
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async () => {
    if (!tool) return;
    if (!validate(tool.input_schema)) return;
    // Coerce number fields; pass the rest as-is.
    const payload: Record<string, unknown> = {};
    for (const f of tool.input_schema) {
      const raw = (values[f.name] ?? '').trim();
      if (raw === '') continue;
      payload[f.name] = f.type === 'number' ? Number(raw) : raw;
    }
    setRunning(true);
    setResult(null);
    try {
      const res = await runTool(tool.key, payload, tool.engine);
      setResult(res);
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return <div className="h-48 animate-pulse rounded-xl border border-ink-600 bg-ink-800" />;
  }
  if (!tool) {
    return (
      <div>
        <BackLink />
        <p className="mt-6 text-white/60">Tool not found.</p>
      </div>
    );
  }

  const accent = catColor(tool.category);
  const Icon = tool.engine === 'edge' ? FileText : Calculator;
  const cards = result?.result_cards ?? [];

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink />

      <header className="mt-4 flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${accent}22` }}
        >
          <Icon size={20} style={{ color: accent }} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-xl font-extrabold">{tool.title}</h1>
            {tool.access_tier === 'pro' && <Lock size={13} className="text-white/40" />}
          </div>
          {tool.subtitle && <p className="text-sm text-white/60">{tool.subtitle}</p>}
        </div>
      </header>

      {/* Input form */}
      <div className="mt-6 space-y-4 rounded-xl border border-ink-600 bg-ink-800 p-4">
        {tool.input_schema.map((f) => (
          <Field key={f.name} field={f} value={values[f.name] ?? ''} error={errors[f.name]} onChange={setField} />
        ))}
        <button
          type="button"
          onClick={onSubmit}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2.5 text-sm font-bold transition hover:bg-violet-deep disabled:opacity-60"
        >
          <Calculator size={15} />
          {running ? 'Calculating…' : tool.engine === 'edge' ? 'Generate' : 'Calculate'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="mt-6">
          {result.ok === false && result.locked ? (
            <Notice
              icon={<Lock size={18} className="text-accent-amber" />}
              tone="border-accent-amber/40 bg-accent-amber/10 text-accent-amber"
              title="Pro tool"
              body="Upgrade to unlock this calculator."
            />
          ) : result.ok === false ? (
            <Notice
              icon={<AlertCircle size={18} className="text-accent-red" />}
              tone="border-accent-red/40 bg-accent-red/10 text-accent-red"
              title="Check your inputs"
              body={result.detail ?? 'Could not compute.'}
            />
          ) : (
            <div className="rounded-xl border border-ink-600 bg-ink-800 p-4">
              <h2 className="text-sm font-extrabold uppercase tracking-widest text-violet-glow">
                {result.title ?? 'Result'}
              </h2>
              <div className="mt-3 space-y-2">
                {cards.map((c, i) => (
                  <div
                    key={`${c.label}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-ink-600 bg-ink-950 px-3.5 py-3"
                  >
                    <span className="text-sm text-white/60">{c.label}</span>
                    <span className={`text-lg font-extrabold ${TONE[c.tone ?? 'default'] ?? 'text-white'}`}>
                      {c.value}
                      {c.unit ? ` ${c.unit}` : ''}
                    </span>
                  </div>
                ))}
              </div>
              {result.citations && result.citations.length > 0 && (
                <p className="mt-3 text-xs leading-relaxed text-white/40">
                  {result.citations.join('   ·   ')}
                </p>
              )}
              {result.result_sha256 && (
                <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-accent-green">
                  <ShieldCheck size={14} />
                  Sealed · {result.result_sha256.slice(0, 12)}…
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  field,
  value,
  error,
  onChange,
}: {
  field: ToolField;
  value: string;
  error?: string;
  onChange: (name: string, value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-white/70">
        {field.label}
        {field.required && <span className="text-accent-red"> *</span>}
      </label>
      {field.type === 'select' ? (
        <select
          value={value}
          onChange={(e) => onChange(field.name, e.target.value)}
          className={inputCls}
        >
          <option value="">{field.placeholder ?? 'Select…'}</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          value={value}
          min={field.validation?.min}
          max={field.validation?.max}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.name, e.target.value)}
          className={inputCls}
        />
      )}
      {field.helperText && !error && <p className="mt-1 text-[11px] text-white/40">{field.helperText}</p>}
      {error && <p className="mt-1 text-[11px] text-accent-red">{error}</p>}
    </div>
  );
}

function Notice({
  icon,
  tone,
  title,
  body,
}: {
  icon: React.ReactNode;
  tone: string;
  title: string;
  body: string;
}) {
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-4 ${tone}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="text-sm font-bold">{title}</p>
        <p className="mt-0.5 text-sm text-white/70">{body}</p>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/inspector/tools"
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/60 transition hover:text-white"
    >
      <ArrowLeft size={15} /> Engineering Tools
    </Link>
  );
}
