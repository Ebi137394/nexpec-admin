# apps/web/public/ — asset drop zone

Every image slot on the marketing surface points to a path under this folder.
Drop a file at the exact path declared in `src/lib/assets-manifest.ts` and
the matching `ImagePlaceholder` swaps to the real image on next reload —
no code change, no layout shift (CLS-free because the placeholder reserves
the exact aspect ratio).

## Folder map

```
apps/web/public/
├── brand/
│   ├── logo-wordmark.svg     ← Brand · Wordmark (icon + text) · 480×96 · 5:1
│   └── logo-mark.svg         ← Brand · Mark only · 256×256 · 1:1
├── hero/
│   └── hero-wide.jpg         ← Wide Hero · cinematic · 2560×1440 · 16:9
├── how-it-works/
│   ├── 01-post.jpg           ← 01 Post the scope · 1600×1200 · 4:3
│   ├── 02-match.jpg          ← 02 Match in minutes · 1600×1200 · 4:3
│   └── 03-audit.jpg          ← 03 Audit-grade delivery · 1600×1200 · 4:3
└── industries/
    ├── pipeline.jpg          ← Pipeline integrity · 1200×1200 · 1:1
    ├── pressure-vessels.jpg  ← Pressure vessels · 1200×1200 · 1:1
    ├── welding.jpg           ← Structural welding · 1200×1200 · 1:1
    ├── ndt.jpg               ← NDT & inspection · 1200×1200 · 1:1
    ├── electrical.jpg        ← Electrical compliance · 1200×1200 · 1:1
    ├── cci.jpg               ← CCI / coatings · 1200×1200 · 1:1
    ├── lifting.jpg           ← Lifting & rigging · 1200×1200 · 1:1
    └── refractory.jpg        ← Refractory · 1200×1200 · 1:1
```

12 image slots + 2 brand assets = 14 files total to fill the marketing
surface.

## Format & encoding

- **Logos** → SVG. Vector, no rasters. The inline-SVG fallback in
  `components/Logo.tsx` keeps the page bootable until the files land.
- **Photographic slots** → JPEG at quality 82, or WebP. Avoid PNG for
  photography (huge files, no quality win). `next/image` will serve AVIF
  / WebP variants automatically once the source JPEG exists.

## Colour grade — match the page

Every photographic asset must share a single grade so the page reads as
one composition rather than a collage of unrelated shots:

- Deep indigo / ink-blue base (`#020420` → `#11153B`)
- **Violet rim lighting** on metal edges and equipment (`#7C3AED` →
  `#A78BFA` highlights)
- **Cyan accents** for trust signals — LEDs on instruments, sensor lamps,
  HUD glows (`#00CFD5`)
- Pre-dawn or dusk timing — never midday flat light
- 35mm look, shallow depth of field, photoreal
- No legible logos, no faces toward camera, no stock-photo handshakes

## How the swap actually works

`ImagePlaceholder` renders both a `next/image` and a placeholder div in
the same aspect-ratio container. On image load success, the placeholder
fades out behind the real image. On 404, it stays visible. There's no
build-time scan — Next.js handles the request, the OS handles the file
existence, and the placeholder is the graceful fallback.

## Asset-status overview page

A status page that renders every slot side-by-side will land in a follow-up
sprint at `/admin/assets-status` (super_admin only). Until then,
`src/lib/assets-manifest.ts` is the canonical list.
