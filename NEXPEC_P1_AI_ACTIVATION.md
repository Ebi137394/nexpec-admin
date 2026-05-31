# NEXPEC P1 — Bringing the AI Co-Inspector to life

Two halves: **P1.2 (done in-repo)** wires the Co-Inspector into the live capture
wizard; **P1.1 (you run)** publishes a signed model so the device has something to
load. Until P1.1 runs, the wizard is byte-for-byte unchanged (the AI section is
gated off).

---

## P1.2 — Wiring (already committed)

`app/(inspector)/compliance/job/[id]/capture.tsx` now, **after a photo capture
persists into the hash chain**, runs on-device analysis and shows
`DefectFindingsCard` inline. "Add as finding" calls `pi_record_ai_detection`
tying the detection to the **job + that exact `capture_id` + the signed model
(slug/version)** — so every accepted finding folds into the inspection seal
(algorithm v3 `ai_root`).

- It is **first-class** — in the real compliance wizard, not a demo screen.
- It is **runtime-flag-gated** (`ML_RUNTIME_ENABLED`), which is a *native-capability*
  guard (is the TFLite/Skia runtime in this binary?), **not** a demo gate. With the
  flag off, the wizard behaves exactly as before — zero breakage in Expo Go.
- It can never block or alter the trust-capture: analysis is fire-and-forget,
  triggered only **after** the capture row + chain write succeed.

---

## P1.1 — Publish a signed model (run on your machine / GPU box · $0)

### Step 1 — Ed25519 signing keypair (skip if you already generated one)

```bash
# PRIVATE key — never leaves your machine; used to sign the attestation
openssl genpkey -algorithm ed25519 -out nexpec_model_signing.pem
# PUBLIC key — embedded in the app so the device verifies the signature
openssl pkey -in nexpec_model_signing.pem -pubout -out nexpec_model_signing.pub.pem
```

### Step 2 — Tell the app the public key + enable the runtime

Add to the mobile `.env` (the device fails **closed** if a model's signature
doesn't verify against this key — that's the security guarantee):

```bash
EXPO_PUBLIC_ML_RUNTIME=1
# PEM with newlines escaped as \n. Generate the value with:
#   sed ':a;N;$!ba;s/\n/\\n/g' nexpec_model_signing.pub.pem
EXPO_PUBLIC_ML_SIGNING_PUBKEY_PEM="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
```

### Step 3 — Sign, upload, register, publish

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key> \
node scripts/ml/register-model.mjs \
  --file ./mobilenet_v2.tflite \
  --kind vision_defect --slug universal-detector --version 1 \
  --runtime tflite --tier student --device-min-tier low --os any \
  --license Apache-2.0 \
  --sign ./nexpec_model_signing.pem --alg ed25519 --key-id model-v1 \
  --params '{"input":"rgb_224","labels":["defect","clean"]}'
```

Expected: `✓ signed attestation (ed25519)` → `↑ uploading …` → `✓ registered` →
`✓ PUBLISHED vision_defect/universal-detector v1`. The `resolve()` `no_artifact`
error is now gone — the device can download, **verify the signature**, cache, and
infer.

### Step 4 — Dev build + prove the loop

```bash
npx expo run:ios            # (after the New-Arch prebuild fix; dev build, not Expo Go)
```

Open a compliance job → capture wizard → take a photo → the **AI Co-Inspector**
card appears → "Add as finding" → seal the report → open `/verify`: the finding is
folded into the seal root, and the re-derivation panel shows it.

---

## ⚠ Honest caveat — model quality vs. pipeline activation

`mobilenet_v2.tflite` is a **generic ImageNet classifier**, not a trained defect
detector. Registering it **activates and proves the entire on-device pipeline**
(resolve → signature-verify → preprocess → infer → `DefectFindingsCard` → accept →
seal) end-to-end. It will **not** produce accurate corrosion/crack/pitting labels —
its outputs map to ImageNet classes, not the NEXPEC defect taxonomy.

**Accurate detection is a separate deliverable:** distill/train a real
`vision_defect` student model on the defect taxonomy, then re-run Step 3 with
`--version 2` and the trained `.tflite`. The runtime auto-resolves the latest
published version — no app change needed. (Tracked as a follow-up.)

The `--params` `input`/`labels` above are a starting point; align them to the
trained model's actual input tensor (size/dtype) and label order when you publish v2.
