// ════════════════════════════════════════════════════════════════════════════
//  components/marketing/SectionTransition.tsx
//
//  Cinematic seam glue. A thin, decorative blend band placed between the new
//  full-bleed tech sections and the existing contained sections so the scroll
//  flows without a visible edge. Pure CSS, server-safe (no hooks) — additive,
//  touches nothing else. Drop it between sections in page.tsx.
// ════════════════════════════════════════════════════════════════════════════

export function SectionTransition() {
  return (
    <div aria-hidden className="relative h-24 w-full overflow-hidden bg-ink-950 sm:h-32">
      {/* vertical blend into the neighbouring dark backgrounds */}
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950 via-ink-950/80 to-ink-950" />
      {/* soft violet bloom marking the transition */}
      <div className="absolute left-1/2 top-1/2 h-40 w-[60rem] max-w-[110vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet/10 blur-[100px]" />
      {/* hairline */}
      <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-violet/30 to-transparent" />
    </div>
  );
}
