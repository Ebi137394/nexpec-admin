// app/agreements/[id]/sign.tsx — RETIRED. The brokered Review & Sign now lives under
//   the unified Contracts hub at /contracts/agreement/[id]. This route redirects so any
//   stale link or push deep-link lands on the unified surface (never a dead route).
import { useEffect } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

export default function AgreementSignRedirect() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  useEffect(() => {
    router.replace(`/contracts/agreement/${id}` as any);
  }, [id, router]);
  return <View style={{ flex: 1 }} />;
}
