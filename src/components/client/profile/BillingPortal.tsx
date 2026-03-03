// src/components/client/profile/BillingPortal.tsx
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

// ─── Theme ──────────────────────────────────────────────
const COLORS = {
  bg: "#020617",
  card: "#0F172A",
  cardBorder: "#1E293B",
  surface: "#1E293B",
  surfaceLight: "#334155",
  accent: "#3B82F6",
  accentMuted: "rgba(59,130,246,0.15)",
  success: "#10B981",
  successMuted: "rgba(16,185,129,0.15)",
  warning: "#F59E0B",
  warningMuted: "rgba(245,158,11,0.15)",
  danger: "#EF4444",
  dangerMuted: "rgba(239,68,68,0.15)",
  purple: "#8B5CF6",
  purpleMuted: "rgba(139,92,246,0.15)",
  cyan: "#06B6D4",
  cyanMuted: "rgba(6,182,212,0.15)",
  orange: "#F97316",
  orangeMuted: "rgba(249,115,22,0.15)",
  emerald: "#34D399",
  emeraldMuted: "rgba(52,211,153,0.15)",
  gold: "#FBBF24",
  goldMuted: "rgba(251,191,36,0.12)",
  textPrimary: "#F8FAFC",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
  white: "#FFFFFF",
};

// ─── Mock Data ──────────────────────────────────────────
interface BillingInfo {
  plan: string;
  price: string;
  billingCycle: string;
  nextBillingDate: string;
  paymentMethod: string;
  lastFour: string;
  status: "Active" | "Trial" | "Suspended";
}

const MOCK_BILLING_INFO: BillingInfo = {
  plan: "Enterprise",
  price: "$2,499",
  billingCycle: "Monthly",
  nextBillingDate: "Mar 1, 2025",
  paymentMethod: "Visa",
  lastFour: "4242",
  status: "Active",
};

interface Invoice {
  id: string;
  date: string;
  amount: string;
  status: "Paid" | "Pending" | "Overdue";
  invoiceNumber: string;
  downloadUrl: string;
}

const MOCK_INVOICES: Invoice[] = [
  {
    id: "1",
    date: "Jan 1, 2025",
    amount: "$2,499.00",
    status: "Paid",
    invoiceNumber: "INV-2025-01",
    downloadUrl: "https://example.com/invoice/1",
  },
  {
    id: "2",
    date: "Dec 1, 2024",
    amount: "$2,499.00",
    status: "Paid",
    invoiceNumber: "INV-2024-12",
    downloadUrl: "https://example.com/invoice/2",
  },
  {
    id: "3",
    date: "Nov 1, 2024",
    amount: "$2,499.00",
    status: "Paid",
    invoiceNumber: "INV-2024-11",
    downloadUrl: "https://example.com/invoice/3",
  },
];

interface UsageMetric {
  name: string;
  current: number;
  limit: number;
  unit: string;
  color: string;
}

const MOCK_USAGE_METRICS: UsageMetric[] = [
  {
    name: "Inspection Reports",
    current: 156,
    limit: 200,
    unit: "per month",
    color: COLORS.accent,
  },
  {
    name: "Storage Used",
    current: 12.4,
    limit: 50,
    unit: "GB",
    color: COLORS.purple,
  },
  {
    name: "Team Members",
    current: 12,
    limit: 25,
    unit: "active users",
    color: COLORS.emerald,
  },
  {
    name: "API Calls",
    current: 8470,
    limit: 10000,
    unit: "per month",
    color: COLORS.cyan,
  },
];

// ─── Billing Portal Component ───────────────────────────
export default function BillingPortal() {
  const [billingInfo, setBillingInfo] = useState<BillingInfo>(MOCK_BILLING_INFO);
  const [invoices, setInvoices] = useState<Invoice[]>(MOCK_INVOICES);
  const [usageMetrics, setUsageMetrics] = useState<UsageMetric[]>(MOCK_USAGE_METRICS);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [newCardNumber, setNewCardNumber] = useState("");
  const [newExpiry, setNewExpiry] = useState("");
  const [newCVC, setNewCVC] = useState("");

  const handleUpgradePlan = useCallback(() => {
    Alert.alert(
      "Plan Upgrade",
      "Contact sales@inspectai.com to upgrade your plan and access additional features.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Contact Sales",
          onPress: () => {
            // Simulate email action
            Alert.alert("Email", "sales@inspectai.com");
          },
        },
      ]
    );
  }, []);

  const handleDownloadInvoice = useCallback((invoice: Invoice) => {
    Alert.alert("Download Invoice", `Downloading invoice ${invoice.invoiceNumber}...`, [
      { text: "OK" },
    ]);
  }, []);

  const handleUpdatePaymentMethod = useCallback(() => {
    if (!newCardNumber || !newExpiry || !newCVC) {
      Alert.alert("Error", "Please fill in all payment method details");
      return;
    }
    Alert.alert("Success", "Payment method updated successfully", [{ text: "OK" }]);
    setShowPaymentModal(false);
    setNewCardNumber("");
    setNewExpiry("");
    setNewCVC("");
  }, [newCardNumber, newExpiry, newCVC]);

  const handleCancelSubscription = useCallback(() => {
    Alert.alert(
      "Cancel Subscription",
      "Are you sure you want to cancel your subscription? You will lose access to premium features.",
      [
        { text: "Keep Subscription", style: "cancel" },
        {
          text: "Cancel",
          style: "destructive",
          onPress: () => {
            setBillingInfo((prev) => ({ ...prev, status: "Suspended" }));
          },
        },
      ]
    );
  }, []);

  const getUsagePercentage = (current: number, limit: number) => {
    return Math.min((current / limit) * 100, 100);
  };

  return (
    <View style={styles.container}>
      {/* Current Plan & Billing Info */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="card-outline" size={20} color={COLORS.accent} />
          <Text style={styles.cardTitle}>Current Plan</Text>
          <TouchableOpacity
            style={styles.upgradeBtn}
            onPress={() => setShowUpgradeModal(true)}
          >
            <Ionicons name="trending-up-outline" size={16} color={COLORS.white} />
            <Text style={styles.upgradeBtnText}>Upgrade</Text>
          </TouchableOpacity>
        </View>
        
        <View style={styles.planInfo}>
          <View style={styles.planHeader}>
            <Text style={styles.planName}>{billingInfo.plan}</Text>
            <Text style={styles.planPrice}>{billingInfo.price}</Text>
            <Text style={styles.planCycle}>{billingInfo.billingCycle}</Text>
          </View>
          
          <View style={styles.planStatusRow}>
            <View style={[styles.statusBadge, styles[`status_${billingInfo.status}`]]}>
              <Text style={styles.statusText}>{billingInfo.status}</Text>
            </View>
            <Text style={styles.nextBilling}>
              Next billing: {billingInfo.nextBillingDate}
            </Text>
          </View>

          <View style={styles.paymentMethodRow}>
            <Text style={styles.paymentLabel}>Payment Method</Text>
            <View style={styles.paymentInfo}>
              <Text style={styles.paymentText}>
                {billingInfo.paymentMethod} •••• {billingInfo.lastFour}
              </Text>
              <TouchableOpacity
                style={styles.editPaymentBtn}
                onPress={() => setShowPaymentModal(true)}
              >
                <Ionicons name="pencil-outline" size={14} color={COLORS.accent} />
                <Text style={styles.editPaymentText}>Edit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.planActions}>
          <TouchableOpacity
            style={styles.planActionBtn}
            onPress={() => Alert.alert("Contact Support", "support@inspectai.com")}
          >
            <Ionicons name="help-circle-outline" size={16} color={COLORS.textPrimary} />
            <Text style={styles.planActionText}>Contact Support</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={handleCancelSubscription}
          >
            <Ionicons name="close-circle-outline" size={16} color={COLORS.danger} />
            <Text style={styles.cancelBtnText}>Cancel Subscription</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Usage Metrics */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="analytics-outline" size={20} color={COLORS.accent} />
          <Text style={styles.cardTitle}>Usage Metrics</Text>
        </View>
        
        {usageMetrics.map((metric, index) => {
          const percentage = getUsagePercentage(metric.current, metric.limit);
          return (
            <View key={index} style={styles.metricRow}>
              <View style={styles.metricInfo}>
                <Text style={styles.metricName}>{metric.name}</Text>
                <Text style={styles.metricValue}>
                  {metric.current} / {metric.limit} {metric.unit}
                </Text>
              </View>
              <View style={styles.metricBarContainer}>
                <View
                  style={[
                    styles.metricBar,
                    { backgroundColor: `${metric.color}20` },
                  ]}
                >
                  <View
                    style={[
                      styles.metricBarFill,
                      {
                        backgroundColor: metric.color,
                        width: `${percentage}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.metricPercentage}>{Math.round(percentage)}%</Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Invoice History */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="document-text-outline" size={20} color={COLORS.accent} />
          <Text style={styles.cardTitle}>Invoice History</Text>
        </View>
        
        <ScrollView style={styles.invoicesList}>
          {invoices.map((invoice) => (
            <View key={invoice.id} style={styles.invoiceRow}>
              <View style={styles.invoiceInfo}>
                <Text style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
                <Text style={styles.invoiceDate}>{invoice.date}</Text>
              </View>
              <View style={styles.invoiceDetails}>
                <Text style={styles.invoiceAmount}>{invoice.amount}</Text>
                <View style={[styles.invoiceStatus, styles[`status_${invoice.status}`]]}>
                  <Text style={styles.invoiceStatusText}>{invoice.status}</Text>
                </View>
                <TouchableOpacity
                  style={styles.downloadBtn}
                  onPress={() => handleDownloadInvoice(invoice)}
                >
                  <Ionicons name="download-outline" size={16} color={COLORS.accent} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Upgrade Modal */}
      <Modal
        visible={showUpgradeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowUpgradeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Upgrade Your Plan</Text>
            <Text style={styles.modalSubtitle}>
              Unlock premium features and increase your limits
            </Text>
            
            <View style={styles.planOptions}>
              <View style={styles.planOption}>
                <Text style={styles.planOptionTitle}>Professional</Text>
                <Text style={styles.planOptionPrice}>$999/month</Text>
                <Text style={styles.planOptionFeatures}>
                  • 500 inspection reports/mo
                  • 100 GB storage
                  • 10 team members
                  • Priority support
                </Text>
                <TouchableOpacity style={styles.selectBtn}>
                  <Text style={styles.selectBtnText}>Select Professional</Text>
                </TouchableOpacity>
              </View>
              
              <View style={[styles.planOption, styles.planOptionPopular]}>
                <View style={styles.popularBadge}>
                  <Text style={styles.popularText}>Most Popular</Text>
                </View>
                <Text style={styles.planOptionTitle}>Enterprise</Text>
                <Text style={styles.planOptionPrice}>$2,499/month</Text>
                <Text style={styles.planOptionFeatures}>
                  • 2000 inspection reports/mo
                  • 500 GB storage
                  • 50 team members
                  • 24/7 dedicated support
                  • Custom integrations
                </Text>
                <TouchableOpacity style={[styles.selectBtn, styles.selectBtnActive]}>
                  <Text style={[styles.selectBtnText, styles.selectBtnTextActive]}>
                    Current Plan
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={styles.closeModalBtn}
              onPress={() => setShowUpgradeModal(false)}
            >
              <Text style={styles.closeModalBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Payment Method Modal */}
      <Modal
        visible={showPaymentModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPaymentModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Update Payment Method</Text>
            <Text style={styles.modalSubtitle}>Enter your new payment information</Text>
            
            <TextInput
              style={styles.input}
              placeholder="Card Number"
              placeholderTextColor={COLORS.textMuted}
              value={newCardNumber}
              onChangeText={setNewCardNumber}
              keyboardType="numeric"
              maxLength={19}
            />
            
            <View style={styles.formRow}>
              <TextInput
                style={[styles.input, styles.halfInput]}
                placeholder="MM/YY"
                placeholderTextColor={COLORS.textMuted}
                value={newExpiry}
                onChangeText={setNewExpiry}
                keyboardType="numeric"
                maxLength={5}
              />
              <TextInput
                style={[styles.input, styles.halfInput]}
                placeholder="CVC"
                placeholderTextColor={COLORS.textMuted}
                value={newCVC}
                onChangeText={setNewCVC}
                keyboardType="numeric"
                maxLength={4}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowPaymentModal(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmBtn}
                onPress={handleUpdatePaymentMethod}
              >
                <Ionicons name="save-outline" size={16} color={COLORS.white} />
                <Text style={styles.confirmBtnText}>Update Payment</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  cardTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    marginLeft: 10,
  },
  planInfo: {
    gap: 16,
  },
  planHeader: {
    alignItems: "center",
    gap: 4,
  },
  planName: {
    color: COLORS.textPrimary,
    fontSize: 24,
    fontWeight: "800",
  },
  planPrice: {
    color: COLORS.accent,
    fontSize: 20,
    fontWeight: "700",
  },
  planCycle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "500",
  },
  planStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  status_Active: {
    backgroundColor: COLORS.successMuted,
  },
  status_Trial: {
    backgroundColor: COLORS.warningMuted,
  },
  status_Suspended: {
    backgroundColor: COLORS.dangerMuted,
  },
  status_Paid: {
    backgroundColor: COLORS.successMuted,
  },
  status_Pending: {
    backgroundColor: COLORS.warningMuted,
  },
  status_Overdue: {
    backgroundColor: COLORS.dangerMuted,
  },
  statusText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  nextBilling: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "500",
  },
  paymentMethodRow: {
    gap: 8,
  },
  paymentLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  paymentInfo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 12,
  },
  paymentText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  editPaymentBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(59,130,246,0.1)",
  },
  editPaymentText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: "600",
  },
  planActions: {
    flexDirection: "row",
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.04)",
  },
  planActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  planActionText: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  cancelBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: "rgba(239,68,68,0.1)",
  },
  cancelBtnText: {
    color: COLORS.danger,
    fontSize: 13,
    fontWeight: "600",
  },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: COLORS.accent,
  },
  upgradeBtnText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: "700",
  },
  metricRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  metricInfo: {
    flex: 1,
  },
  metricName: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  metricValue: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "500",
  },
  metricBarContainer: {
    alignItems: "flex-end",
    gap: 4,
  },
  metricBar: {
    width: 120,
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  metricBarFill: {
    height: "100%",
  },
  metricPercentage: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  invoicesList: {
    maxHeight: 200,
  },
  invoiceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  invoiceInfo: {
    flex: 1,
  },
  invoiceNumber: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  invoiceDate: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "500",
  },
  invoiceDetails: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  invoiceAmount: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  invoiceStatus: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  invoiceStatusText: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: "700",
  },
  downloadBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: "rgba(59,130,246,0.1)",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 20,
    width: "100%",
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  modalTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 6,
  },
  modalSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginBottom: 16,
  },
  planOptions: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
  },
  planOption: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: "center",
    gap: 10,
  },
  planOptionPopular: {
    backgroundColor: COLORS.accentMuted,
    borderColor: "rgba(59,130,246,0.3)",
    position: "relative",
  },
  popularBadge: {
    position: "absolute",
    top: -10,
    right: -10,
    backgroundColor: COLORS.gold,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  popularText: {
    color: COLORS.bg,
    fontSize: 10,
    fontWeight: "700",
  },
  planOptionTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  planOptionPrice: {
    color: COLORS.accent,
    fontSize: 18,
    fontWeight: "800",
  },
  planOptionFeatures: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 16,
  },
  selectBtn: {
    width: "100%",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: "center",
  },
  selectBtnActive: {
    backgroundColor: COLORS.accent,
    borderColor: "rgba(59,130,246,0.3)",
  },
  selectBtnText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
  selectBtnTextActive: {
    color: COLORS.white,
  },
  closeModalBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: "center",
  },
  closeModalBtnText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 12,
    color: COLORS.textPrimary,
    fontSize: 14,
    marginBottom: 12,
  },
  formRow: {
    flexDirection: "row",
    gap: 12,
  },
  halfInput: {
    flex: 1,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  confirmBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: COLORS.accent,
  },
  confirmBtnText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: "700",
  },
});