// lib/queryAssetIntelligence.ts

import { supabase } from "@/src/core/supabase/supabase";
import {
  AssetWithHistory,
  AssetIntelligenceResult,
  TimelineItem,
  TimelineItemStatus,
  TimelineAttachment,
  QueryResult,
  InspectionEventWithDocs,
  AssetRow,
  InspectionEventRow,
  DocumentRow,
} from "@/src/core/types/assetIntelligence.types";

// ────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────

/**
 * Map a DB result → status the Timeline UI understands.
 */
function deriveTimelineStatus(
  type: string,
  result: string | null
): TimelineItemStatus {
  if (type === "incident") return "incident";
  if (result === "fail") return "fail";
  if (result === "pass") return "pass";
  if (result === "pending") return "pending";
  return "info";
}

/**
 * Build a human-readable title from event type + result.
 */
function buildTitle(type: string, result: string | null): string {
  const typeLabel: Record<string, string> = {
    inspection: "Inspection",
    maintenance: "Maintenance",
    incident: "Incident Report",
    calibration: "Calibration",
    audit: "Audit",
  };
  const base = typeLabel[type] ?? type;
  if (result === "fail") return `${base} — FAILED`;
  if (result === "pass") return `${base} — Passed`;
  if (result === "pending") return `${base} — Pending`;
  return base;
}

/**
 * Format an ISO date string into something readable.
 */
function formatDisplayDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Convert a raw inspection event + nested docs into a TimelineItem.
 */
function mapEventToTimelineItem(event: InspectionEventWithDocs): TimelineItem {
  const status = deriveTimelineStatus(event.type, event.result);

  const attachments: TimelineAttachment[] = (event.documents ?? []).map(
    (doc) => ({
      id: doc.id,
      title: doc.title,
      fileUrl: doc.file_url,
      fileType: doc.file_type ?? "unknown",
      fileSizeKb: doc.file_size_kb,
    })
  );

  return {
    id: event.id,
    date: event.performed_at,
    displayDate: formatDisplayDate(event.performed_at),
    type: event.type,
    status,
    title: buildTitle(event.type, event.result),
    summary: event.summary ?? "",
    performedBy: event.performed_by ?? "Unknown",
    severity: event.severity,
    attachments,
    metadata: event.metadata,
  };
}

/**
 * Map a full asset row (with nested events → docs) into the
 * AssetIntelligenceResult the UI consumes.
 */
function mapAssetToIntelligenceResult(
  asset: AssetWithHistory
): AssetIntelligenceResult {
  // Sort events newest → oldest
  const sortedEvents = [...asset.inspection_events].sort(
    (a, b) =>
      new Date(b.performed_at).getTime() - new Date(a.performed_at).getTime()
  );

  const timeline: TimelineItem[] = sortedEvents.map(mapEventToTimelineItem);

  const criticalCount = sortedEvents.filter(
    (e) => e.result === "fail" || e.type === "incident"
  ).length;

  const lastInspection =
    sortedEvents.find((e) => e.type === "inspection")?.performed_at ?? null;

  return {
    asset: {
      id: asset.id,
      tagNumber: asset.tag_number,
      description: asset.description ?? "",
      location: asset.location ?? "",
      category: asset.category ?? "",
      installDate: asset.install_date,
    },
    timeline,
    totalEvents: sortedEvents.length,
    criticalCount,
    lastInspection,
  };
}

// ────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ────────────────────────────────────────────────────────────────

/**
 * queryAssetIntelligence
 *
 * Searches the Asset Vault for equipment matching `tagNumber`,
 * joins inspection_events and documents, and returns everything
 * mapped into the Timeline UI format.
 *
 * @param tagNumber  Full or partial tag (e.g. "V-1001" or "V-10")
 * @param options    Optional filters
 */
export async function queryAssetIntelligence(
  tagNumber: string,
  options: {
    limit?: number;
    eventTypes?: string[];
    dateFrom?: string;
    dateTo?: string;
  } = {}
): Promise<QueryResult> {
  const { limit = 50, eventTypes, dateFrom, dateTo } = options;

  try {
    // ── Validate ──────────────────────────────────────────────
    const sanitised = tagNumber.trim();
    if (!sanitised) {
      return { success: false, data: [], error: "Tag number is required.", count: 0 };
    }

    // ── Step 1: Find matching assets ──────────────────────────
    const { data: assets, error: assetError } = await supabase
      .from("assets")
      .select("*")
      .ilike("tag_number", `%${sanitised}%`)
      .limit(limit);

    if (assetError) throw assetError;
    if (!assets || assets.length === 0) {
      return { success: true, data: [], error: null, count: 0 };
    }

    const assetIds = assets.map((a) => a.id);

    // ── Step 2: Fetch inspection events for those assets ──────
    let eventsQuery = supabase
      .from("inspection_events")
      .select("*")
      .in("asset_id", assetIds)
      .order("performed_at", { ascending: false });

    if (eventTypes && eventTypes.length > 0) {
      eventsQuery = eventsQuery.in("type", eventTypes);
    }
    if (dateFrom) {
      eventsQuery = eventsQuery.gte("performed_at", dateFrom);
    }
    if (dateTo) {
      eventsQuery = eventsQuery.lte("performed_at", dateTo);
    }

    const { data: events, error: eventsError } = await eventsQuery;
    if (eventsError) throw eventsError;

    // ── Step 3: Fetch documents for those assets ──────────────
    const { data: documents, error: docsError } = await supabase
      .from("documents")
      .select("*")
      .in("asset_id", assetIds);

    if (docsError) throw docsError;

    // ── Step 4: Stitch everything together in memory ──────────
    //    Group events by asset_id, attach docs to each event.
    const eventsByAsset = new Map<string, InspectionEventWithDocs[]>();
    const docsByEvent = new Map<string, DocumentRow[]>();

    // Index documents by event_id
    for (const doc of (documents as DocumentRow[]) ?? []) {
      if (doc.event_id) {
        if (!docsByEvent.has(doc.event_id)) docsByEvent.set(doc.event_id, []);
        docsByEvent.get(doc.event_id)!.push(doc);
      }
    }

    // Attach docs to events, group events by asset
    for (const event of (events as InspectionEventRow[]) ?? []) {
      const enriched: InspectionEventWithDocs = {
        ...event,
        documents: docsByEvent.get(event.id) ?? [],
      };
      if (!eventsByAsset.has(event.asset_id)) eventsByAsset.set(event.asset_id, []);
      eventsByAsset.get(event.asset_id)!.push(enriched);
    }

    // Also attach orphan docs (no event_id) as a synthetic "document upload" event
    const orphanDocsByAsset = new Map<string, DocumentRow[]>();
    for (const doc of (documents as DocumentRow[]) ?? []) {
      if (!doc.event_id) {
        if (!orphanDocsByAsset.has(doc.asset_id))
          orphanDocsByAsset.set(doc.asset_id, []);
        orphanDocsByAsset.get(doc.asset_id)!.push(doc);
      }
    }

    // Build final AssetWithHistory objects
    const results: AssetIntelligenceResult[] = (assets as AssetRow[]).map((asset) => {
      const eventsForAsset = eventsByAsset.get(asset.id) ?? [];

      // Convert orphan docs into synthetic timeline events
      const orphans = orphanDocsByAsset.get(asset.id) ?? [];
      for (const orphan of orphans) {
        eventsForAsset.push({
          id: `doc-${orphan.id}`,
          asset_id: asset.id,
          type: "audit",
          result: "n/a",
          severity: null,
          summary: `Document uploaded: ${orphan.title}`,
          performed_by: orphan.uploaded_by,
          performed_at: orphan.uploaded_at,
          metadata: {},
          created_at: orphan.uploaded_at,
          documents: [orphan],
        } as InspectionEventWithDocs);
      }

      const assetWithHistory: AssetWithHistory = {
        ...asset,
        inspection_events: eventsForAsset,
      };
      return mapAssetToIntelligenceResult(assetWithHistory);
    });

    return {
      success: true,
      data: results,
      error: null,
      count: results.length,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[queryAssetIntelligence]", message);
    return { success: false, data: [], error: message, count: 0 };
  }
}