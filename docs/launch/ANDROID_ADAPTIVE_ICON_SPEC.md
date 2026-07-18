# Android Adaptive Icon — asset specification (manual graphic required)

**Problem (verified):** `assets/adaptive-icon.png` is **byte-identical** to `assets/icon.png` (same MD5 `cb975bba2216ce10a60e6c0ffe9941a2`). Android adaptive icons mask the foreground to a shape and zoom it ~1.5×, so a full-bleed square icon used as the foreground will be **cropped and mis-scaled** by launchers.

**Config (already correct in `app.config.js`):**
```
android.adaptiveIcon.foregroundImage = './assets/adaptive-icon.png'
android.adaptiveIcon.backgroundColor = '#020420'
```
No config change is needed — only the **graphic** must be replaced. This cannot be produced from the sandbox; create it manually to this spec.

## Foreground spec (`assets/adaptive-icon.png`)
- Canvas: **1024 × 1024 px**, PNG, transparent background (RGBA).
- Safe zone: keep all essential logo content within the **center 66%** — i.e. a **~672 px** centered circle/square. Anything outside may be clipped by round/squircle masks.
- Padding: at least **~176 px** clear margin on every side.
- Content: the NEXPEC mark only (no full-bleed background — the background is provided by `backgroundColor: '#020420'`).
- No text near edges; no drop shadows baked in.

## Background
- Solid `#020420` (already set). If you prefer a gradient, supply a separate `adaptiveIconBackground` image at 1024×1024 (opaque) and switch `backgroundColor` → `backgroundImage`. Solid color is recommended (smaller, safer).

## Optional but recommended
- `assets/icon.png` (the iOS/legacy icon) stays full-bleed 1024×1024 (correct as-is).
- Add a **monochrome** layer for Android 13+ themed icons later (post-launch, optional): `android.adaptiveIcon.monochromeImage` (1024×1024, single-color silhouette on transparent).

## Verify after replacing the graphic
1. `npx expo prebuild -p android --clean` (in a full dev env) and inspect `android/app/src/main/res/mipmap-*/` — the foreground should show the logo centered with margin.
2. Install on a device with round, squircle, and rounded-square launcher masks (Pixel launcher lets you switch) — the logo must never be clipped.
3. Play Console → the 512×512 store icon is a SEPARATE asset (full-bleed) — also required.
