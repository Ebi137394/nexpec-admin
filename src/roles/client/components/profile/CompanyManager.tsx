// src/components/client/profile/CompanyManager.tsx
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
interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "Admin" | "Manager" | "Viewer";
  status: "Active" | "Pending" | "Inactive";
  lastSeen: string;
  avatarColor: string;
}

const MOCK_TEAM_MEMBERS: TeamMember[] = [
  {
    id: "1",
    name: "Sarah Johnson",
    email: "sarah.j@meridianenergy.com",
    role: "Admin",
    status: "Active",
    lastSeen: "2 hours ago",
    avatarColor: "#3B82F6",
  },
  {
    id: "2",
    name: "Marcus Chen",
    email: "marcus.c@meridianenergy.com",
    role: "Manager",
    status: "Active",
    lastSeen: "1 day ago",
    avatarColor: "#10B981",
  },
  {
    id: "3",
    name: "Lisa Rodriguez",
    email: "lisa.r@meridianenergy.com",
    role: "Viewer",
    status: "Pending",
    lastSeen: "Invited 3 days ago",
    avatarColor: "#F59E0B",
  },
  {
    id: "4",
    name: "David Kim",
    email: "david.k@meridianenergy.com",
    role: "Manager",
    status: "Active",
    lastSeen: "5 hours ago",
    avatarColor: "#8B5CF6",
  },
];

interface CompanyInfo {
  name: string;
  industry: string;
  size: string;
  plan: string;
  billingEmail: string;
  address: string;
  phone: string;
}

const MOCK_COMPANY_INFO: CompanyInfo = {
  name: "Meridian Energy Corporation",
  industry: "Energy & Utilities",
  size: "500+ employees",
  plan: "Enterprise",
  billingEmail: "billing@meridianenergy.com",
  address: "1234 Energy Way, Houston, TX 77001",
  phone: "+1 (800) 555-0199",
};

// ─── Company Manager Component ──────────────────────────
export default function CompanyManager() {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(MOCK_TEAM_MEMBERS);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>(MOCK_COMPANY_INFO);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"Admin" | "Manager" | "Viewer">("Viewer");

  const handleInvite = useCallback(() => {
    if (!inviteEmail.trim()) {
      Alert.alert("Error", "Please enter a valid email address");
      return;
    }

    const newMember: TeamMember = {
      id: Date.now().toString(),
      name: inviteEmail.split("@")[0],
      email: inviteEmail,
      role: inviteRole,
      status: "Pending",
      lastSeen: "Invited just now",
      avatarColor: "#F59E0B",
    };

    setTeamMembers((prev) => [...prev, newMember]);
    setInviteEmail("");
    setShowInviteModal(false);
    Alert.alert("Success", `Invitation sent to ${inviteEmail}`);
  }, [inviteEmail, inviteRole]);

  const handleRemoveMember = useCallback((memberId: string) => {
    Alert.alert(
      "Remove Member",
      "Are you sure you want to remove this team member?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            setTeamMembers((prev) => prev.filter((m) => m.id !== memberId));
          },
        },
      ]
    );
  }, []);

  const handleRoleChange = useCallback((memberId: string, newRole: TeamMember["role"]) => {
    setTeamMembers((prev) =>
      prev.map((member) =>
        member.id === memberId ? { ...member, role: newRole } : member
      )
    );
  }, []);

  return (
    <View style={styles.container}>
      {/* Company Information */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="business-outline" size={20} color={COLORS.accent} />
          <Text style={styles.cardTitle}>Company Information</Text>
        </View>
        
        <View style={styles.companyGrid}>
          <View style={styles.companyInfoRow}>
            <Text style={styles.infoLabel}>Company Name</Text>
            <Text style={styles.infoValue}>{companyInfo.name}</Text>
          </View>
          <View style={styles.companyInfoRow}>
            <Text style={styles.infoLabel}>Industry</Text>
            <Text style={styles.infoValue}>{companyInfo.industry}</Text>
          </View>
          <View style={styles.companyInfoRow}>
            <Text style={styles.infoLabel}>Company Size</Text>
            <Text style={styles.infoValue}>{companyInfo.size}</Text>
          </View>
          <View style={styles.companyInfoRow}>
            <Text style={styles.infoLabel}>Plan Type</Text>
            <View style={styles.planBadge}>
              <Text style={styles.planText}>{companyInfo.plan}</Text>
            </View>
          </View>
          <View style={styles.companyInfoRow}>
            <Text style={styles.infoLabel}>Billing Email</Text>
            <Text style={styles.infoValue}>{companyInfo.billingEmail}</Text>
          </View>
          <View style={styles.companyInfoRow}>
            <Text style={styles.infoLabel}>Address</Text>
            <Text style={styles.infoValue}>{companyInfo.address}</Text>
          </View>
          <View style={styles.companyInfoRow}>
            <Text style={styles.infoLabel}>Phone</Text>
            <Text style={styles.infoValue}>{companyInfo.phone}</Text>
          </View>
        </View>
      </View>

      {/* Team Management */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="people-outline" size={20} color={COLORS.accent} />
          <Text style={styles.cardTitle}>Team Management</Text>
          <TouchableOpacity
            style={styles.inviteBtn}
            onPress={() => setShowInviteModal(true)}
          >
            <Ionicons name="add-outline" size={16} color={COLORS.white} />
            <Text style={styles.inviteBtnText}>Invite</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.teamList}>
          {teamMembers.map((member) => (
            <View key={member.id} style={styles.teamMemberRow}>
              {/* Avatar */}
              <View style={[styles.avatar, { backgroundColor: member.avatarColor }]}>
                <Text style={styles.avatarText}>
                  {member.name.split(" ").map((n) => n[0]).join("")}
                </Text>
              </View>

              {/* Member Info */}
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>{member.name}</Text>
                <Text style={styles.memberEmail}>{member.email}</Text>
                <View style={styles.memberMeta}>
                  <View style={[styles.statusBadge, styles[`status_${member.status}`]]}>
                    <Text style={styles.statusText}>{member.status}</Text>
                  </View>
                  <Text style={styles.memberLastSeen}>{member.lastSeen}</Text>
                </View>
              </View>

              {/* Actions */}
              <View style={styles.memberActions}>
                <View style={styles.roleContainer}>
                  <Text style={styles.roleLabel}>Role</Text>
                  <View style={styles.roleSelector}>
                    {(["Admin", "Manager", "Viewer"] as const).map((role) => (
                      <TouchableOpacity
                        key={role}
                        style={[
                          styles.roleOption,
                          member.role === role && styles.roleOptionActive,
                        ]}
                        onPress={() => handleRoleChange(member.id, role)}
                      >
                        <Text
                          style={[
                            styles.roleOptionText,
                            member.role === role && styles.roleOptionTextActive,
                          ]}
                        >
                          {role}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => handleRemoveMember(member.id)}
                >
                  <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Invite Modal */}
      <Modal
        visible={showInviteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInviteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Invite Team Member</Text>
            <Text style={styles.modalSubtitle}>Send an invitation to join your company</Text>
            
            <TextInput
              style={styles.input}
              placeholder="Enter email address"
              placeholderTextColor={COLORS.textMuted}
              value={inviteEmail}
              onChangeText={setInviteEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            
            <Text style={styles.inputLabel}>Select Role</Text>
            <View style={styles.roleOptions}>
              {(["Admin", "Manager", "Viewer"] as const).map((role) => (
                <TouchableOpacity
                  key={role}
                  style={[
                    styles.roleChip,
                    inviteRole === role && styles.roleChipActive,
                  ]}
                  onPress={() => setInviteRole(role)}
                >
                  <Text
                    style={[
                      styles.roleChipText,
                      inviteRole === role && styles.roleChipTextActive,
                    ]}
                  >
                    {role}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowInviteModal(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.inviteConfirmBtn}
                onPress={handleInvite}
              >
                <Ionicons name="send-outline" size={16} color={COLORS.white} />
                <Text style={styles.inviteConfirmBtnText}>Send Invite</Text>
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
  companyGrid: {
    gap: 12,
  },
  companyInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  infoLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: "500",
  },
  infoValue: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  planBadge: {
    backgroundColor: COLORS.goldMuted,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  planText: {
    color: COLORS.gold,
    fontSize: 12,
    fontWeight: "700",
  },
  inviteBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 6,
  },
  inviteBtnText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: "700",
  },
  teamList: {
    maxHeight: 300,
  },
  teamMemberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "800",
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  memberEmail: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginBottom: 6,
  },
  memberMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  status_Active: {
    backgroundColor: COLORS.successMuted,
  },
  status_Pending: {
    backgroundColor: COLORS.warningMuted,
  },
  status_Inactive: {
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  statusText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.textMuted,
  },
  memberLastSeen: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: "500",
  },
  memberActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  roleContainer: {
    alignItems: "center",
    gap: 6,
  },
  roleLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: "600",
  },
  roleSelector: {
    flexDirection: "row",
    gap: 4,
  },
  roleOption: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  roleOptionActive: {
    backgroundColor: COLORS.accentMuted,
  },
  roleOptionText: {
    fontSize: 10,
    fontWeight: "600",
    color: COLORS.textMuted,
  },
  roleOptionTextActive: {
    color: COLORS.accent,
  },
  removeBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: "rgba(239,68,68,0.1)",
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
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 12,
    color: COLORS.textPrimary,
    fontSize: 14,
    marginBottom: 16,
  },
  inputLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 8,
  },
  roleOptions: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 24,
  },
  roleChip: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  roleChipActive: {
    backgroundColor: COLORS.accentMuted,
    borderColor: "rgba(59,130,246,0.3)",
  },
  roleChipText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  roleChipTextActive: {
    color: COLORS.accent,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: "center",
  },
  cancelBtnText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  inviteConfirmBtn: {
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
  inviteConfirmBtnText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: "700",
  },
});