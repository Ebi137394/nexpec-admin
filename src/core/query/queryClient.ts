// ─────────────────────────────────────────────────────────────────
//  src/core/query/queryClient.ts
//  The app-wide TanStack Query client + AsyncStorage persistence.
//
//  WHY THIS EXISTS: three screens use React Query (useLaunchedInspectionDomains,
//  inspector/seal-report, inspector/coordination-bridge) but no
//  QueryClientProvider was ever mounted — so `useQuery`/`useQueryClient` threw
//  "No QueryClient set, use QueryClientProvider to set one" and crashed the
//  render. This module provides the singleton client and the persister; the root
//  _layout mounts PersistQueryClientProvider with them.
//
//  Persistence is offline-first-friendly: successful query results survive an
//  app restart (cache rehydrates from AsyncStorage), which complements the
//  offline outbox for reads. $0, no extra service.
// ─────────────────────────────────────────────────────────────────

import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Reasonable defaults for a mobile marketplace: short stale window,
      // long GC so the persisted cache survives restarts, bounded retries,
      // and no window-focus refetch (no window concept in React Native).
      staleTime: 60_000,
      gcTime: ONE_DAY_MS, // must be >= persist maxAge so entries aren't GC'd before restore
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'NEXPEC_QUERY_CACHE_v1',
  throttleTime: 1000,
});

/** Pass to <PersistQueryClientProvider persistOptions={persistOptions}>. The
 *  `buster` lets us invalidate the whole persisted cache on a breaking change. */
export const persistOptions = {
  persister: asyncStoragePersister,
  maxAge: ONE_DAY_MS,
  buster: 'v1',
};
