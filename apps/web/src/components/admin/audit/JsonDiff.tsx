// ════════════════════════════════════════════════════════════════════════════
//  components/admin/audit/JsonDiff.tsx
//
//  Before/after JSON viewer. Renders two columns side-by-side on desktop,
//  stacked on mobile. Each changed key is keyed visually:
//
//    - keys that exist in BOTH and changed value: red strike on left,
//      green on right.
//    - keys ONLY in `after` (added): green left-pad on the right side.
//    - keys ONLY in `before` (removed): red left-pad on the left side.
//
//  Pure visual — no syntax-highlighting library, just intentional
//  monospace + colour. Auditors don't need rainbow highlighting; they
//  need the diff to be unambiguous and copyable.
// ════════════════════════════════════════════════════════════════════════════

interface JsonDiffProps {
  before: Record<string, unknown> | null | undefined;
  after: Record<string, unknown> | null | undefined;
}

export function JsonDiff({ before, after }: JsonDiffProps) {
  const b = before ?? {};
  const a = after ?? {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();

  if (keys.length === 0) {
    return (
      <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-zinc-500">
        This event has no field-level diff (likely a row-level INSERT or DELETE).
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Column heading="Before" tone="red">
        <Pre items={keys.map((k) => ({ k, v: b[k], present: k in b }))} side="before" otherSide={a} />
      </Column>
      <Column heading="After" tone="green">
        <Pre items={keys.map((k) => ({ k, v: a[k], present: k in a }))} side="after" otherSide={b} />
      </Column>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────── */

function Column({
  heading,
  tone,
  children,
}: {
  heading: string;
  tone: 'red' | 'green';
  children: React.ReactNode;
}) {
  const headColor = tone === 'red' ? 'text-accent-red' : 'text-accent-green';
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="border-b border-white/[0.06] px-4 py-2">
        <p className={`text-[10px] font-semibold uppercase tracking-industrial ${headColor}`}>
          {heading}
        </p>
      </div>
      <div className="max-h-[60vh] overflow-auto p-3">{children}</div>
    </div>
  );
}

interface PreItem {
  k: string;
  v: unknown;
  present: boolean;
}

function Pre({
  items,
  side,
  otherSide,
}: {
  items: PreItem[];
  side: 'before' | 'after';
  otherSide: Record<string, unknown>;
}) {
  return (
    <pre className="font-mono text-xs leading-relaxed text-zinc-300">
      {'{'}
      {items.map(({ k, v, present }, i) => {
        const inOther = k in otherSide;
        // Removed: present only on `before`. Added: present only on `after`.
        const addedOrRemoved =
          (side === 'before' && !inOther) ||
          (side === 'after' && !inOther);
        const changed = inOther && JSON.stringify(otherSide[k]) !== JSON.stringify(v);

        let tone = 'text-zinc-300';
        let marker = ' ';
        if (!present) {
          // missing key on this side — render placeholder line
          return (
            <span key={k} className="block pl-2 text-zinc-700">
              {'  '}
              <span className="opacity-50">{`"${k}": <absent>`}</span>
              {i < items.length - 1 ? ',' : ''}
            </span>
          );
        }
        if (addedOrRemoved) {
          tone = side === 'after' ? 'text-accent-green' : 'text-accent-red';
          marker = side === 'after' ? '+' : '−';
        } else if (changed) {
          tone = side === 'after' ? 'text-accent-green' : 'text-accent-red';
          marker = '~';
        }
        const sep = i < items.length - 1 ? ',' : '';
        return (
          <span key={k} className={`block pl-2 ${tone}`}>
            <span className="select-none text-zinc-600">{marker} </span>
            {`"${k}": ${formatValue(v)}`}
            {sep}
          </span>
        );
      })}
      {'}'}
    </pre>
  );
}

function formatValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v, null, 2)
      .split('\n')
      .map((line, i) => (i === 0 ? line : `  ${line}`))
      .join('\n');
  } catch {
    return '<unserializable>';
  }
}
