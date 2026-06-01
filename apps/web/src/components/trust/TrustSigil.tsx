// ════════════════════════════════════════════════════════════════════════════
//  components/trust/TrustSigil.tsx — generated, identity-free inspector avatar
//
//  Replaces the real profile photo on public surfaces. A deterministic gradient
//  squircle + a small "verified constellation" derived purely from the opaque
//  UUID — same inspector always gets the same sigil, but it reveals nothing.
//  Pure SVG: zero external services, zero cost, server-renderable (no hooks).
// ════════════════════════════════════════════════════════════════════════════

import { inspectorHash, sigilGradient } from '@/lib/identity/inspectorHandle';

interface TrustSigilProps {
  id: string;
  size?: number;
  className?: string;
}

export function TrustSigil({ id, size = 96, className }: TrustSigilProps) {
  const [from, to] = sigilGradient(id);
  const h = inspectorHash('nexpec-sigil-pattern:' + id);
  const gid = `nxsig-${inspectorHash('grad:' + id).toString(36)}`;

  // Three nodes placed deterministically inside a safe inner box [28..72].
  // Explicit consts (not index access) to satisfy noUncheckedIndexedAccess.
  const mk = (i: number) => {
    const hx = (h >> (i * 5)) & 31;
    const hy = (h >> (i * 5 + 3)) & 31;
    return { x: 28 + (hx / 31) * 44, y: 28 + (hy / 31) * 44 };
  };
  const n0 = mk(0);
  const n1 = mk(1);
  const n2 = mk(2);
  const nodes = [n0, n1, n2];

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="NEXPEC verified-inspector sigil"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="96" height="96" rx="26" fill={`url(#${gid})`} />
      {/* soft depth highlight */}
      <circle cx="74" cy="26" r="34" fill="#ffffff" opacity="0.08" />
      {/* verified constellation */}
      <path
        d={`M${n0.x.toFixed(1)} ${n0.y.toFixed(1)} L${n1.x.toFixed(1)} ${n1.y.toFixed(1)} L${n2.x.toFixed(1)} ${n2.y.toFixed(1)}`}
        stroke="#ffffff"
        strokeOpacity="0.45"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {nodes.map((n, i) => (
        <circle key={i} cx={n.x.toFixed(1)} cy={n.y.toFixed(1)} r={i === 0 ? 4.5 : 3} fill="#ffffff" fillOpacity="0.92" />
      ))}
    </svg>
  );
}
