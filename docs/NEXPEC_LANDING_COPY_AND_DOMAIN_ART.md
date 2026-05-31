# NEXPEC Landing — Copy Overhaul + 5-Domain Art Direction

_Fixing the discrepancy: the live page reads as a niche NDT/oil-&-gas app; the
product is the universal engineering-inspection standard (Industrial & NDT,
Civil & Construction, Electrical, Mechanical Field, Chemical & Process). This is
copy + art direction only — no code until the images are generated and uploaded._

---

## 1. Copy overhaul

### Hero

**Eyebrow** (was `Now live · Industrial Inspection Marketplace`)
> NOW LIVE · THE ENGINEERING INSPECTION STANDARD

**Headline** — keep the proven two-line structure (line 2 is the violet→cyan
gradient). The fix is line 1: drop "industrial," claim every field.

- **Recommended:**
  - Line 1: **Hire vetted inspectors. Any engineering field.**
  - Line 2 (gradient): **Escrow holds every dollar.**
- Alternates (pick by taste):
  - L1 *"One marketplace for every inspection."* / L2 *"Escrow holds every dollar."*
  - L1 *"Every engineering discipline, on demand."* / L2 *"Provably trusted. Escrow-backed."*
  - L1 *"The inspection standard for all of engineering."* / L2 *"Signed, sealed, escrowed."*

**Subhead** (was "Pipeline, structural, NDT, and CCI inspections — dispatched in
minutes, audited to the byte, paid only on a signed report.")
> From pipelines and pressure vessels to bridges, switchgear, rotating
> equipment, and process plants — five engineering disciplines, dispatched in
> minutes, audited to the byte, and paid only on a signed, tamper-proof report.

_(Weaves all five: pipelines/vessels = Industrial & NDT, bridges = Civil,
switchgear = Electrical, rotating equipment = Mechanical, process plants =
Chemical.)_

**Trust chips** stay (domain-neutral): Stripe-backed escrow · SOC 2 aligned
controls · Cryptographically signed reports. _(Optional future swap once the
tech sections ship: replace one with "On-device AI" or "Bitcoin-anchored seals.")_

### How it works (heading "From scope to signature in three steps." stays)

1. **Post the scope**
   > Describe the asset and the standard — API, ASME, ACI, NETA, OSHA PSM, AWS —
   > and the deadline. Our spec assistant suggests requirements from similar jobs
   > in your discipline.

2. **Match in minutes**
   > Vetted inspectors apply, ranked by discipline and proximity. You pick.
   > Escrow funds the moment both parties sign.

3. **Audit-grade delivery**
   > Photos, findings, and signatures land in a cryptographically-sealed report —
   > every defect bound to the model that found it and anchored beyond dispute.
   > Approve to release escrow.

_(Step 1 swaps the NDT-only standards list for all five disciplines; step 3 now
tees up the Provable-AI + blockchain sections without overclaiming.)_

### Industries section heading (was "Built for the inspections nobody else will touch.")
- **Eyebrow:** EVERY ENGINEERING DISCIPLINE
- **Heading (recommended):** **From the refinery to the bridge to the grid.**
- Alternate: *"Five disciplines. One provable standard."* (note: PlatformScale
  already uses "One platform. Five disciplines.", so keep these distinct.)

---

## 2. The new 5-domain Industries grid

Replace the 8 oil-&-gas-skewed tiles with **five domain tiles — one per
configured domain** (your existing pipeline / pressure-vessel / welding / NDT
photos aren't wasted: they become supporting imagery inside the *Industrial &
NDT* domain). Layout at build time can be a clean 5-up row (like PlatformScale's
domain cards) or 3 + 2; that's a code decision for later.

Each tile is **1:1 (square)** to drop into the existing `aspect-square` slot, and
matches the established neon-industrial aesthetic of the current tiles (photoreal
scene, near-black navy, electric-violet + cyan accents) so it blends with both
the existing grid and the new tech sections.

### Midjourney v6 prompts — the five domain tiles (all `--ar 1:1`)

**(1) Industrial & NDT** — _Asset Integrity Manager_
> Cinematic photoreal close shot at a refinery at dusk: a gloved inspector's hand
> pressing a phased-array NDT ultrasonic probe against a thick steel pipe weld,
> a glowing cyan ultrasonic waveform and a translucent electric-violet (#7C3AED)
> inspection grid radiating from the contact point, pipelines and pressure
> vessels softly bokeh'd behind, near-black navy atmosphere (#020420), dramatic
> violet rim light, ultra-detailed, 8k --ar 1:1 --style raw --stylize 250 --v 6.0

**(2) Civil & Construction** — _Construction Project Manager_
> Cinematic photoreal wide shot of a monumental cable-stayed bridge and exposed
> structural-steel framework with concrete and rebar under construction at dusk,
> a translucent electric-violet (#7C3AED) laser-scan survey grid mapping the
> structure with glowing cyan measurement nodes along the beams, near-black navy
> sky (#020420), volumetric haze, dramatic rim lighting, monumental scale,
> ultra-detailed, 8k --ar 1:1 --style raw --stylize 250 --v 6.0

**(3) Electrical** — _Facility / Reliability Manager_
> Cinematic photoreal shot inside a dark high-voltage electrical substation /
> switchgear hall, an infrared thermography overlay rendering hot-spots as a
> violet-to-cyan heat gradient across the busbars, faint controlled arcs of
> electric-violet (#7C3AED) energy tracing the conductors, near-black navy
> environment (#020420), moody industrial lighting, sense of precision and power,
> ultra-detailed, 8k --ar 1:1 --style raw --stylize 260 --v 6.0

**(4) Mechanical Field** — _Turnaround / Construction Manager_
> Cinematic photoreal shot of massive rotating equipment — an industrial pump and
> turbine with a piping manifold — mid-turnaround in a plant, a glowing electric-
> violet (#7C3AED) vibration-analysis waveform and a cyan shaft-alignment laser
> line crossing the machine, faint steam and metallic detail, near-black navy
> atmosphere (#020420), dramatic violet rim light, ultra-detailed, 8k
> --ar 1:1 --style raw --stylize 250 --v 6.0

**(5) Chemical & Process** — _HSE / Process Safety Manager_
> Cinematic photoreal night shot of a sprawling chemical / petrochemical process
> plant — distillation columns, reactors and insulated pipework lit from within,
> a faint translucent electric-violet (#7C3AED) process-safety data overlay and
> cyan flow-lines tracing the pipe runs, moody hazardous-industrial atmosphere,
> near-black navy sky (#020420), volumetric glow, ultra-detailed, 8k
> --ar 1:1 --style raw --stylize 260 --v 6.0

Consistency: generate (1) first and reuse its best frame as `--sref` on (2)–(5)
so the five tiles read as one set and sit beside the existing photography.

---

## 3. The unified asset manifest (everything to generate)

Nine images for the ultimate page. When you upload them I wire each into the
`assets-manifest` slot and build the sections — existing design + images
untouched.

| # | Section | Slot (proposed) | Ratio | Status |
|---|---|---|---|---|
| 1 | Industries · Industrial & NDT | `industry.industrial-ndt` | 1:1 | new |
| 2 | Industries · Civil & Construction | `industry.civil-construction` | 1:1 | new |
| 3 | Industries · Electrical | `industry.electrical` | 1:1 | new |
| 4 | Industries · Mechanical Field | `industry.mechanical-field` | 1:1 | new |
| 5 | Industries · Chemical & Process | `industry.chemical-process` | 1:1 | new |
| 6 | `<ProvableAI>` scan macro | `feature.provable-ai` | 16:9 | new (tech) |
| 7 | `<BlockchainSeals>` anchoring | `feature.blockchain-anchor` | 16:9 | new (tech) |
| 8 | `<PredictiveIntegrity>` digital twin | `feature.predictive-twin` | 16:9 | new (tech) |
| 9 | `<FieldResilience>` offline field | `feature.field-offline` | 16:9 | new (tech) |

The four 16:9 tech-section prompts are in
`docs/NEXPEC_LANDING_EVOLUTION_AND_AUDIT.md` §3D (Provable-AI scan macro,
Bitcoin anchoring, predictive digital twin, offline field resilience) — generate
those at `--ar 16:9`. Existing `/hero/hero-wide.jpg` and the `stamp-loop` video
stay as-is.

### Build order once images land
1. Swap the upgraded copy into Hero / HowItWorks / Industries (text only).
2. Replace the 8-tile grid data with the 5 domain tiles + new images.
3. Add the four sticky-reveal tech sections (`<ProvableAI>`, `<BlockchainSeals>`,
   `<PredictiveIntegrity>`, `<FieldResilience>`) between TrustPillars and
   PlatformScale, per the evolutionary strategy doc.
4. Add the `SectionTransition` cinematic glue. All additive; nothing removed.
