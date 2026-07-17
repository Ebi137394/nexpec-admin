# NEXPEC — LinkedIn Launch Package

*Five ready‑to‑post versions + strategy. Written to sound like a founder who built the thing, not a press release. Pick one as your primary; keep the others for follow‑up posts over launch week.*

> **Voice notes before you post:** read each one out loud. If a line sounds like a brochure, cut it. Keep your real numbers where I've left placeholders in `[brackets]`. Don't stack more than 2–3 emojis in the whole post. Post as *you*, from your personal profile — founders outperform company pages on reach.

---

## 1. Headline options (the hook / first line)

The first 1–2 lines are all most people see before "…more". Lead with tension or a concrete image, not "I'm excited to announce."

1. **The best inspectors in the world work in places with no internet. So we built the AI to work there too.**
2. **Most industrial inspections still get booked over email and delivered as a PDF. We thought that was strange enough to fix.**
3. **We put a defect‑detecting AI on a phone, made it run with zero signal, and pointed it at the welds holding up the world.**
4. **Two years of "why is this still done on paper?" turned into NEXPEC. Today it's live.**

---

## 2. Launch post (primary — confident, concrete)

> The best inspectors in the world often work where there's no internet — on rigs, inside tanks, deep in refineries. Which is exactly where every "cloud‑powered" inspection tool quietly stops working.

So we built NEXPEC around that reality instead of ignoring it.

NEXPEC is a marketplace for industrial inspection and NDT work — the checks on welds, pipelines, tanks, and structures that keep heavy industry from failing. Clients post work, certified inspectors and agencies get matched and hired, and the whole job runs in one place.

The part I'm most proud of: the AI co‑inspector runs **entirely on the device**. Point the camera at a weld or a corroded surface and it outlines the defects as precise polygons — no signal, no cloud GPU, no data leaving the phone. When an inspector corrects one of those outlines, that correction quietly trains the next version of the model. The product gets sharper every time someone uses it.

And every AI finding is cryptographically tied to a signed model version — so a report isn't just a PDF someone could've edited. It's provable.

Mobile app and web dashboard, sharing one core, launching now.

If you work in inspection, energy, or industrial safety — or you invest in the unglamorous software that keeps the physical world running — I'd genuinely love to talk.

`[link]`

---

## 3. Storytelling version (narrative, origin‑driven)

> There's a moment that stuck with me. An inspector finishing a job on a site with no signal, standing near the exit just to get one bar so he could upload his photos before he forgot which was which.

That's the industry that inspects the infrastructure we all depend on. Brilliant, certified people — handed tools that assume a perfect connection and a desk.

That moment is basically why NEXPEC exists.

We started with one stubborn question: what would inspection software look like if you designed it for the field first, and the office second? Not a cloud app with an "offline mode" bolted on — actually offline. Actually mobile. Actually built for someone in a hard hat, one‑handed, in bad light.

So the AI runs on the phone itself. The corrections inspectors make feed the next model. Reports are provable, not just printable. And the whole thing stays in sync with a full web command center for the people running operations.

It took longer to do it this way. It was worth it.

Today NEXPEC is live. If any of this resonates — as a user, a partner, or someone who's felt this pain — my inbox is open.

`[link]`

---

## 4. Technical version (for the engineering / builder audience)

> A few of the engineering decisions behind NEXPEC that I think are worth sharing:

**The AI runs on‑device, on both platforms, from one decoder.** We ship custom YOLO‑segmentation models (weld + corrosion) bundled into the app — inference happens on the phone with zero network. The web dashboard runs the *same* model in‑browser via WebAssembly. The catch most teams hit is drift between platforms; we solved it by writing the post‑processing decoder once, in framework‑agnostic TypeScript, and importing it from source into both clients. There is physically one implementation to keep correct.

**The tensor contract self‑configures.** When a model export came back with a different shape and class count than expected, instead of hardcoding numbers we made the decoder derive its entire layout from the output tensor dimensions. New model, new dataset, no code change.

**Offline‑first isn't a mode, it's the spine.** Every field write goes through a durable local outbox and reconciles on reconnect. We enforce it with a CI guard that fails the build if a field screen writes to the database directly.

**Integrity is enforced in the database, not the UI.** Row‑level security on 147 tables, inspector identity and margins structurally hidden from buyer surfaces, and AI findings bound to a signed, hashed model version — each backed by a guard that runs on every change.

Building for the physical world forces a different kind of discipline. Happy to go deeper on any of these in the comments.

`[link]`

---

## 5. Founder's version (personal, first‑person)

> I've spent `[X months/years]` building something most people will never see running — and I've never been more sure of a decision.

NEXPEC is live today.

I didn't set out to build inspection software. I set out to fix something that annoyed me: safety‑critical work, done by serious professionals, coordinated like it was 2004. Email threads. Lost photos. Reports nobody could verify. Relationships that fell apart the moment two parties met directly.

Some honest lessons from the build:

→ The hard requirement — AI that works with no internet — turned out to be the moat. Everyone can call a cloud API. Almost nobody makes it run in a dead zone.

→ "Make the correction train the model" sounds simple and took the longest to get right. It's also the thing that will make this compound.

→ Shipping two synchronized clients + a real backend as a small team meant saying no to a hundred things so ten could be excellent.

To everyone who tested, argued with me, and told me the parts that were bad — thank you. That's the only reason it's good now.

If you want to see it, use it, or build on it, reach out. This is the start.

`[link]`

---

## 6. Short version (punchy — good for reposts / Twitter cross‑post)

> Industrial inspections keep the physical world from failing — and most are still booked over email and delivered as a PDF.

NEXPEC changes that: a marketplace for inspection work with an AI co‑inspector that detects defects **on the device, fully offline**, and makes every finding provable.

Mobile + web. Live today.

`[link]`

---

## 7. Suggested hashtags

Keep it to **3–5**, mixed reach. Don't wall‑of‑tag.

**Primary:** `#IndustrialAI` `#NDT` `#InspectionTech`
**Rotate in:** `#EdgeAI` `#OilAndGas` `#AssetIntegrity` `#ComputerVision` `#Startup` `#FieldService`

*(For the technical post, lean `#EdgeAI #ComputerVision #TypeScript`. For the founder post, lean `#BuildInPublic #Startup`.)*

---

## 8. Call‑to‑action menu

Pick **one** per post — a single ask converts better than a list.

- "If you work in inspection or asset integrity, I'd love 15 minutes of your honest feedback."
- "Investors and agencies: DM me and I'll send the full deck + a live demo."
- "Follow along — I'll be sharing how the offline AI actually works over the next few weeks."
- "Know an inspector who'd have opinions? Tag them. I want the critics."

---

## 9. Launch strategy (one week)

**Day 0 — Primary post.** Post #2 (Launch) from your personal profile. Spend the first 60 minutes replying to every comment — early engagement drives the algorithm. Have 5–10 colleagues/friends primed to comment (not just like) in the first hour.

**Day 1 — Founder post (#5).** Personal angle catches the people who scrolled past the announcement.

**Day 3 — Technical post (#4).** Different audience (builders/engineers); often your highest‑quality inbound.

**Day 5 — Storytelling (#3)** or a carousel of product shots. Re‑surfaces to anyone who missed launch.

**Ongoing:** repurpose the short version (#6) as a comment reply, a company‑page post, and cross‑platform. Turn the best comment threads into follow‑up posts.

**Amplification:** DM the 20–30 people you most want to see this *before* you post, not after ("launching NEXPEC Thursday — would mean a lot if you took a look"). Ask 3–5 to reshare with a line of their own.

---

## 10. Best posting time

For a B2B / industrial + investor audience (US/EU professional hours):

- **Best:** Tuesday–Thursday, **7:30–9:30am** in your audience's primary timezone (the pre‑work scroll).
- **Strong second:** **11:30am–12:30pm** (lunch).
- **Avoid:** Friday afternoon, weekends, and after 3pm for a launch.
- If your audience spans US + EU, post ~**8am US Eastern** — it catches EU midday and US morning together.

---

## 11. Image / carousel recommendations

Posts with a strong visual dramatically outperform text‑only. Options, best first:

1. **Hero shot / short video (best):** a phone in a gloved hand pointing at a real weld, with the violet AI polygon overlay tracing a defect. This one image tells the entire story — offline, on‑device, real work. A 6–10s screen recording of tapping/dragging a polygon is even better.
2. **Carousel (8–10 slides):** reuse the investor deck. Suggested order: hook → problem → the offline‑AI shot → how it works (4 steps) → roles → "provable findings" → what's live → CTA. Export slides from `NEXPEC_Investor_Presentation.html` (screenshot each slide) or rebuild in Figma at 1080×1350 (portrait converts best on mobile).
3. **Split screen:** phone (field app) beside the web dashboard — sells "one platform, everywhere."
4. **Single bold stat card:** "AI defect detection. Zero internet. $0 per scan." on your dark brand background (#020420 / #7C3AED).

**Specs:** portrait **1080×1350** for feed images/carousels; keep text large and high‑contrast; brand‑consistent dark background; never more than ~8 words per image.

---

*Want these tuned to your exact voice? Send me 2–3 things you've written before and I'll rewrite all five to sound unmistakably like you.*
