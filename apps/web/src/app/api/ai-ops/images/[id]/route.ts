// ════════════════════════════════════════════════════════════════════════════
//  GET /api/ai-ops/images/[id] — one dataset sample for the review screen:
//  metadata + a signed image URL + the ORIGINAL AI prediction and the CORRECTED
//  annotations (kept separate — provenance is never overwritten) + quality +
//  lifecycle + audit timeline. Admin-only, sanitized errors.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { assertAdmin, classifyAiOpsError, getStorageProvider, AuditService } from '@/lib/services/aiops';

export const dynamic = 'force-dynamic';

// Tolerant mapper: normalize whatever geometry shape is stored into the shape
// SegEditorOverlay expects. Never throws on a malformed row.
function toDet(a: Record<string, unknown>): { classId: number; score: number; box: [number, number, number, number]; polygon: Array<[number, number]>; label?: string } | null {
  if (!a || typeof a !== 'object') return null;
  const classId = Number(a.classId ?? a.class_id ?? 0);
  const score = Number(a.score ?? a.confidence ?? 1);
  const box = (a.box ?? a.bbox) as number[] | undefined;
  const polygon = (a.polygon ?? a.poly) as Array<[number, number]> | undefined;
  const b: [number, number, number, number] = Array.isArray(box) && box.length === 4
    ? [Number(box[0]) || 0, Number(box[1]) || 0, Number(box[2]) || 0, Number(box[3]) || 0] : [0, 0, 0, 0];
  const p: Array<[number, number]> = Array.isArray(polygon) && polygon.length >= 3
    ? polygon.map((pt) => [Number(pt[0]), Number(pt[1])] as [number, number])
    : [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
  return { classId, score, box: b, polygon: p, label: typeof a.label === 'string' ? a.label : undefined };
}
const mapDets = (arr: unknown): Array<ReturnType<typeof toDet>> =>
  (Array.isArray(arr) ? arr.map((x) => toDet(x as Record<string, unknown>)).filter(Boolean) : []);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const sb = await createSupabaseServerClient();
    await assertAdmin(sb);

    const { data: image, error } = await sb.from('ai_dataset_images').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!image) return NextResponse.json({ error: 'Sample not found.', code: 'not_found' }, { status: 404 });

    // signed URL (best-effort — a missing object must not break the page)
    let imageUrl: string | null = null;
    try {
      const provider = await getStorageProvider(sb, (image.storage_provider as string) ?? undefined);
      imageUrl = (await provider.getDownloadUrl(image.storage_path as string, 900)).url;
    } catch { imageUrl = null; }

    // latest AI prediction (original) + corrections + audit timeline (all tolerant)
    const [{ data: pred }, history] = await Promise.all([
      sb.from('ai_prediction_history').select('detections, model_version, mean_conf, inference_ms, created_at')
        .eq('image_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle().then((r) => r, () => ({ data: null })),
      AuditService.forEntity(sb, 'ai_dataset_images', id, { pageSize: 50 }).catch(() => ({ rows: [], total: 0, page: 1, pageSize: 50 })),
    ]);

    return NextResponse.json({
      image,
      imageUrl,
      ai: mapDets((pred as { detections?: unknown } | null)?.detections),        // ORIGINAL prediction
      corrected: mapDets((image as { labels?: unknown }).labels),                 // reviewer-corrected
      quality: {
        quality_score: image.quality_score, blur_score: image.blur_score, brightness: image.brightness,
        contrast: image.contrast, noise_score: image.noise_score, resolution_score: image.resolution_score,
      },
      lifecycle: image.lifecycle,
      history: (history as { rows?: unknown[] }).rows ?? [],
    });
  } catch (e) {
    const { status, code, message } = classifyAiOpsError(e);
    return NextResponse.json({ error: message, code }, { status });
  }
}
