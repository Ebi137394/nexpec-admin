// ════════════════════════════════════════════════════════════════════════════
//  app/chat/buyer-supplier/[conversation_id].tsx
//  Buyer ↔ Supplier commercial conversation.
//
//  Re-exports the shared two-party chat screen. One screen serves all three
//  channels: it reads conversations.kind and consults the matching gate, so
//  there is exactly one messenger implementation to keep correct rather than
//  three that drift. Separate route files exist only so the deep-link paths
//  match the web app's (/chat/buyer-supplier/<id>) — a notification
//  link must open the same conversation on either platform.
// ════════════════════════════════════════════════════════════════════════════

export { default } from '../direct/[conversation_id]';
