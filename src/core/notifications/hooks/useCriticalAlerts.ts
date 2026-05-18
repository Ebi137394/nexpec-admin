// hooks/useCriticalAlerts.ts

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { AlertRow } from "@/lib/assetIntelligence.types";

export interface CriticalAlertDisplay {
  id: string;
  title: string;
  message: string;
  severity: string;
  status: string;
  assetTag: string;
  createdAt: string;
  displayDate: string;
}

export function useCriticalAlerts() {
  const [alerts, setAlerts] = useState<CriticalAlertDisplay[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("alerts")
        .select(`
          *,
          assets!inner ( tag_number )
        `)
        .in("status", ["new", "acknowledged"])
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        console.error("Error fetching alerts:", error);
        return;
      }

      if (data) {
        setAlerts(
          data.map((row: any) => ({
            id: row.id,
            title: row.title,
            message: row.message ?? "",
            severity: row.severity,
            status: row.status,
            assetTag: row.assets?.tag_number ?? "—",
            createdAt: row.created_at,
            displayDate: new Date(row.created_at).toLocaleString(),
          }))
        );
      }
    } catch (error) {
      console.error("Unexpected error in fetchAlerts:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Real-time subscription
  useEffect(() => {
    fetchAlerts();

    const channel = supabase
      .channel("critical-alerts-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "alerts" },
        (payload) => {
          // Optimistically prepend new alert
          const row = payload.new as AlertRow;
          setAlerts((prev) => [
            {
              id: row.id,
              title: row.title,
              message: row.message ?? "",
              severity: row.severity,
              status: row.status,
              assetTag: "—", // will be resolved on next full fetch
              createdAt: row.created_at,
              displayDate: new Date(row.created_at).toLocaleString(),
            },
            ...prev,
          ]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAlerts]);

  const acknowledgeAlert = useCallback(async (alertId: string, userId: string) => {
    try {
      const { error } = await (supabase.from("alerts") as any).update({
        status: "acknowledged",
        acknowledged_by: userId,
        acknowledged_at: new Date().toISOString(),
      }).eq("id", alertId);

      if (error) {
        console.error("Error acknowledging alert:", error);
        throw error;
      }

      setAlerts((prev) =>
        prev.map((a) =>
          a.id === alertId ? { ...a, status: "acknowledged" } : a
        )
      );
    } catch (error) {
      console.error("Unexpected error in acknowledgeAlert:", error);
      throw error;
    }
  }, []);

  const resolveAlert = useCallback(async (alertId: string) => {
    try {
      const { error } = await (supabase.from("alerts") as any).update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
      }).eq("id", alertId);

      if (error) {
        console.error("Error resolving alert:", error);
        throw error;
      }

      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (error) {
      console.error("Unexpected error in resolveAlert:", error);
      throw error;
    }
  }, []);

  return { alerts, loading, fetchAlerts, acknowledgeAlert, resolveAlert };
}
