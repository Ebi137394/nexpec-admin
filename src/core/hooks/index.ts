// ════════════════════════════════════════════════════════════════════════════
//  src/core/hooks/index.ts — LANE-A-PHASE-3 barrel rebuild
//
//  Original (hooks/index.ts) was a flat barrel re-exporting every hook from
//  its sibling at the same level. After Phase 3 the hooks now live in
//  domain-classified homes — chat in core/chat/hooks/, role hooks under
//  roles/<role>/hooks/, and only useJobs/useAssistant kept in core/hooks/.
//
//  This barrel preserves the public surface — `import { useChat } from
//  '@/hooks'` continues to work because hooks/index.ts (the original
//  location) re-exports from here, and here we re-export from each
//  hook's actual new home.
// ════════════════════════════════════════════════════════════════════════════

// Core (universal) hooks
export * from '@/src/core/hooks/useAssistant';
export * from '@/src/core/hooks/useJobs';

// Chat (universal infrastructure) hooks
export * from '@/src/core/chat/hooks/useChat';
export * from '@/src/core/chat/hooks/useChatRooms';
export * from '@/src/core/chat/hooks/useRealtimeChat';

// Notifications (universal) hooks
export * from '@/src/core/notifications/hooks/useCriticalAlerts';
export * from '@/src/core/notifications/hooks/usePushNotifications';

// Role-specific hooks — surfaced through the universal barrel for
// backward compatibility with legacy `@/hooks/<name>` imports.
export * from '@/src/roles/admin/hooks/useAdminSupport';
export * from '@/src/roles/client/hooks/useDashboard';
export * from '@/src/roles/inspector/hooks/useEarnings';
export * from '@/src/roles/inspector/hooks/useInspectorData';
export * from '@/src/roles/inspector/hooks/useWallet';
