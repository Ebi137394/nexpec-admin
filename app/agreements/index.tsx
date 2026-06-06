// app/agreements/index.tsx — RETIRED. The brokered legs are now folded into each
//   role's unified Contracts hub. This route redirects there (role-aware) so any stale
//   link or in-app notification lands on the single Contracts surface — no duplicate tab.
import { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

export default function AgreementsRedirect() {
  const router = useRouter();
  useEffect(() => {
    let on = true;
    (async () => {
      let dest = '/contracts';
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
          if ((data?.role as string | undefined) === 'supplier') dest = '/suppliers/contracts';
        }
      } catch {
        /* fall back to the shared hub */
      }
      if (on) router.replace(dest as any);
    })();
    return () => { on = false; };
  }, [router]);
  return <View style={{ flex: 1 }} />;
}
