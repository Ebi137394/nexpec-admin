import React, { useState, useEffect, useCallback } from "react";

// ──────────────────────────────────────────────────────────────────────────
// NEXPEC — LinkedIn launch drip campaign, designed slides (Day 1–5)
// Brand: navy #020420, electric violet #7C3AED, white/gray text.
// Colors are applied via inline styles (exact hex); layout via Tailwind core.
// ──────────────────────────────────────────────────────────────────────────

const NAVY = "#020420";
const NAVY_2 = "#070A2E";
const VIOLET = "#7C3AED";
const VIOLET_GLOW = "#A78BFA";
const WHITE = "#FFFFFF";
const MUTED = "#9AA3B2";
const HAIR = "rgba(255,255,255,0.08)";

// Rich text: string | [{ t, a? }]  (a = accent/violet)
function Rich({ parts, className, style }) {
  if (typeof parts === "string") return <span className={className} style={style}>{parts}</span>;
  return (
    <span className={className} style={style}>
      {parts.map((p, i) => (
        <span key={i} style={{ color: p.a ? VIOLET_GLOW : undefined }}>{p.t}</span>
      ))}
    </span>
  );
}

const DAY_THEME = {
  1: "THE PROBLEM & THE REVEAL",
  2: "THE TRUST STACK",
  3: "THE FIELD COMPANION",
  4: "ENTERPRISE COMMAND CENTER",
  5: "THE CLOSE",
};
const DAY_FORMAT = {
  1: "Carousel",
  2: "Hero video",
  3: "Field video",
  4: "Static graphic",
  5: "Recap carousel",
};

const SLIDES = [
  // ── DAY 1 — Carousel (6) ────────────────────────────────────────────────
  { day: 1, t: "cover",
    headline: [{ t: "The inspection industry\n" }, { t: "still runs on a PDF\n" }, { t: "and " }, { t: "“just trust me.”", a: true }],
    sub: "That ends now." },
  { day: 1, t: "statement", headline: [{ t: "The old workflow is\nexhausting — for " }, { t: "everyone.", a: true }] },
  { day: 1, t: "list", kickerOverride: "EVERYONE FEELS IT",
    items: [
      { k: "Clients", v: "can’t verify the reports they pay for." },
      { k: "Inspectors", v: "chase niche jobs — and late payments." },
      { k: "Vendors", v: "have no trusted way in." },
      { k: "Agencies", v: "drown in spreadsheets & dispatching." },
      { k: "EPCs", v: "lack one system for compliance." },
    ] },
  { day: 1, t: "cover",
    headline: [{ t: "So I built " }, { t: "NEXPEC.", a: true }],
    sub: "A smart, automated, security-first inspection ecosystem." },
  { day: 1, t: "statement",
    headline: [{ t: "Trust isn’t a promise.\nIt’s something you can " }, { t: "verify.", a: true }] },
  { day: 1, t: "cta",
    headline: [{ t: "Pulling back the curtain —\nall week." }],
    sub: "Follow along. 👇  Link in the first comment." },

  // ── DAY 2 — Hero video frames (3) ───────────────────────────────────────
  { day: 2, t: "video", time: "▶  0:00 – 0:04",
    overlay: [{ t: "Can you " }, { t: "prove", a: true }, { t: " this\ninspection is real?" }] },
  { day: 2, t: "video", time: "▶  0:12 – 0:20", check: true,
    overlay: [{ t: "AUTHENTIC & UNTOUCHED" }],
    caption: "An unalterable digital signature on every report." },
  { day: 2, t: "video", time: "▶  0:20 – 0:32", lock: true,
    overlay: [{ t: "Funds secured up front.\nReleased on approval." }],
    caption: "Inspectors paid faster. Clients pay only for approved work." },

  // ── DAY 3 — Field video frames (4) ──────────────────────────────────────
  { day: 3, t: "video", time: "▶  0:00 – 0:04", nosignal: true,
    overlay: [{ t: "Industrial sites don’t\nhave Wi-Fi." }] },
  { day: 3, t: "video", time: "▶  0:04 – 0:10",
    overlay: [{ t: "📶  100% offline.\n" }, { t: "Syncs when you reconnect.", a: true }] },
  { day: 3, t: "video", time: "▶  0:10 – 0:18",
    overlay: [{ t: "⚡  Flash Reports" }],
    caption: "Send critical findings the moment they happen — not days later." },
  { day: 3, t: "grid", kickerOverride: "ONE DAILY COMPANION",
    cards: [
      { i: "🧰", k: "Engineering toolkit", v: "Field calculators built in." },
      { i: "💬", k: "Secure in-app chat", v: "No more WhatsApp groups." },
      { i: "🤖", k: "Private on-device AI", v: "Your data never leaves." },
      { i: "🔔", k: "Smart notifications", v: "Everyone, perfectly in sync." },
    ] },

  // ── DAY 4 — Enterprise (2) ──────────────────────────────────────────────
  { day: 4, t: "cover",
    headline: [{ t: "One Command Center.\n" }, { t: "Total control.", a: true }],
    sub: "For Organizations & EPCs — a control tower, not just an account." },
  { day: 4, t: "grid", kickerOverride: "ENTERPRISE-GRADE",
    cards: [
      { i: "🏗️", k: "Team structures", v: "Mirror your real org chart." },
      { i: "✅", k: "Approval gates", v: "Multi-department sign-off." },
      { i: "💰", k: "Budget control", v: "Allocations & spend policies." },
      { i: "🧾", k: "Audit-ready trails", v: "Who did what, when, why." },
    ],
    bottom: "💻📱  Web in the office · Mobile in the field · perfectly in sync" },

  // ── DAY 5 — Recap carousel (5) ──────────────────────────────────────────
  { day: 5, t: "cover",
    headline: [{ t: "The whole picture." }], sub: "Everything I showed you this week 👇" },
  { day: 5, t: "statement", headline: [{ t: "🔒  Verify every report.\n💸  Get paid on " }, { t: "approval.", a: true }] },
  { day: 5, t: "statement", headline: [{ t: "📶  Offline field app.\n⚡  Flash Reports.\n🧰  Engineering toolkit." }] },
  { day: 5, t: "statement", headline: [{ t: "🏢  Enterprise command center.\n💻📱  Field + office, " }, { t: "in sync.", a: true }] },
  { day: 5, t: "cta",
    headline: [{ t: "Step into " }, { t: "NEXPEC.", a: true }],
    sub: "Let’s build trust, together. 👇  Link in the first comment." },
];

// within-day numbering
const DAY_TOTALS = SLIDES.reduce((m, s) => ((m[s.day] = (m[s.day] || 0) + 1), m), {});
const DAY_INDEX = (() => {
  const counter = {};
  return SLIDES.map((s) => ((counter[s.day] = (counter[s.day] || 0) + 1), counter[s.day]));
})();

function Chevron({ dir }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {dir === "left" ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
    </svg>
  );
}

function Decor() {
  return (
    <>
      <div style={{ position: "absolute", right: -120, top: -120, width: 320, height: 320, borderRadius: "9999px", background: VIOLET, opacity: 0.16, filter: "blur(90px)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: -90, bottom: -90, width: 240, height: 240, borderRadius: "9999px", background: VIOLET, opacity: 0.1, filter: "blur(90px)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.5,
        backgroundImage: `linear-gradient(${HAIR} 1px, transparent 1px), linear-gradient(90deg, ${HAIR} 1px, transparent 1px)`,
        backgroundSize: "56px 56px", maskImage: "radial-gradient(circle at 50% 40%, black, transparent 78%)", WebkitMaskImage: "radial-gradient(circle at 50% 40%, black, transparent 78%)" }} />
    </>
  );
}

function Wordmark() {
  return (
    <div className="absolute flex items-center gap-2" style={{ left: 40, bottom: 36 }}>
      <span style={{ width: 14, height: 14, background: VIOLET, borderRadius: 4, boxShadow: `0 0 16px ${VIOLET}` }} />
      <span className="font-semibold tracking-tight" style={{ color: WHITE, fontSize: 18, letterSpacing: "-0.01em" }}>NEXPEC</span>
    </div>
  );
}

function multiline(text) {
  return String(text).split("\n").map((line, i) => <span key={i} style={{ display: "block" }}>{line}</span>);
}

function HeadlineBlock({ headline, size }) {
  // headline is array of parts; honor \n inside part text
  return (
    <h1 className="font-sans font-semibold" style={{ color: WHITE, fontSize: size, lineHeight: 1.08, letterSpacing: "-0.02em", whiteSpace: "pre-line", textWrap: "balance" }}>
      {headline.map((p, i) => (<span key={i} style={{ color: p.a ? VIOLET_GLOW : WHITE }}>{p.t}</span>))}
    </h1>
  );
}

function SlideBody({ s }) {
  if (s.t === "cover") {
    return (
      <div className="flex flex-col justify-center h-full" style={{ maxWidth: "92%" }}>
        <HeadlineBlock headline={s.headline} size={46} />
        {s.sub && <p className="mt-6 font-sans" style={{ color: MUTED, fontSize: 18, lineHeight: 1.5 }}>{s.sub}</p>}
      </div>
    );
  }
  if (s.t === "statement") {
    return (
      <div className="flex flex-col justify-center h-full">
        <HeadlineBlock headline={s.headline} size={44} />
      </div>
    );
  }
  if (s.t === "cta") {
    return (
      <div className="flex flex-col justify-center h-full">
        <HeadlineBlock headline={s.headline} size={44} />
        {s.sub && (
          <div className="mt-7 inline-flex items-center gap-3 self-start" style={{ border: `1px solid ${VIOLET}`, background: "rgba(124,58,237,0.12)", color: VIOLET_GLOW, borderRadius: 9999, padding: "12px 20px", fontSize: 15, fontWeight: 600 }}>
            {s.sub}
          </div>
        )}
      </div>
    );
  }
  if (s.t === "list") {
    return (
      <div className="flex flex-col justify-center h-full" style={{ width: "100%" }}>
        <div className="flex flex-col gap-4" style={{ marginTop: 8 }}>
          {s.items.map((it, i) => (
            <div key={i} className="flex items-baseline gap-3">
              <span style={{ color: VIOLET, fontSize: 22, lineHeight: 1 }}>—</span>
              <p className="font-sans" style={{ fontSize: 21, lineHeight: 1.35 }}>
                <span style={{ color: WHITE, fontWeight: 600 }}>{it.k}: </span>
                <span style={{ color: MUTED }}>{it.v}</span>
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (s.t === "grid") {
    return (
      <div className="flex flex-col justify-center h-full" style={{ width: "100%" }}>
        <div className="grid grid-cols-2 gap-4">
          {s.cards.map((c, i) => (
            <div key={i} style={{ border: `1px solid ${HAIR}`, background: "rgba(255,255,255,0.02)", borderRadius: 16, padding: 18 }}>
              <div style={{ fontSize: 26 }}>{c.i}</div>
              <div className="mt-2 font-sans" style={{ color: WHITE, fontSize: 17, fontWeight: 600 }}>{c.k}</div>
              <div className="mt-1 font-sans" style={{ color: MUTED, fontSize: 14, lineHeight: 1.4 }}>{c.v}</div>
            </div>
          ))}
        </div>
        {s.bottom && (
          <div className="mt-5 font-mono" style={{ color: VIOLET_GLOW, fontSize: 13, letterSpacing: "0.02em" }}>{s.bottom}</div>
        )}
      </div>
    );
  }
  if (s.t === "video") {
    return (
      <div className="flex flex-col justify-center items-center h-full text-center" style={{ width: "100%" }}>
        {/* play / status chip */}
        <div className="font-mono" style={{ color: MUTED, fontSize: 12, letterSpacing: "0.18em", marginBottom: 22 }}>
          {s.nosignal ? "● ● ●  NO SIGNAL" : "VIDEO FRAME"}
        </div>
        {s.check && (
          <div className="flex items-center justify-center mb-6" style={{ width: 84, height: 84, borderRadius: "9999px", background: "rgba(16,185,129,0.14)", border: "1px solid rgba(16,185,129,0.5)" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
        )}
        {s.lock && (
          <div className="flex items-center justify-center mb-6" style={{ width: 84, height: 84, borderRadius: "9999px", background: "rgba(124,58,237,0.14)", border: `1px solid ${VIOLET}` }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={VIOLET_GLOW} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          </div>
        )}
        <h1 className="font-sans font-semibold" style={{ color: s.check ? "#34D399" : WHITE, fontSize: s.check ? 30 : 38, lineHeight: 1.12, letterSpacing: "-0.01em", whiteSpace: "pre-line" }}>
          {s.overlay.map((p, i) => (<span key={i} style={{ color: p.a ? VIOLET_GLOW : (s.check ? "#34D399" : WHITE) }}>{p.t}</span>))}
        </h1>
        {s.caption && <p className="mt-5 font-sans" style={{ color: MUTED, fontSize: 16, lineHeight: 1.45, maxWidth: 420 }}>{s.caption}</p>}
        <div className="font-mono" style={{ position: "absolute", left: 40, top: 96, color: VIOLET_GLOW, fontSize: 12, letterSpacing: "0.1em" }}>{s.time}</div>
      </div>
    );
  }
  return null;
}

export default function NexpecLaunchSlides() {
  const [i, setI] = useState(0);
  const n = SLIDES.length;
  const s = SLIDES[i];
  const next = useCallback(() => setI((v) => (v + 1) % n), [n]);
  const prev = useCallback(() => setI((v) => (v - 1 + n) % n), [n]);

  useEffect(() => {
    const h = (e) => { if (e.key === "ArrowRight") next(); if (e.key === "ArrowLeft") prev(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [next, prev]);

  const dayStart = SLIDES.findIndex((x) => x.day === s.day);

  return (
    <div className="w-full flex flex-col items-center" style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: WHITE, padding: "8px 0" }}>
      {/* Day selector */}
      <div className="flex flex-wrap items-center justify-center gap-2 mb-5">
        {[1, 2, 3, 4, 5].map((d) => {
          const active = s.day === d;
          return (
            <button key={d} onClick={() => setI(SLIDES.findIndex((x) => x.day === d))}
              className="font-mono"
              style={{ fontSize: 12, letterSpacing: "0.08em", padding: "8px 12px", borderRadius: 9999, cursor: "pointer",
                border: `1px solid ${active ? VIOLET : HAIR}`, background: active ? "rgba(124,58,237,0.18)" : "transparent",
                color: active ? VIOLET_GLOW : MUTED }}>
              DAY {d}
            </button>
          );
        })}
      </div>

      {/* Stage */}
      <div className="relative w-full" style={{ maxWidth: 600 }}>
        {/* arrows */}
        <button onClick={prev} aria-label="Previous" className="absolute z-10 flex items-center justify-center"
          style={{ left: -8, top: "50%", transform: "translateY(-50%)", width: 44, height: 44, borderRadius: "9999px", background: NAVY_2, border: `1px solid ${HAIR}`, color: WHITE, cursor: "pointer" }}>
          <Chevron dir="left" />
        </button>
        <button onClick={next} aria-label="Next" className="absolute z-10 flex items-center justify-center"
          style={{ right: -8, top: "50%", transform: "translateY(-50%)", width: 44, height: 44, borderRadius: "9999px", background: NAVY_2, border: `1px solid ${HAIR}`, color: WHITE, cursor: "pointer" }}>
          <Chevron dir="right" />
        </button>

        {/* the square slide canvas */}
        <div className="relative overflow-hidden"
          style={{ width: "100%", aspectRatio: "1 / 1", background: `linear-gradient(160deg, ${NAVY_2} 0%, ${NAVY} 60%)`, borderRadius: 22, border: `1px solid ${HAIR}` }}>
          <Decor />

          {/* top-left kicker */}
          <div className="absolute font-mono" style={{ left: 40, top: 38, color: VIOLET_GLOW, fontSize: 11, letterSpacing: "0.22em" }}>
            {(s.kickerOverride || DAY_THEME[s.day])}
          </div>
          {/* top-right series tag */}
          <div className="absolute font-mono text-right" style={{ right: 40, top: 38, color: MUTED, fontSize: 11, letterSpacing: "0.18em" }}>
            DAY {s.day} / 5 · NEXPEC LAUNCH
          </div>

          {/* content */}
          <div className="absolute" style={{ left: 40, right: 40, top: 96, bottom: 92 }}>
            <SlideBody s={s} />
          </div>

          <Wordmark />
          {/* within-day counter */}
          <div className="absolute font-mono" style={{ right: 40, bottom: 38, color: MUTED, fontSize: 12, letterSpacing: "0.06em" }}>
            {DAY_INDEX[i]} / {DAY_TOTALS[s.day]}
          </div>
        </div>
      </div>

      {/* footer: format + dots */}
      <div className="flex flex-col items-center gap-3" style={{ marginTop: 18 }}>
        <div className="font-mono" style={{ color: MUTED, fontSize: 12, letterSpacing: "0.06em" }}>
          {DAY_FORMAT[s.day]} · slide {DAY_INDEX[i]} of {DAY_TOTALS[s.day]} · use ← → keys
        </div>
        <div className="flex items-center gap-1.5">
          {SLIDES.map((x, idx) => {
            const here = idx === i;
            const sameDay = x.day === s.day;
            return (
              <button key={idx} onClick={() => setI(idx)} aria-label={`Slide ${idx + 1}`}
                style={{ width: here ? 22 : 8, height: 8, borderRadius: 9999, cursor: "pointer", border: "none",
                  background: here ? VIOLET : sameDay ? "rgba(124,58,237,0.35)" : "rgba(255,255,255,0.14)", transition: "all .2s" }} />
            );
          })}
        </div>
      </div>
    </div>
  );
}
