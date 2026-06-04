// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/app/inspector/coordination-bridge/page.tsx
//
//  Web inspector Coordination Bridge workspace. Closes the gap where every
//  bridge notification linked to /inspector/coordination-bridge?bridge_id=… —
//  a route that 404'd on web (the workspace existed only on mobile).
//
//  Deep-link:
//    /inspector/coordination-bridge?bridge_id=<uuid>   open existing
//    /inspector/coordination-bridge?job_id=<uuid>      create / resume for a job
//
//  Server page: gate auth, hand off to the interactive client workspace which
//  drives the same SECURITY DEFINER bridge_* RPCs the mobile screen uses.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { InspectorBridgeWorkspace } from '@/components/coordination/InspectorBridgeWorkspace';

export const metadata: Metadata = { title: 'Coordination Bridge · NEXPEC' };

interface PageProps {
  searchParams?: Promise<{ bridge_id?: string; job_id?: string }>;
}

export default async function InspectorCoordinationBridgePage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/inspector/coordination-bridge');

  const bridgeId = typeof sp.bridge_id === 'string' ? sp.bridge_id : '';
  const jobId = typeof sp.job_id === 'string' ? sp.job_id : '';

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-white">Coordination Bridge</h1>
      <p className="mb-6 text-sm text-zinc-400">
        Coordinate the inspection date, site access and preliminary documents with the vendor — the
        client is notified automatically when the date locks.
      </p>
      <InspectorBridgeWorkspace bridgeId={bridgeId} jobId={jobId} />
    </main>
  );
}
