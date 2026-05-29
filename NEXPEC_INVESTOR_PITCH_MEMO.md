# NEXPEC — Investor Memo
### The Provable-Trust Layer for Industrial Asset Integrity

> **Founder:** ebi — [NDT inspector & oil-&-gas engineering consultant; fill in years + certs below] · **Raise:** [see "The Ask"] · **Status:** Confidential
>
> *Placeholders in [brackets] are facts only you can supply (founder specifics, traction, market figures, the ask). Everything else is grounded in what's live in the NEXPEC codebase today.*

---

## The one paragraph

Every industrial inspection on Earth — the weld on a pressure vessel, the wall-thickness reading on a pipeline, the structural sign-off on a bridge — is a claim about whether a physical asset is safe. Today that claim is **asserted, not proven**: it lives in a spreadsheet, an email, and a PDF, and when a regulator or an insurer or a court asks "did this inspection really happen, by a qualified person, with calibrated equipment, and has it been altered since?", nobody can answer with proof. **NEXPEC makes every inspection a cryptographically verifiable asset** — sealed at the moment of capture, anchored through a chain of custody, and verifiable by any third party in their own browser without ever trusting us. We are not a better inspection marketplace. We are the trust layer the entire $[TAM] industry has been missing.

---

## The problem

Industrial inspection is a multi-hundred-billion-dollar global function (Testing, Inspection & Certification) that still runs on **spreadsheet + email + PDF + manual audit prep.** The consequences:

- **Trust is unprovable.** A defect photo is a JPEG someone emailed. A sign-off is a name typed into a Word doc. There is no way to prove the photo wasn't swapped, the finding wasn't edited, or the inspector was actually certified that day.
- **Audits are archaeology.** When a regulator or a Fortune 500 compliance team prepares for an audit, they reassemble months of fragmented records by hand. It costs weeks and it's still not defensible.
- **The cost of being wrong is catastrophic.** When an uninspected or falsely-inspected asset fails, people die and companies face existential liability. The entire industry is built on a trust primitive that doesn't actually exist.

[Founder pull-quote — the lived moment: e.g., "I have stood on a scaffold at 2am signing off on a weld, knowing the paper trail behind it could never survive a real audit. — ebi"]

---

## The insight

The industry treats inspection as **a service to coordinate.** That's why the incumbents are marketplaces, procurement tools, and audit software. The real nature of inspection is **evidence to prove.** Once you build for *provable evidence* instead of *coordinated service*, the entire architecture changes — and it cannot be bolted on afterward. You have to build the unified, cryptographically-anchored data model first, and let every other feature compose on top of it. **That is exactly what NEXPEC did.**

---

## The product — the Trust Stack (live in production)

Five interlocking systems form a regulator-grade perimeter around every inspection:

1. **Provable Inspection Engine (PIE)** — every photo is SHA-256 hashed and chained at capture; a report-level Merkle-style seal binds every photo, finding, and the inspector's identity under one anchor hash. The inspector signs; the client countersigns the same root. Tamper with anything and the seal breaks — visibly.
2. **Compliance Evidence Locker (CEL)** — one call assembles a deterministic, byte-identical evidence pack of a job's entire lifecycle (parties, contracts, approvals, invoices, audit events, inspection seals).
3. **The Public Verifier (`/verify`)** — *the magic.* A no-login page where a third-party auditor drag-drops the evidence pack and recomputes every hash **in their own browser**. Nothing leaves their machine; our servers are never involved. **The algorithm is the proof — not our reputation.**
4. **Procurement Control Plane (PCP)** — SOX-404-grade controls enforced in the database, not the app: approval bands, department budgets, and Segregation of Duties enforced by a Postgres constraint trigger that *mathematically cannot* record a self-approval.
5. **Compliance Command Center** — real-time anomaly detection over the immutable audit trail (band evasion, rubber-stamping, concentration risk, quarter-end clustering, off-hours decisions, silent overrides).

Underneath sits a complete two-sided platform: geospatial inspector marketplace, full job lifecycle, Stripe escrow + Connect payouts, multi-currency with live FX, contracts + e-signatures, disputes + reviews, multi-tenant org/department hierarchy, transactional email, and a hardened spine (RPC-only mutations, immutable `audit_events`, 25 production edge functions, 118 migrations) — shipped across **five inspection domains** (industrial NDT, civil/construction, electrical, mechanical field, chemical/process) on **one shared web + mobile codebase**.

---

## The moats

1. **Cryptographic verifiability without trust.** Competitors can build approval flows. They cannot build regulator-grade evidence packs that don't require trusting the vendor — that demands a from-day-one engineering posture (deterministic canonical JSON, per-artifact hashing, root composition, immutable audit, a public verifier that doesn't call home). We have it; they'd have to rebuild their core to copy it.
2. **The Data Flywheel.** Every sealed, human-verified inspection is a proprietary, provenance-stamped labeled datapoint. Our dataset compounds with every job and cannot be replicated by a competitor who doesn't already run the marketplace. This is the durable moat: any single AI model is just a renewable output of it.
3. **$0-recurring-cost intelligence.** Our AI runs on-device, in Postgres, and on our own GPU metal — **zero per-inference third-party API cost.** That means software-grade gross margins on a deep-tech capability *and* a data-sovereignty guarantee ("your asset data never touches a third-party AI") that enterprise buyers cannot get anywhere else.

---

## The AI strategy (why the economics work)

We fine-tune permissively-licensed open base models on our exclusive sealed-inspection data, entirely on an in-house GPU workstation — capex, not a metered API bill. Architecture: a **Teacher/Student split** — the full crown-jewel model never leaves our infrastructure (protected as a trade secret) and powers an **Intelligence-as-a-Service** revenue line; small distilled "student" models run on inspectors' phones for the assistive, human-sealed "AI Co-Inspector." We **sell access, not the artifact.** The result is a defensible, high-margin intelligence layer that gets better for free as inspection volume grows — while competitors pay per API call and ship their customers' data to third parties.

---

## Founder–market fit

NEXPEC is not built by a generalist who discovered a vertical. It's built by an insider who lived the pain. [ebi — fill in: years in the field; NDT certifications and levels (e.g., ASNT NDT Level II/III, PCN/CSWIP, AWS CWI); API inspector credentials (510/570/653); sectors and assets worked (upstream/downstream oil & gas, refineries, pipelines, pressure vessels, tanks); regions and operators; team.] [One signature war story that proves you've lived the exact failure mode NEXPEC fixes.]

This is why NEXPEC's architecture is the way it is. **Only someone who has done the inspection knows why chain-of-custody, calibration-validity, and schema-enforced controls are the things that actually win the enterprise** — and why every incumbent that treats an inspection photo as an opaque file URL has already lost. Founder-market fit isn't a slide here; it's the reason the product is built correctly.

---

## Market

[TAM] global Testing, Inspection & Certification market; [SAM] for software-addressable industrial inspection; [SOM] near-term wedge. *(Fill with sourced figures; do not ship invented numbers to investors.)*

**Wedge → expansion:** land in **oil & gas inspection** (highest pain, highest stakes, the founder's home turf), then expand across the five inspection domains already built in the product, then into adjacent asset-integrity markets (energy, utilities, infrastructure, manufacturing). The platform breadth that already exists is the expansion path — not a future roadmap promise.

---

## Business model

Multiple expanding, high-margin revenue lines on one platform:

- **Marketplace take rate** on every inspection transaction (escrow + payouts already live).
- **Enterprise compliance SaaS** — per-seat / per-site subscription for the PCP + Command Center + Evidence Locker (the Fortune-500 compliance buyer).
- **Intelligence-as-a-Service** — metered access to the Teacher model (others pay us; weights never leave).
- **Data / insights product** — anonymized, benchmarked industry intelligence enabled uniquely by the provenance-sealed dataset.

Because the intelligence layer carries **$0 recurring API cost**, incremental gross margin is exceptional. [Insert pricing assumptions / unit economics once set.]

---

## Competition

NEXPEC sits at the intersection of three categories historically served by separate vendors — and is the only one that unifies them with cryptographic chain-of-custody:

- **Field-service marketplaces** (ServiceTitan, Jobber) — operationally rich, compliance-thin.
- **Procurement platforms** (Coupa, Ariba, Ivalua) — financially rigorous, marketplace-thin.
- **GRC / audit tooling** (AuditBoard, Workiva, Hyperproof) — compliance-rich, transactionally inert.

None ship *provable evidence from the field photo to the regulator's verifier*, because that requires a unified data model built for it from the start. NEXPEC built that model first.

---

## Traction

[Fill with real numbers: inspectors onboarded, jobs sealed, GMV, enterprise pilots / LOIs, design partners.] What is **not** a placeholder: the entire Trust Stack — PIE, CEL, the public `/verify` endpoint, the Command Center, escrow payments, multi-currency FX, web + mobile parity — is **live in production today**, verifiable against the migration history. The hard part is already built.

---

## The ask

We are raising **$[amount]** to [top 3 uses: e.g., enterprise GTM + design-partner conversion, productionize the AI Co-Inspector on the in-house GPU, SOC 2 + security/compliance certifications].

*Stage framing (pick when ready):* **Pre-seed/angel** — lean on founder-market fit + a live, provably-built platform. **Seed** — fund the enterprise GTM motion against the live Trust Stack. **Series A** — scale a proven wedge with early enterprise ARR. The narrative and the product support all three; the figure and milestones adjust to the round.

---

## The vision

NEXPEC becomes the **system of record for physical-asset trust** — the layer that regulators, insurers, and enterprises rely on to know an asset is safe and to *prove* it. Every sealed inspection compounds the dataset, every regulator who verifies a pack without an account reinforces the standard, and every enterprise that adopts the compliance perimeter raises the switching cost. We are building the Stripe of inspection trust: the invisible, default infrastructure layer an entire industry runs on.
