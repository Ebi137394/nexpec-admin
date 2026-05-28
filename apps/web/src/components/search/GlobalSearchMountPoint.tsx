// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/components/search/GlobalSearchMountPoint.tsx
//
//  Thin client wrapper so the root server layout can include the search
//  overlay without itself becoming a client component.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { GlobalSearch } from './GlobalSearch';

export function GlobalSearchMountPoint() {
  return <GlobalSearch />;
}
