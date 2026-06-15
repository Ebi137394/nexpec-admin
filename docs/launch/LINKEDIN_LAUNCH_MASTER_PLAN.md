# NEXPEC — LinkedIn Launch Master Plan & Feature Showcase

*Prepared as: Product Mastermind × Lead Dev × Growth Lead. Grounded in a microscopic scan of the actual codebase (mobile app + web portal + Supabase trust layer). Everything below maps to shipped features — no vapor.*

---

## 0. The one decision that shapes everything

You are **pre-traction** (the live job count is tiny — which is exactly why your landing page's social-proof block *conditionally hides itself* until there are 100+ real jobs). That is a gift, not a problem. It means:

- **Do NOT fake metrics.** No "10,000 inspections!" No invented logos. Your whole brand is *provable trust* — fabricating traction would be brand suicide and you've already engineered the product to refuse it (honest dashes, conditional CTA).
- **Launch a category and a standard, not a scoreboard.** Sell the *architecture*, the *guarantee*, and the *founding cohort*. The number you flex is **proof**, not popularity.

> **Strategic posture:** "We didn't build another marketplace. We built the trust layer the inspection industry never had — and you can verify it yourself, right now, without an account."

---

## 1. Positioning & the hook

### The category line (use everywhere)
**NEXPEC — the industrial black box. Cryptographically provable inspections, escrow-backed, audit-grade.**

### The core wedge (why anyone cares)
Industrial inspection runs on **trust nobody can verify**: a PDF, a stamp, a name. NEXPEC makes every report **mathematically provable** — sealed, signed, and anchored to the Bitcoin timestamp ledger — so a report can't be back-dated, edited, or faked, and *anyone* can verify it in seconds.

### The hero hook (the one you lead the launch with)
> **"What if you could *prove* an inspection happened — to the second — without trusting anyone?**
> No login. No PDF. Just math. Here's a 40-second demo of our public Verify page →"

This works because it's a **demo-able, falsifiable claim** — the single most scroll-stopping thing on LinkedIn (a feed full of unfalsifiable claims). The `/verify` page is your unfair advantage: a stranger can verify a sealed report with zero signup.

### Hook variants (A/B these across the campaign)
- **For inspectors:** *"Your stamp is your reputation. We made it cryptographic — and we pay through escrow, so you never chase an invoice again."*
- **For QA/clients:** *"Your inspector says it passed. Can you prove it in court? Now you can — every report is sealed and Bitcoin-anchored."*
- **For the industry/founders:** *"Inspection is a $30B+ trust business running on un-auditable PDFs. We rebuilt it as an industrial black box."*
- **The contrarian:** *"We built an inspection app that lets strangers audit us. On purpose. Here's why that's the whole point."*

---

## 2. Feature showcase — framed for the market (not a spec sheet)

Six "marketing pillars." Each bundles real, shipped features into a story a buyer feels.

### Pillar 1 — The Trust Stack ("Proof, not promises") 🛡️
*The headline act. Nobody else in this category has this.*
- **Cryptographic report seals** — every inspection report is hashed into a tamper-evident SHA-256 seal (captures + items + metadata composed into one root).
- **Bitcoin / OpenTimestamps anchoring** — seals are anchored to the Bitcoin ledger (two-phase: submit → confirm), so the report's existence-at-a-time is immutable and independently checkable.
- **Provable AI co-inspector** — when AI assists a finding, the *model version is cryptographically bound into the seal* (model→detection binding). No silent model drift, no "the AI said so" black box. Explainable + verifiable.
- **The public Verify page (`/verify`)** — anyone, no account, recomputes the chain-of-custody client-side. **This is your killer demo.**
- **The Trust Passport (`/passport/[sealId]`)** — a shareable, public, verifiable record of a sealed report.
- **The Audit Black Box** — schema-level capture of every state change (who/when/why, before/after), RLS-gated and exportable.
> Marketer's line: *"Every inspection comes with a receipt the universe can't forge."*

### Pillar 2 — Money that behaves ("Escrow-first, contract-before-cash") 💸
- **Stripe-backed escrow** — client funds are held the moment a job is dispatched; released only on a signed, approved report.
- **Contract-before-money, enforced in SQL** — money legs literally cannot fire before the agreement is executed (it's a database invariant, not a UI hope).
- **Instant inspector payouts** via Stripe Connect, with statements + CSV export.
- **Price-blindness by design** — inspectors see only their agreed payout; clients see only their budget; the platform spread is invisible to both. Anti-collusion baked in.
> Marketer's line: *"Inspectors never chase an invoice. Clients never pay for work they haven't approved."*

### Pillar 3 — The brokered, anti-poaching marketplace ("A referee, not a free-for-all") ⚖️
- **Admin-brokered deal spine** — NEXPEC is a party to every leg of every deal (a hub-and-spoke contract graph), so quality and payment are guaranteed, not hoped for.
- **Identity escrow / anti-poaching** — inspector identity stays a pseudonymous **NX-handle + TrustSigil** through bidding and active work; the real name is revealed only after the report is signed off. Kills off-platform bid-shopping.
- **Negotiation loop** — inspector bids → admin counter-offer → client selection → blinded shortlist matching (broker / auto-match / blinded shortlist routing).
> Marketer's line: *"A marketplace where nobody can cut you out of the deal."*

### Pillar 4 — Field-grade mobile ("Built for a refinery with no signal") 📱
- **Offline-first capture** — full inspection raise + evidence works with zero signal; an idempotent outbox drains conflict-free on reconnect (reports are even *sealed locally*).
- **Biometric login** (Face ID / fingerprint), **push notifications** with safe deep-linking.
- **Native capture suite** — camera evidence, document picker (Word/PDF templates), **on-canvas signature capture**, **voice-to-findings**, maps/geolocation, calendar sync.
- **On-device AI defect analysis** — vision model runs *on the phone* (no cloud round-trip), with a signed model.
- **Flash Reports / NCR** — raise a mid-job non-conformance from the field in seconds (now at 100% web↔mobile parity).
> Marketer's line: *"The job site doesn't have Wi-Fi. NEXPEC doesn't care."*

### Pillar 5 — The web command center ("Mission control for trust") 🖥️
- **Admin console** — job moderation, dispatch + spread editor, negotiation, disputes, payouts reconciliation, audit-trail command center, compliance vault, domain readiness, fee schedule.
- **Client portal** — post jobs, review applicants (price-blind), approve-&-pay (one-click escrow release), evidence vault, invoices, budget envelopes + approval gates, team/department structure.
- **Inspector portal** — jobs marketplace, assignments with SLA timers, report submission + sealing, wallet + statements, calendar with iCal feed, AI co-inspector, engineering Tool Foundry.
- **Resilient by construction** — retry-wrapped data reads, graceful error boundaries (no white-screen 500s).
> Marketer's line: *"Everything the field captures, the office can audit — in real time."*

### Pillar 6 — Enterprise procurement & breadth ("Not a toy — a platform") 🏭
- **RFQ → quote → admin markup → client offer** procurement flow (clients never see raw supplier price — admin intercept & markup, price-blind).
- **Supplier ecosystem** — anonymized supplier directory, onboarding, two-party brokered supplier contracts, supplier finance + payouts, turnkey RFQ→auto-spawned source-inspection jobs.
- **Coordination Bridge** — real-time multi-party workspace (inspector ↔ client ↔ admin ↔ vendor) with a secure vendor invite bridge.
- **Catalogue breadth** — **5 inspection domains** (Industrial NDT, Civil, Electrical, Mechanical, Chemical), **57 scope templates**, **389 structured evidence requirements**, **6 account roles** across **~50 web routes** and a full mobile app.
> Marketer's line: *"From a single weld scan to a multi-vendor procurement program — one trust layer."*

---

## 3. Ecosystem sync — how web & mobile complement each other

The thing to brag about: **one platform-agnostic spine, two purpose-built surfaces.**

- **Shared core (write once, trust everywhere):** the entire data/contract/RPC layer is platform-agnostic. Same Supabase auth (JWT), same RPCs, same RLS, same escrow + sealing logic. A contract signed on mobile is identical to one signed on web. *This is why parity is achievable and real — it's a UI sweep, not two codebases.*
- **Mobile = the field instrument:** offline capture, biometrics, camera/signature/voice, on-device AI, GPS — the stuff you can only do with a device in your hand at a remote site.
- **Web = mission control:** large admin consoles, moderation/dispatch/finance/compliance, marketing, public verification. The stuff that needs a big screen and a desk.
- **They hand off seamlessly:** inspector seals a report offline in the field (mobile) → it syncs → admin reviews and the client approves-&-pays (web) → escrow releases → the seal is Bitcoin-anchored → anyone verifies it on `/verify` (any device). 

> **LinkedIn framing:** *"The field and the office finally speak the same language — cryptographically."*
> Visual asset idea: a single horizontal graphic — **Field (phone) → Seal → Office (dashboard) → Bitcoin → Public Verify** — one continuous chain.

---

## 4. The campaign — audiences, phases, cadence

### 4.1 Two demand curves, two tracks
Run the launch as **two parallel recruitment campaigns** sharing one brand story:

| | **Track A — Inspectors (supply)** | **Track B — Clients / QA & reliability leaders (demand)** |
|---|---|---|
| Who | NDT techs, inspection engineers, freelance/independent inspectors, inspection agencies | QA/QC managers, reliability engineers, plant/facility managers, procurement, EPC firms (oil & gas, utilities, manufacturing, civil) |
| Pain | Chasing invoices; commoditized; reputation not portable/provable | Can't verify reports; audit/liability exposure; vendor trust; bid-shopping |
| Hook | "Get paid through escrow. Make your stamp cryptographic." | "Stop trusting PDFs. Verify every inspection." |
| Offer | **Founding Inspector cohort** (badge, priority matching, lifetime perk) | **Design-partner program** (white-glove onboarding, shape the roadmap) |
| CTA | Create your inspector profile / join the waitlist | Book a 15-min "verify it yourself" demo |

*(Marketplaces are chicken-and-egg: seed the **supply** side first/harder — inspectors are easier to recruit on LinkedIn and their presence makes the demand pitch credible.)*

### 4.2 Three phases

**Phase 0 — Pre-launch / "build in public" (2–3 weeks before).** Tease the standard, not the product.
- Founder POV posts: *why inspection trust is broken* (story, not pitch).
- "We're building an industrial black box" — show the architecture diagram, the seal, the verify concept.
- Open a **waitlist** + **Founding Inspector** signup. Goal: a warm list before day one.
- DM 20–50 hand-picked inspectors/QA leaders for design-partner conversations (this also seeds launch-day engagement).

**Phase 1 — Launch week (the spike).** One marquee post + a tight supporting sequence.
- **Day 1 (Mon):** The launch post + the **/verify demo video** (the hero asset).
- **Day 2 (Tue):** Inspector track — "Founding Inspector" recruitment carousel.
- **Day 3 (Wed):** Client/QA track — "Can you prove it in court?" + the escrow/approve-&-pay story.
- **Day 4 (Thu):** Deep-dive thought-leadership — "How we anchor an inspection to Bitcoin" (the technical flex; earns credibility + shares).
- **Day 5 (Fri):** Founder reflection + the ask (waitlist/design partners) + thank-you to early engagers.

**Phase 2 — Sustain (weeks after).** Turn features into a content engine (see §5). Ship-in-public: every real milestone (first 10 inspectors, first sealed report, first dispute resolved by evidence) becomes a post. **When the marketplace truly crosses 100 jobs, the landing page CTA flips on by itself — make that flip a post** ("the number is real now").

### 4.3 Cadence & mechanics
- **3–5 posts/week** during Phase 1–2, founder profile as primary voice (company page reshares).
- **Formats that win on LinkedIn:** native carousels (PDF), 30–60s screen-recording demos, single bold-stat/diagram images, and text-only founder stories. **Avoid** external links in the post body (LinkedIn throttles them — put the link in the first comment).
- **Engagement loop:** end every post with a question; reply to every comment in the first 2 hours; the founder DMs every meaningful commenter.
- **Hashtags (3–5):** #IndustrialInspection #NDT #QualityAssurance #ReliabilityEngineering #OilAndGas / #AssetIntegrity (rotate by post).

---

## 5. Content engine — feature → post (steal these)

Each pillar is a renewable content vein. Pattern: **Pain → Mechanism → Proof → CTA.**

- **The Verify demo** → "Audit our app yourself. No login." (screen recording of `/verify`). *Highest priority asset.*
- **Provable AI** → "We let AI help inspect — then we cryptographically prove which model made the call." (carousel: the model-binding concept).
- **Offline-first** → "Filmed at a remote site with zero bars. Watch a full inspection get captured and *sealed* offline." (field video).
- **Escrow** → "The 3 words that fix contractor payments: contract before money." (diagram).
- **Anti-poaching** → "Why our inspectors are anonymous until the job's done." (the NX-handle story).
- **Price-blindness** → "Nobody on our platform can see the spread. Here's the integrity argument." (contrarian POV).
- **Breadth** → "5 domains. 57 scope templates. 389 evidence requirements. One trust layer." (stat carousel).
- **Audit black box** → "Every click is on the record — even ours." (trust flex).
- **Founder origin** → why you built it (the human story that makes people root for you).

---

## 6. Three fully-written launch posts (ready to adapt)

### Post A — The launch (Day 1, founder voice)
> Industrial inspection is a multi-billion-dollar trust business running on… PDFs.
>
> A stamp. A signature. A name you have to take on faith. If a report is wrong — or quietly edited later — you usually find out in a courtroom or after a failure.
>
> So we built NEXPEC: the industrial black box.
>
> Every inspection on NEXPEC is cryptographically **sealed**, the AI that assists it is **cryptographically bound** to its findings, and the whole thing is **anchored to the Bitcoin timestamp ledger** — so it can't be back-dated, edited, or faked.
>
> The part I'm proudest of? You don't have to trust *us* either. Open our public Verify page and check a sealed report yourself — no account, no upload to our servers, just math.
>
> 🎥 40-second demo 👇 (link in comments)
>
> We're opening a **Founding Inspector** cohort and a small **design-partner** group for QA/reliability teams. If inspection trust is your problem, let's talk.
>
> What would *you* want to be able to prove about an inspection? 👇

### Post B — Inspector recruitment (Day 2, carousel)
> Slide 1: "Your stamp is your reputation. We made it cryptographic."
> Slide 2: Get paid through **escrow** — funds locked before you start, released when your report's approved. Stop chasing invoices.
> Slide 3: Work the **field, offline** — capture + seal an inspection with zero signal. It syncs when you're back.
> Slide 4: Your identity stays **private** until the job's signed off. No bid-shopping, no getting cut out.
> Slide 5: An **AI co-inspector** that runs on your phone — and proves which model made each call.
> Slide 6: **Founding Inspectors** get a permanent badge + priority matching. ~50 spots. (link in comments)

### Post C — Client / QA (Day 3)
> "It passed inspection." → Prove it.
>
> If you manage assets, you already know the gap: you get a report, and you *hope* it's accurate, complete, and unaltered. Your auditors, insurers, and lawyers don't run on hope.
>
> NEXPEC gives every inspection a tamper-evident, Bitcoin-anchored **seal** — and a public link anyone can verify. Funds sit in **escrow** until *you* approve the report. Pricing is blind, so there's no collusion on the spread.
>
> We're taking a handful of **design partners** (QA / reliability / integrity teams). White-glove onboarding, and you shape the roadmap. 15 minutes, and I'll let you verify a sealed report yourself. 👇

---

## 7. Hype mechanics (manufacture momentum honestly)
- **Scarcity that's real:** "Founding Inspector — first 50" (a badge you actually grant). Design-partner program capped at ~5–10 logos.
- **Countdown:** a 7-day pre-launch countdown on the founder profile.
- **Proof artifacts:** publish one *real* sealed report's Verify/Passport link as the recurring "try it yourself" proof.
- **Milestone-as-content:** first inspector, first sealed report, first escrow release, first dispute resolved by evidence, the 100-jobs CTA flip.
- **Borrowed credibility:** get 3–5 respected inspectors/QA voices to comment on launch day (line them up in Phase 0 DMs).
- **The technical flex:** one genuinely deep "how it works" post earns reshares from engineers and signals you're not a skin-deep app.

---

## 8. Guardrails (the "don't torch the brand" list)
- **Never fabricate numbers, logos, or testimonials.** Your differentiator is verifiable trust; one fake stat undoes it. (Your product already enforces this — keep the marketing to the same standard.)
- **Lead with the demo, not adjectives.** "Provable" must always be one click from being *proven*.
- **Don't over-claim Bitcoin anchoring timing** — say "anchored to the Bitcoin timestamp ledger (OpenTimestamps)"; it confirms over time, so don't imply instant finality.
- **Respect the anti-poaching/price-blindness story in public too** — never show real inspector identities or spreads in marketing screenshots.
- **One CTA per post.** Inspector posts → inspector signup. Client posts → demo booking. Don't split intent.

---

## 9. 7-day launch checklist
1. Record the `/verify` demo video (hero asset) + one offline-capture field clip.
2. Build the architecture diagram (Field → Seal → Office → Bitcoin → Public Verify).
3. Stand up the waitlist + Founding Inspector + design-partner forms.
4. Write Phase-1 posts A–E; design the 2 carousels.
5. Phase-0 DMs to 30–50 inspectors + 20 QA leaders; line up 5 launch-day commenters.
6. Schedule posts (Mon–Fri), link-in-first-comment, founder as primary voice.
7. Block 2 hrs/day launch week for live comment replies + DMs.

---

### TL;DR
Lead with **"prove it yourself"** (the Verify page is your scroll-stopper). Sell the **Trust Stack + escrow + brokered marketplace**, not a scoreboard. Recruit **inspectors first** (Founding cohort) and **clients as design partners**. Build-in-public, honest metrics, demo over adjectives. The product is genuinely category-defining — the job now is to make the industry *feel* the difference in 40 seconds.
