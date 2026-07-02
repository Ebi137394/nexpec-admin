---
name: feedback_support_chat_copy_and_composer
description: "Don't reintroduce \"admin is the intermediary / X can't see this room\" support-chat copy; chat now has a rich attachment+voice composer everywhere"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 037bb54c-3737-4da7-bef6-ca32e278f20d
---

ebi had me strip the **"Inspectors/clients/buyers cannot see this room — admin is the intermediary"** microcopy from EVERY support surface: client dashboard quick-send card, client/inspector/supplier `messages` pages, and the thread subtitles (`Direct chat with admin · … cannot see this room` → just `Direct chat with admin`).

**Why:** he doesn't want the brokerage framed as keeping parties in the dark — it reads badly. **How to apply:** never re-add admin-as-intermediary / room-secrecy copy to chat UIs.

**UPDATE 2026-06-05 — price-blindness COPY is now also banned from buyer UI** (supersedes my earlier "price-blindness copy stays" note). ebi: delete every user-visible hint of the internal price-blindness/spread logic from the Client/Agency/Enterprise portal (they share web `/client/**`) — "zero hints visible to ANY user", and DELETE the text, don't reword. The price-blindness *logic* still stays enforced in code/RLS/views ([[project_golden_rules]]); we just never NARRATE it in the UI. Removed (2026-06-05): `client/jobs/new/page.tsx` ("Admin sets the inspector payout… you never see that figure, the inspector never sees your budget"), `client/contracts/job/[id]/page.tsx` ("The inspector's compensation is set separately by NEXPEC and is not visible to you"), `client/jobs/[id]/release/page.tsx` SummaryTile sub ("What you pay — distinct from the inspector's payout"). Left in place (payment-flow, not blindness — flag to ebi if he wants them gone too): release-page mentions of "Admin will process the inspector payout", escrow "payout stays held", "you never see card forms/Stripe sheets". Admin-only copy (JobModerationDrawer "clients never see this value; inspectors never see the budget") + supplier-facing "buyers never see competing quotes" were out of scope for this request. **How to apply:** keep buyer surfaces free of any "X can't/never sees Y's price / distinct prices / set separately / not visible to you" wording.

Same request added a rich composer to the chat "for all accounts" (voice, images, documents, attach anything). Backend already supported it (single attachment/message: `messages.attachment_url/type/name` → `chat_attachments` bucket, signed on read; + `VoiceRecorder` MediaRecorder flow) — it was just gated off (`textOnly`) on the dashboard.
- **Web:** new `apps/web/src/components/messaging/RichComposer.tsx` (text + single attachment w/ live preview + drag-drop + paste-image + integrated VoiceRecorder + Enter-to-send). Wired into client dashboard card + all 4 role thread pages (`{client,inspector,suppliers,admin}/messages/[id]`). `SimpleMessageComposer` kept as the bulletproof no-JS fallback. `MessageThread` now signs realtime attachment URLs so recipients see them live.
- **Mobile:** `src/hooks/useConversations.ts` gained `sendAttachment(file, content?)` (base64→bytes upload to chat_attachments, mirrors src/core/offline/operations.ts) + `signPath`/`hydrateMsgs` for display; `app/inbox/[id].tsx` got an image/document picker (expo-image-picker/expo-document-picker) + on-device voice recording (expo-av) + attachment bubbles (image/audio player/file chip). One unified inbox screen serves all roles.
- **Design choice:** single attachment per message (chat-natural, zero schema change). Multi-attachment would need a `message_attachments` child table — offered as a fast-follow if ever wanted. Verified: web tsc 0 + `next lint` clean; mobile scoped tsc clean (only pre-existing supabase.ts storage errors).
