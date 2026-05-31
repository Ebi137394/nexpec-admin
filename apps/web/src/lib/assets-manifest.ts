// ════════════════════════════════════════════════════════════════════════════
//  lib/assets-manifest.ts
//
//  Single source of truth for every image slot on the marketing surface.
//  When a real asset arrives, drop the file at the declared `path` and the
//  ImagePlaceholder will swap to the real image automatically (the
//  components read `path` and render <Image src={path}> when the asset
//  exists at build time).
//
//  Dimensions are the NATIVE @1x intrinsic size. Next/Image handles
//  responsive variants. Aspect ratio is locked at the slot — the placeholder
//  uses it to render the exact rectangle the real image will occupy, so
//  the layout never shifts when assets land (CLS-free).
//
//  AI prompt guidance is informational — included so whoever generates the
//  image has the styling brief alongside the dimensions.
// ════════════════════════════════════════════════════════════════════════════

export interface ImageSlot {
  /** Stable identifier — used by the ImagePlaceholder to label itself. */
  id: string;
  /** Human-readable label rendered in the placeholder. */
  slot: string;
  /** Path under apps/web/public/. When a file exists here, the real image
   *  replaces the placeholder. Do NOT include the `/public` prefix. */
  path: string;
  /** Intrinsic width in pixels @1x. */
  width: number;
  /** Intrinsic height in pixels @1x. */
  height: number;
  /** Aspect ratio as a CSS string, e.g. "16 / 9", "1 / 1". */
  aspectRatio: string;
  /** AI prompt direction — used when generating the matched asset. */
  prompt: string;
  /** Alt text. Default; component can override. */
  alt: string;
}

/* ── 1× Wide Hero Image ─────────────────────────────────────────────── */
export const HERO_WIDE: ImageSlot = {
  id: 'hero.wide',
  slot: 'Wide Hero · cinematic',
  // Dual-purpose asset: also referenced by the landing page's openGraph
  // metadata, so social-share previews use the same brand-aligned key art.
  path: '/og/landing.png',
  width: 1200,
  height: 630,
  aspectRatio: '1200 / 630',
  prompt:
    'Cinematic ultra-wide industrial inspection scene. Pre-dawn or dusk, refinery / pipeline silhouette under deep indigo sky with violet rim-lighting and trace cyan accents on equipment. Foreground: a single inspector with hard hat and HUD-style overlay, mid-stride toward camera. Photoreal, 35mm, shallow DOF. Mood: precision, authority, calm control. No people facing camera, no logos visible.',
  alt: 'NEXPEC — the industrial black box. Automated inspection, vetted inspectors, audited trust.',
};

/* ── Contact page banner ────────────────────────────────────────────── */
export const CONTACT_BANNER: ImageSlot = {
  id: 'contact.banner',
  slot: 'Contact · Talk to a human banner',
  // Same dual-purpose pattern: this file backs both the on-page banner
  // AND the contact route's openGraph image.
  path: '/og/contact.png',
  width: 1200,
  height: 630,
  aspectRatio: '1200 / 630',
  prompt:
    'A futuristic command-desk close-up — a glowing teal world map embedded in a brushed-aluminium console, headset and X-mark insignia visible, deep indigo industrial environment behind. Headline overlay: TALK TO A HUMAN.',
  alt: 'NEXPEC support — vetted operators standing by, worldwide.',
};

/* ── 3× How It Works cards ──────────────────────────────────────────── */
export const HOW_IT_WORKS_POST: ImageSlot = {
  id: 'how.post',
  slot: 'How It Works · 01 Post the scope',
  path: '/how-it-works/01-post.jpg',
  width: 1600,
  height: 1200,
  aspectRatio: '4 / 3',
  prompt:
    'Aerial top-down shot of an industrial-scale technical drawing or P&ID schematic on a dark table, with one inspector hand placing a tablet onto it. The tablet screen shows a clean form mockup in violet/cyan accents. Studio lighting from the left. Photoreal, no UI text legible. Same colour grade as hero (deep indigo + violet rim + cyan accents).',
  alt: 'Inspector posting a job scope on a tablet over a technical drawing',
};

export const HOW_IT_WORKS_MATCH: ImageSlot = {
  id: 'how.match',
  slot: 'How It Works · 02 Match in minutes',
  path: '/how-it-works/02-match.jpg',
  width: 1600,
  height: 1200,
  aspectRatio: '4 / 3',
  prompt:
    'A glowing geo-pinned map of an industrial region (refinery / port / power plant) on a dark dashboard, with three inspector profile chips orbiting a central job pin in violet. Sleek, futuristic, but grounded — looks like a real ops dashboard. Photoreal mixed with subtle UI compositing. Same dusk-violet palette.',
  alt: 'Inspector matching dashboard with geo-pinned candidates',
};

export const HOW_IT_WORKS_AUDIT: ImageSlot = {
  id: 'how.audit',
  slot: 'How It Works · 03 Audit-grade delivery',
  path: '/how-it-works/03-audit.jpg',
  width: 1600,
  height: 1200,
  aspectRatio: '4 / 3',
  prompt:
    'Macro close-up of a signed inspection certificate emerging from a printer, with a holographic security seal hovering above it. Background: out-of-focus violet-lit server rack. Sense of finality and trust. Photoreal, dramatic side-lighting. Same colour grade as the hero.',
  alt: 'A signed inspection certificate with a holographic security seal',
};

export const HOW_IT_WORKS_SLOTS: readonly ImageSlot[] = [
  HOW_IT_WORKS_POST,
  HOW_IT_WORKS_MATCH,
  HOW_IT_WORKS_AUDIT,
] as const;

/* ── 8× Industries tiles ────────────────────────────────────────────── */
export const INDUSTRY_SLOTS: readonly ImageSlot[] = [
  {
    id: 'industry.pipeline',
    slot: 'Industry · Pipeline integrity',
    path: '/industries/pipeline.jpg',
    width: 1200,
    height: 1200,
    aspectRatio: '1 / 1',
    prompt:
      'Cropped close-up of a buried-pipe excavation at dusk, exposed steel weld bead under violet inspection lamp. Photoreal, square crop. Same palette.',
    alt: 'Excavated pipeline weld under inspection light',
  },
  {
    id: 'industry.pressure-vessels',
    slot: 'Industry · Pressure vessels',
    path: '/industries/pressure-vessels.jpg',
    width: 1200,
    height: 1200,
    aspectRatio: '1 / 1',
    prompt:
      'Tight crop of a horizontal pressure vessel nozzle with welded flange, refinery in soft focus behind, violet rim-light, dusk. Photoreal, square crop.',
    alt: 'Pressure vessel nozzle and flange at a refinery',
  },
  {
    id: 'industry.welding',
    slot: 'Industry · Structural welding',
    path: '/industries/welding.jpg',
    width: 1200,
    height: 1200,
    aspectRatio: '1 / 1',
    prompt:
      'A structural fabrication shop, single welder arcing on a steel beam, sparks frozen mid-air, deep blue shop background, cyan glow on the helmet visor. Photoreal, square crop.',
    alt: 'Welder arcing on a structural steel beam',
  },
  {
    id: 'industry.ndt',
    slot: 'Industry · NDT & inspection',
    path: '/industries/ndt.jpg',
    width: 1200,
    height: 1200,
    aspectRatio: '1 / 1',
    prompt:
      'Macro shot of an ultrasonic NDT probe on a steel surface, coupling gel visible, faint violet LED on the meter. Photoreal, square crop. Hyper-clean, no legible text.',
    alt: 'Ultrasonic NDT probe on a steel surface',
  },
  {
    id: 'industry.electrical',
    slot: 'Industry · Electrical compliance',
    path: '/industries/electrical.jpg',
    width: 1200,
    height: 1200,
    aspectRatio: '1 / 1',
    prompt:
      'Inside an industrial electrical switchgear cabinet, gloved hand with multimeter probe touching a contactor, cyan glow from the meter. Photoreal, square crop.',
    alt: 'Electrical inspector probing a switchgear contactor',
  },
  {
    id: 'industry.cci',
    slot: 'Industry · CCI / coatings',
    path: '/industries/cci.jpg',
    width: 1200,
    height: 1200,
    aspectRatio: '1 / 1',
    prompt:
      'Close-up of a coating thickness gauge pressed against a freshly-painted industrial tank, dramatic side-lit dusk palette. Photoreal, square crop.',
    alt: 'Coating thickness gauge on a painted industrial tank',
  },
  {
    id: 'industry.lifting',
    slot: 'Industry · Lifting & rigging',
    path: '/industries/lifting.jpg',
    width: 1200,
    height: 1200,
    aspectRatio: '1 / 1',
    prompt:
      'Crane hook with rigging slings against a deep indigo industrial sky at dusk, violet rim-light tracing the hook edges. Photoreal, square crop.',
    alt: 'Crane hook with rigging slings at dusk',
  },
  {
    id: 'industry.refractory',
    slot: 'Industry · Refractory',
    path: '/industries/refractory.jpg',
    width: 1200,
    height: 1200,
    aspectRatio: '1 / 1',
    prompt:
      'Inside a furnace shell during a refractory inspection, the interior brick lining lit by a single inspection lamp throwing violet shadows. Photoreal, square crop.',
    alt: 'Furnace refractory lining under inspection',
  },

  // ── NEW · 5-domain expansion (ADDITIVE — the 8 tiles above are untouched) ──
  //   Domain-level tiles for the engineering domains not yet pictured. Clean
  //   `slot` labels render directly because Industries.tsx falls back to
  //   `slot.slot` when an id isn't in its label map — so NO component edit is
  //   needed. Drop the matching files at the `path` below.
  {
    id: 'domain.civil-construction',
    slot: 'Civil & Construction',
    path: '/industries/civil-construction.jpg',
    width: 1200,
    height: 1200,
    aspectRatio: '1 / 1',
    prompt:
      'Monumental cable-stayed bridge and structural steel under construction at dusk, translucent electric-violet laser-scan survey grid with cyan measurement nodes, navy sky. Photoreal, square crop.',
    alt: 'Civil & construction inspection — a bridge under a violet structural survey grid',
  },
  {
    id: 'domain.electrical',
    slot: 'Electrical',
    path: '/industries/electrical-substation.jpg',
    width: 1200,
    height: 1200,
    aspectRatio: '1 / 1',
    prompt:
      'Dark high-voltage switchgear hall, infrared thermography violet-to-cyan heat gradient across the busbars, controlled electric-violet arcs, deep navy. Photoreal, square crop.',
    alt: 'Electrical inspection — a high-voltage switchgear hall with a thermography overlay',
  },
  {
    id: 'domain.mechanical-field',
    slot: 'Mechanical Field',
    path: '/industries/mechanical-field.jpg',
    width: 1200,
    height: 1200,
    aspectRatio: '1 / 1',
    prompt:
      'Massive rotating equipment — pump and turbine with piping manifold — mid-turnaround, glowing electric-violet vibration-analysis waveform and cyan shaft-alignment laser, navy shadow. Photoreal, square crop.',
    alt: 'Mechanical-field inspection — rotating equipment with a violet vibration-analysis overlay',
  },
  {
    id: 'domain.chemical-process',
    slot: 'Chemical & Process',
    path: '/industries/chemical-process.jpg',
    width: 1200,
    height: 1200,
    aspectRatio: '1 / 1',
    prompt:
      'Sprawling petrochemical process plant at night, distillation columns and insulated pipework glowing from within, violet process-safety overlay and cyan flow-lines, navy-to-violet fog. Photoreal, square crop.',
    alt: 'Chemical & process inspection — a petrochemical plant at night with a violet schematic overlay',
  },
];

/* ── Brand / Logo assets ────────────────────────────────────────────── */
export const LOGO_ASSETS = {
  wordmark: {
    id: 'brand.logo-wordmark',
    slot: 'Brand · Wordmark (icon + text)',
    path: '/brand/logo-wordmark.svg',
    width: 480,
    height: 96,
    aspectRatio: '5 / 1',
    prompt:
      "SVG wordmark: a refined 'N' monogram inside a rounded square (gradient from #7C3AED violet to #00CFD5 cyan), followed by 'NEXPEC' in Geist Sans semibold, tracking -0.02em, kerned for a 24px nav. White text on transparent. Vector — no rasters.",
    alt: 'NEXPEC',
  } satisfies ImageSlot,
  mark: {
    id: 'brand.logo-mark',
    slot: 'Brand · Mark only (3D production render)',
    // Production: the 3D-rendered mark lives at /brand/logo-mark.png.
    // The .svg counterpart remains for favicon / OG / print contexts.
    path: '/brand/logo-mark.png',
    width: 665,
    height: 666,
    aspectRatio: '1 / 1',
    prompt:
      "3D metallic monogram render — chamfered 'N' inside a rounded-square card, violet-to-cyan rim light, deep indigo backdrop. Square aspect, scales cleanly from favicon to splash.",
    alt: 'NEXPEC mark',
  } satisfies ImageSlot,
  /** Vector mark fallback — still used by favicon + Apple touch icon. */
  markSvg: {
    id: 'brand.logo-mark-svg',
    slot: 'Brand · Mark (vector fallback)',
    path: '/brand/logo-mark.svg',
    width: 256,
    height: 256,
    aspectRatio: '1 / 1',
    prompt: 'SVG mark — scales crisp at any size. Used for favicon + manifest icons.',
    alt: 'NEXPEC mark',
  } satisfies ImageSlot,
} as const;

/** Flat list of every slot for the asset-status overview page. */
export const ALL_SLOTS: readonly ImageSlot[] = [
  LOGO_ASSETS.wordmark,
  LOGO_ASSETS.mark,
  HERO_WIDE,
  ...HOW_IT_WORKS_SLOTS,
  ...INDUSTRY_SLOTS,
];
