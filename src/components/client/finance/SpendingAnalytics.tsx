// ============================================================
// FILE: src/components/client/finance/SpendingAnalytics.tsx
// PURPOSE: Full Spending Analytics dashboard with Release Payment
// ============================================================

import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSpendingDashboard, useMilestones } from "../../../hooks/useSpendingAnalytics";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../../providers/AuthProvider";
import { LoadingState } from "../../ui/LoadingState";
import { ErrorState } from "../../ui/ErrorState";

// ──────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────
interface ReleasePaymentRequest {
  milestone_id: string;
  project_id: string;
  payment_method: "bank_transfer" | "stripe" | "manual";
  notes?: string;
}

interface ReleasePaymentResponse {
  success: boolean;
  payment_id?: string;
  milestone_id?: string;
  amount?: number;
  error?: string;
  message?: string;
}

interface SpendingAnalyticsProps {
  projectId: string;
}

// ──────────────────────────────────────────────
// UTILITY FUNCTIONS
// ──────────────────────────────────────────────
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const getStatusVariant = (status: string): string => {
  switch (status) {
    case 'pending':     return '#F59E0B';
    case 'in_progress': return '#3B82F6';
    case 'reviewing':   return '#8B5CF6';
    case 'finalized':   return '#10B981';
    case 'approved':    return '#10B981';
    case 'paid':        return '#22C55E';
    default:            return '#64748B';
  }
};


// ══════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════
export default function SpendingAnalytics({ projectId }: SpendingAnalyticsProps) {
  const { user } = useAuth();

  // ── Data hooks ──
  const {
    data: dashboard,
    loading: dashLoading,
    error: dashError,
    refetch: refetchDashboard,
  } = useSpendingDashboard(projectId);

  const {
    data: milestones,
    loading: msLoading,
    refetch: refetchMilestones,
  } = useMilestones(projectId);

  // ── Release payment state ──
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [selectedMilestone, setSelectedMilestone] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>("bank_transfer");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [releasing, setReleasing] = useState(false);

  // ── Derived data ──
  const isAdmin = user?.role === "super_admin" || user?.role === "admin";

  const releasableMilestones = useMemo(
    () => milestones.filter((m: any) => m.status === "approved"),
    [milestones]
  );

  const utilizationColor = useMemo(() => {
    if (!dashboard?.utilization) return "#6b7280";
    const pct = dashboard.utilization.utilization_pct;
    if (pct >= 90) return "#ef4444";
    if (pct >= 75) return "#f59e0b";
    return "#22c55e";
  }, [dashboard]);

  // ──────────────────────────────────────────────
  // RELEASE PAYMENT HANDLER
  // ──────────────────────────────────────────────
  const handleOpenRelease = (milestone: any) => {
    setSelectedMilestone(milestone);
    setPaymentMethod("bank_transfer");
    setPaymentNotes("");
    setReleaseDialogOpen(true);
  };

  const handleReleasePayment = async () => {
    if (!selectedMilestone || !user) return;

    // ── Client-side validation ──
    if (!isAdmin) {
      Alert.alert("Access Denied", "Only admins can release payments.");
      return;
    }

    if (selectedMilestone.status !== "approved") {
      Alert.alert("Invalid Status", "Only approved milestones can be paid.");
      return;
    }

    if (selectedMilestone.amount <= 0) {
      Alert.alert("Invalid Amount", "Milestone amount must be greater than zero.");
      return;
    }

    // ── Build request ──
    const request: ReleasePaymentRequest = {
      milestone_id: selectedMilestone.id,
      project_id: projectId,
      payment_method: paymentMethod as ReleasePaymentRequest["payment_method"],
      notes: paymentNotes.trim() || undefined,
    };

    setReleasing(true);

    try {
      // ── Call Supabase Edge Function ──
      const { data: session } = await supabase.auth.getSession();

      if (!session?.session?.access_token) {
        throw new Error("Authentication session expired. Please log in again.");
      }

      const { data, error } = await supabase.functions.invoke<ReleasePaymentResponse>(
        "release-payment",
        {
          body: request,
          headers: {
            Authorization: `Bearer ${session.session.access_token}`,
          },
        }
      );

      if (error) {
        throw new Error(error.message || "Edge function invocation failed.");
      }

      if (!data?.success) {
        throw new Error(data?.error || "Payment release failed.");
      }

      // ── Success ──
      Alert.alert(
        "Payment Released!",
        `${formatCurrency(data.amount ?? selectedMilestone.amount)} released for "${selectedMilestone.title}". Payment ID: ${data.payment_id?.slice(0, 8)}...`
      );

      // Close dialog & refresh data
      setReleaseDialogOpen(false);
      setSelectedMilestone(null);

      // Refetch all analytics data
      await Promise.all([refetchDashboard(), refetchMilestones()]);
    } catch (err: any) {
      console.error("Release payment error:", err);
      Alert.alert("Payment Failed", err.message || "An unexpected error occurred.");
    } finally {
      setReleasing(false);
    }
  };

  // ──────────────────────────────────────────────
  // LOADING STATE
  // ──────────────────────────────────────────────
  if (dashLoading || msLoading) {
    return <LoadingState message="Loading analytics…" />;
  }

  // ──────────────────────────────────────────────
  // ERROR STATE
  // ──────────────────────────────────────────────
  if (dashError) {
    return (
      <ErrorState
        message={`Failed to load analytics: ${dashError}`}
        onRetry={refetchDashboard}
      />
    );
  }

  const util = dashboard?.utilization;
  const burnRate = dashboard?.burn_rate ?? [];

  // ══════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ── KPI Cards Row ── */}
      <View style={styles.kpiRow}>
        {/* Total Budget */}
        <View style={styles.kpiCard}>
          <LinearGradient colors={["#1e293b", "#0f172a"]} style={styles.kpiGradient}>
            <Text style={styles.kpiLabel}>Total Budget</Text>
            <Text style={styles.kpiValue}>{formatCurrency(util?.total_budget ?? 0)}</Text>
            <Text style={styles.kpiSubLabel}>{util?.milestones_total ?? 0} milestones total</Text>
          </LinearGradient>
        </View>

        {/* Total Paid */}
        <View style={styles.kpiCard}>
          <LinearGradient colors={["#059669", "#047857"]} style={styles.kpiGradient}>
            <Text style={styles.kpiLabel}>Total Paid</Text>
            <Text style={[styles.kpiValue, { color: "#10b981" }]}>
              {formatCurrency(util?.total_paid ?? 0)}
            </Text>
            <Text style={styles.kpiSubLabel}>{util?.milestones_paid ?? 0} milestones paid</Text>
          </LinearGradient>
        </View>

        {/* Utilization % */}
        <View style={styles.kpiCard}>
          <LinearGradient colors={["#1e293b", "#0f172a"]} style={styles.kpiGradient}>
            <Text style={styles.kpiLabel}>Utilization</Text>
            <Text style={[styles.kpiValue, { color: utilizationColor }]}>
              {util?.utilization_pct ?? 0}%
            </Text>
            <Text style={styles.kpiSubLabel}>
              {formatCurrency(util?.remaining_budget ?? 0)} remaining
            </Text>
          </LinearGradient>
        </View>

        {/* Avg Monthly Burn */}
        <View style={styles.kpiCard}>
          <LinearGradient colors={["#1e293b", "#0f172a"]} style={styles.kpiGradient}>
            <Text style={styles.kpiLabel}>Avg Monthly Burn</Text>
            <Text style={styles.kpiValue}>
              {formatCurrency(dashboard?.avg_monthly_burn ?? 0)}
            </Text>
            <Text style={styles.kpiSubLabel}>
              {dashboard?.months_remaining != null
                ? `~${dashboard.months_remaining} months remaining`
                : "No burn data yet"}
            </Text>
          </LinearGradient>
        </View>
      </View>

      {/* ── Burn Rate Chart Placeholder ── */}
      <View style={styles.chartCard}>
        <LinearGradient colors={["#1e293b", "#0f172a"]} style={styles.chartGradient}>
          <Text style={styles.chartTitle}>Monthly Burn Rate</Text>
          <Text style={styles.chartSubtitle}>
            Payment disbursements over the last 12 months
          </Text>
          <View style={styles.chartPlaceholder}>
            <Text style={styles.chartPlaceholderText}>
              {burnRate.length === 0 ? "No payment data available yet." : "Chart would render here"}
            </Text>
          </View>
        </LinearGradient>
      </View>

      {/* ── Milestones Table with Release Payment ── */}
      <View style={styles.milestonesCard}>
        <LinearGradient colors={["#1e293b", "#0f172a"]} style={styles.milestonesGradient}>
          <View style={styles.milestonesHeader}>
            <View>
              <Text style={styles.milestonesTitle}>Milestones & Payments</Text>
              <Text style={styles.milestonesSubtitle}>
                {releasableMilestones.length > 0
                  ? `${releasableMilestones.length} milestone(s) ready for payment`
                  : "No milestones pending payment"}
              </Text>
            </View>
            {releasableMilestones.length > 0 && isAdmin && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>Awaiting Release</Text>
              </View>
            )}
          </View>

          <View style={styles.milestonesTable}>
            {milestones.map((milestone: any, index: number) => (
              <View key={milestone.id} style={styles.milestoneRow}>
                <View style={styles.milestoneInfo}>
                  <Text style={styles.milestoneIndex}>{index + 1}</Text>
                  <View>
                    <Text style={styles.milestoneTitle}>{milestone.title}</Text>
                    {milestone.description && (
                      <Text style={styles.milestoneDescription}>{milestone.description}</Text>
                    )}
                  </View>
                </View>
                <View style={styles.milestoneDetails}>
                  <Text style={styles.milestoneAmount}>{formatCurrency(milestone.amount)}</Text>
                  <Text style={styles.milestoneDueDate}>
                    {milestone.due_date
                      ? new Date(milestone.due_date).toLocaleDateString()
                      : "—"}
                  </Text>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusVariant(milestone.status) }]}>
                    <Text style={styles.statusText}>{milestone.status.replace("_", " ")}</Text>
                  </View>
                  <View style={styles.actionCell}>
                    {/* 
                      ╔══════════════════════════════════════╗
                      ║   RELEASE PAYMENT BUTTON             ║
                      ║   Only visible when:                 ║
                      ║   1. User is admin                   ║
                      ║   2. Milestone is "approved"         ║
                      ╚══════════════════════════════════════╝
                    */}
                    {isAdmin && milestone.status === "approved" ? (
                      <TouchableOpacity
                        style={styles.releaseButton}
                        onPress={() => handleOpenRelease(milestone)}
                      >
                        <Text style={styles.releaseButtonText}>Release Payment</Text>
                      </TouchableOpacity>
                    ) : milestone.status === "paid" ? (
                      <Text style={styles.paidText}>
                        Paid {milestone.paid_at && new Date(milestone.paid_at).toLocaleDateString()}
                      </Text>
                    ) : (
                      <Text style={styles.noActionText}>—</Text>
                    )}
                  </View>
                </View>
              </View>
            ))}

            {milestones.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>No milestones found for this project.</Text>
              </View>
            )}
          </View>
        </LinearGradient>
      </View>

      {/* ══════════════════════════════════════════ */}
      {/* RELEASE PAYMENT CONFIRMATION DIALOG       */}
      {/* ══════════════════════════════════════════ */}
      <Modal
        visible={releaseDialogOpen}
        transparent
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <LinearGradient colors={["#1e293b", "#0f172a"]} style={styles.modalGradient}>
              <Text style={styles.modalTitle}>Release Payment</Text>
              <Text style={styles.modalSubtitle}>
                You are about to release a payment. This action is irreversible.
              </Text>

              {selectedMilestone && (
                <View style={styles.modalSummary}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Milestone</Text>
                    <Text style={styles.summaryValue}>{selectedMilestone.title}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Amount</Text>
                    <Text style={[styles.summaryValue, { color: "#10b981" }]}>
                      {formatCurrency(selectedMilestone.amount)}
                    </Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Project ID</Text>
                    <Text style={styles.summaryValue}>{projectId.slice(0, 8)}...</Text>
                  </View>
                </View>
              )}

              <View style={styles.modalWarning}>
                <Text style={styles.warningText}>
                  This will mark the milestone as paid, create a payment record, and log the action in the audit trail.
                </Text>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => setReleaseDialogOpen(false)}
                  disabled={releasing}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmButton}
                  onPress={handleReleasePayment}
                  disabled={releasing}
                >
                  <Text style={styles.confirmButtonText}>
                    {releasing ? "Processing..." : "Confirm & Release"}
                  </Text>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ══════════════════════════════════════════════
// STYLES
// ══════════════════════════════════════════════
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#020617",
  },
  content: {
    padding: 16,
  },
  kpiRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 16,
  },
  kpiCard: {
    flex: 1,
    minWidth: "48%",
    borderRadius: 12,
    overflow: "hidden",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  kpiGradient: {
    padding: 16,
  },
  kpiLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: "800",
    color: "#f8fafc",
    marginTop: 4,
  },
  kpiSubLabel: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 2,
  },
  chartCard: {
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 16,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  chartGradient: {
    padding: 16,
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#f8fafc",
    marginBottom: 4,
  },
  chartSubtitle: {
    fontSize: 12,
    color: "#94a3b8",
    marginBottom: 12,
  },
  chartPlaceholder: {
    height: 200,
    backgroundColor: "#0f172a",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  chartPlaceholderText: {
    fontSize: 14,
    color: "#94a3b8",
  },
  milestonesCard: {
    borderRadius: 12,
    overflow: "hidden",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  milestonesGradient: {
    padding: 16,
  },
  milestonesHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  milestonesTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#f8fafc",
  },
  milestonesSubtitle: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 2,
  },
  badge: {
    backgroundColor: "#0f172a",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#fbbf24",
    textTransform: "uppercase",
  },
  milestonesTable: {
    gap: 8,
  },
  milestoneRow: {
    backgroundColor: "#0f172a",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  milestoneInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  milestoneIndex: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: "600",
    width: 20,
  },
  milestoneTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#f8fafc",
  },
  milestoneDescription: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 2,
  },
  milestoneDetails: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  milestoneAmount: {
    fontSize: 16,
    fontWeight: "700",
    color: "#f8fafc",
    fontFamily: "monospace",
  },
  milestoneDueDate: {
    fontSize: 12,
    color: "#94a3b8",
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    minWidth: 60,
    alignItems: "center",
  },
  statusText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#020617",
    textTransform: "uppercase",
  },
  actionCell: {
    alignItems: "flex-end",
  },
  releaseButton: {
    backgroundColor: "#3b82f6",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  releaseButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#ffffff",
  },
  paidText: {
    fontSize: 12,
    color: "#22c55e",
  },
  noActionText: {
    fontSize: 12,
    color: "#64748b",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 20,
  },
  emptyStateText: {
    fontSize: 14,
    color: "#94a3b8",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 12,
    overflow: "hidden",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  modalGradient: {
    padding: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#f8fafc",
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 12,
    color: "#94a3b8",
    marginBottom: 16,
  },
  modalSummary: {
    backgroundColor: "#0f172a",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  summaryLabel: {
    fontSize: 12,
    color: "#94a3b8",
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#f8fafc",
  },
  modalWarning: {
    backgroundColor: "#7f1d1d",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  warningText: {
    fontSize: 12,
    color: "#fecaca",
    lineHeight: 16,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: "#334155",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#f8fafc",
  },
  confirmButton: {
    flex: 1,
    backgroundColor: "#22c55e",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  confirmButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#020617",
  },
});