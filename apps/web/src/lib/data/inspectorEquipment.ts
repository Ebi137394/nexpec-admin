// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorEquipment.ts — owned equipment + calibration tracking
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { InspectorEquipment } from './inspectorEquipment.types';

export type { InspectorEquipment };

const SIGNED_URL_TTL_SECONDS = 60 * 10;

export async function fetchInspectorEquipment(): Promise<InspectorEquipment[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('inspector_equipment')
      .select(
        'id, name, manufacturer, model_number, serial_number, last_calibration_at, next_calibration_due, calibration_certificate_path, notes, created_at, updated_at',
      )
      .eq('inspector_id', user.id)
      .order('next_calibration_due', { ascending: true, nullsFirst: false });

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchInspectorEquipment] failed:', error.message);
      }
      return [];
    }

    const rows = data as unknown as Array<Record<string, unknown>>;
    const items: InspectorEquipment[] = [];
    for (const r of rows) {
      const path = (r.calibration_certificate_path as string | null) ?? null;
      let signedUrl: string | null = null;
      if (path) {
        const { data: signed } = await supabase.storage
          .from('inspector_credentials')
          .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        signedUrl = signed?.signedUrl ?? null;
      }

      items.push({
        id: String(r.id),
        name: String(r.name ?? ''),
        manufacturer: (r.manufacturer as string | null) ?? null,
        modelNumber: (r.model_number as string | null) ?? null,
        serialNumber: (r.serial_number as string | null) ?? null,
        lastCalibrationAt: (r.last_calibration_at as string | null) ?? null,
        nextCalibrationDue: (r.next_calibration_due as string | null) ?? null,
        calibrationCertificateUrl: signedUrl,
        calibrationCertificatePath: path,
        notes: (r.notes as string | null) ?? null,
        createdAt: String(r.created_at ?? ''),
        updatedAt: String(r.updated_at ?? ''),
      });
    }
    return items;
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchInspectorEquipment] threw:', e);
    }
    return [];
  }
}
