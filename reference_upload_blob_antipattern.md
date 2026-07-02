---
name: reference_upload_blob_antipattern
description: Mobile silent 0-byte upload bug — fetch(uri).blob() handed to supabase.storage.upload on native; canonical fix base64→decode; Wave 8 + remaining sites
metadata: 
  node_type: memory
  type: reference
  originSessionId: 9ffed19b-c819-43de-a776-96b134eb176d
---

**The bug:** On React Native/Expo, `const blob = await (await fetch(fileUri)).blob()` then `supabase.storage.from(b).upload(path, blob)` uploads a **0-byte file** for `file://` URIs (Expo Blob can't serialize the body into the upload request). No error is thrown — the row/record points at an empty object. This is the web↔mobile drift: on web `fetch().blob()` works, on native it silently loses the file.

**Canonical fix (already used across the codebase):** read the picked file as base64, decode to ArrayBuffer, upload that with an explicit `contentType`:
```ts
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
const bytes = decode(base64);
await supabase.storage.from(bucket).upload(path, bytes, { contentType: asset.mimeType || 'application/octet-stream', upsert: false });
```
Proven helpers: `src/core/utils/imageUpload.ts` (uploadImageToSupabase — preflight MIME/size + signed URL), `src/utils/storage.ts` (uploadInspectionPhoto), `src/components/DynamicForm/fields/DocumentField.tsx` (PDF/Office, SHA-256 seal).

**Wave 8 (2026-06-25) FIXED 2 named flows:** `app/(inspector)/profile/verification.tsx` (inspector-docs) + `app/(inspector)/jobs/[id]/submit-report.tsx` (job-documents; also added missing contentType). Both base64→decode now. tsc clean.

**Wave 9 (2026-06-25) COMPLETE — every remaining site fixed:** resources.tsx, contracts/index.tsx, messages/[id].tsx, support-chat.tsx, (admin)/support-chat/[user_id].tsx, (admin)/jobs/[id].tsx, post-compliance-job.tsx, (inspector)/compliance/cci-application.tsx, capture.ts, branding-settings.tsx (raw-blob→base64/decode + explicit contentType, replacing unreliable `blob.type`). Tier-B FileReader variants ALSO converted: src/core/chat/messages.ts (uploadChatAttachment) + app/(client)/vault/index.tsx (uriToArrayBuffer). `grep '.upload([^,]*, blob'` now returns ZERO across app/+src/. All touched files tsc-clean; outbox guard re-baselined GREEN (231 entries). Remaining upload concern is ORTHOGONAL: ~15 sites call getPublicUrl on PRIVATE buckets (only `avatars` is public) → use signedUrl from src/core/storage/signedUrls. See [[project_prelaunch_punchlist]].

The [[reference_outbox_routing_guardrail]] does NOT catch this — it checks outbox routing, not blob-vs-ArrayBuffer. base64→decode uploads are still grandfathered direct writes there.
