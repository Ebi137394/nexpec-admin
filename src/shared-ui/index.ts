// ════════════════════════════════════════════════════════════════════════════
//  src/shared-ui/index.ts — LANE-A-PHASE-3 barrel rebuild
//
//  Pre-strike: flat components/index.ts re-exporting every component from
//  a sibling at the same level. Post-strike: components are classified
//  across buttons/, cards/, modals/, feedback/, status/, headers/,
//  branding/ inside src/shared-ui/, with role-specific or core-specific
//  components routed to their proper homes.
//
//  This barrel preserves the public surface — `import { Button } from
//  '@/components'` continues to work through the components/index.ts
//  legacy stub, which forwards here, which forwards to the canonical
//  home for each component.
// ════════════════════════════════════════════════════════════════════════════

// Buttons
export * from '@/src/shared-ui/buttons/Button';
export * from '@/src/shared-ui/buttons/AcceptOfferButton';
export * from '@/src/shared-ui/buttons/ActionButtons';

// Cards
export * from '@/src/shared-ui/cards/GradientCard';
export * from '@/src/shared-ui/cards/ApplicantCardSimple';

// Modals
export * from '@/src/shared-ui/modals/AddFundsModal';
export * from '@/src/shared-ui/modals/ReviewModal';

// Feedback (shimmers, splash, loading overlays, success animations)
export * from '@/src/shared-ui/feedback/Shimmer';
export * from '@/src/shared-ui/feedback/LoadingOverlay';
export * from '@/src/shared-ui/feedback/SuccessAnimation';
export { default as SplashScreen } from '@/src/shared-ui/feedback/SplashScreen';

// Status indicators
export * from '@/src/shared-ui/status/UrgencyBadge';

// Branding / logos
export { default as NexpecLogo } from '@/src/shared-ui/branding/NexpecLogo';
export { default as HeaderLogo } from '@/src/shared-ui/headers/HeaderLogo';

// Chat components (universal infrastructure — under core/)
export * from '@/src/core/chat/components/MessageBubble';
export * from '@/src/core/chat/components/ChatInput';
export * from '@/src/core/chat/components/ChatFAB';

// Role-conditional rendering (auth-aware utility)
export * from '@/src/core/auth/RoleContent';

// Role-specific components surfaced through the shared barrel for
// backward compatibility with legacy `@/components/<name>` imports.
export * from '@/src/roles/inspector/components/EarningsChart';

// Debug components (development utilities)
export { default as SupabaseDebugger } from '@/src/core/utils/debug/SupabaseDebugger';
export { default as SupabaseConnectionTest } from '@/src/core/utils/debug/SupabaseConnectionTest';
export { default as StorageDebugger } from '@/src/core/utils/debug/StorageDebugger';
