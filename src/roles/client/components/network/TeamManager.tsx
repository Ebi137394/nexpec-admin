// src/components/client/network/TeamManager.tsx
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import type { TeamMember, TeamRole, TeamInvite } from "@/src/types/network";

// ──────────────────────────────────────────────
// Seed Data
// ──────────────────────────────────────────────

const SEED_MEMBERS: TeamMember[] = [
  {
    id: "tm-001",
    name: "Richard Harding",
    email: "r.harding@oceancorp.com",
    avatarUri: "https://i.pravatar.cc/150?img=12",
    role: "admin",
    title: "Chief Engineer",
    department: "Engineering",
    joinedAt: "2024-01-15",
    lastActive: "2025-06-28T14:30:00Z",
    isOnline: true,
    permissions: {
      canApproveBids: true,
      canReleaseFunds: true,
      canViewReports: true,
      canManageTeam: true,
      canCreateProjects: true,
    },
  },
  {
    id: "tm-002",
    name: "Victoria Chen",
    email: "v.chen@oceancorp.com",
    avatarUri: "https://i.pravatar.cc/150?img=26",
    role: "accountant",
    title: "VP of Finance",
    department: "Finance & Treasury",
    joinedAt: "2024-03-20",
    lastActive: "2025-06-28T11:45:00Z",
    isOnline: true,
    permissions: {
      canApproveBids: false,
      canReleaseFunds: true,
      canViewReports: true,
      canManageTeam: false,
      canCreateProjects: false,
    },
  },
  {
    id: "tm-003",
    name: "Omar Al-Rashid",
    email: "o.alrashid@oceancorp.com",
    avatarUri: "https://i.pravatar.cc/150?img=33",
    role: "tech_viewer",
    title: "Senior Marine Surveyor",
    department: "Technical Operations",
    joinedAt: "2024-06-10",
    lastActive: "2025-06-27T16:20:00Z",
    isOnline: false,
    permissions: {
      canApproveBids: false,
      canReleaseFunds: false,
      canViewReports: true,
      canManageTeam: false,
      canCreateProjects: true,
    },
  },
];

// ──────────────────────────────────────────────
// Role Configuration
// ──────────────────────────────────────────────

const ROLE_CONFIG: Record<
  TeamRole,
  { label: string; color: string; bg: string; icon: string; description: string }
> = {
  admin: {
    label: "Admin",
    color: "#FFD60A",
    bg: "rgba(255,214,10,0.12)",
    icon: "👑",
    description: "Full access to all features and team management",
  },
  tech_viewer: {
    label: "Tech Viewer",
    color: "#0A84FF",
    bg: "rgba(10,132,255,0.12)",
    icon: "🔧",
    description: "Can view reports and create projects",
  },
  accountant: {
    label: "Accountant",
    color: "#30D158",
    bg: "rgba(48,209,88,0.12)",
    icon: "💼",
    description: "Financial access — can release funds and view reports",
  },
  project_manager: {
    label: "Project Manager",
    color: "#BF5AF2",
    bg: "rgba(191,90,242,0.12)",
    icon: "📋",
    description: "Can manage projects and approve bids",
  },
};

const AVAILABLE_ROLES: TeamRole[] = [
  "admin",
  "project_manager",
  "tech_viewer",
  "accountant",
];

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

const RoleBadge: React.FC<{ role: TeamRole; compact?: boolean }> = ({
  role,
  compact = false,
}) => {
  const config = ROLE_CONFIG[role];
  return (
    <View style={[roleBadgeStyles.badge, { backgroundColor: config.bg }]}>
      <Text style={roleBadgeStyles.icon}>{config.icon}</Text>
      {!compact && (
        <Text style={[roleBadgeStyles.label, { color: config.color }]}>
          {config.label}
        </Text>
      )}
    </View>
  );
};

const roleBadgeStyles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 5,
    alignSelf: "flex-start",
  },
  icon: { fontSize: 12 },
  label: { fontSize: 11, fontWeight: "700" },
});

const PermissionDot: React.FC<{ allowed: boolean; label: string }> = ({
  allowed,
  label,
}) => (
  <View style={permStyles.row}>
    <View
      style={[
        permStyles.dot,
        { backgroundColor: allowed ? "#30D158" : "rgba(255,255,255,0.08)" },
      ]}
    />
    <Text
      style={[permStyles.label, { color: allowed ? "#C8D2DD" : "#3A4A5E" }]}
    >
      {label}
    </Text>
  </View>
);

const permStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  label: { fontSize: 11, fontWeight: "500" },
});

const MemberCard: React.FC<{
  member: TeamMember;
  onRemove: (id: string) => void;
}> = ({ member, onRemove }) => {
  const [expanded, setExpanded] = useState(false);
  const config = ROLE_CONFIG[member.role];

  const timeAgo = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return "Just now";
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <TouchableOpacity
      style={[memberStyles.card, { borderLeftColor: config.color }]}
      onPress={() => setExpanded((p) => !p)}
      activeOpacity={0.8}
    >
      <View style={memberStyles.topRow}>
        <View style={memberStyles.avatarWrap}>
          <Image
            source={{ uri: member.avatarUri }}
            style={memberStyles.avatar}
          />
          {member.isOnline && <View style={memberStyles.onlineDot} />}
        </View>
        <View style={memberStyles.info}>
          <Text style={memberStyles.name}>{member.name}</Text>
          <Text style={memberStyles.title}>{member.title}</Text>
          <Text style={memberStyles.department}>{member.department}</Text>
        </View>
        <RoleBadge role={member.role} />
      </View>

      <View style={memberStyles.metaRow}>
        <Text style={memberStyles.metaText}>
          {member.isOnline ? "🟢 Online" : `⚪ ${timeAgo(member.lastActive)}`}
        </Text>
        <Text style={memberStyles.metaDivider}>•</Text>
        <Text style={memberStyles.metaText}>{member.email}</Text>
      </View>

      {expanded && (
        <View style={memberStyles.expandedSection}>
          <Text style={memberStyles.permTitle}>Permissions</Text>
          <View style={memberStyles.permGrid}>
            <PermissionDot
              allowed={member.permissions.canApproveBids}
              label="Approve Bids"
            />
            <PermissionDot
              allowed={member.permissions.canReleaseFunds}
              label="Release Funds"
            />
            <PermissionDot
              allowed={member.permissions.canViewReports}
              label="View Reports"
            />
            <PermissionDot
              allowed={member.permissions.canManageTeam}
              label="Manage Team"
            />
            <PermissionDot
              allowed={member.permissions.canCreateProjects}
              label="Create Projects"
            />
          </View>

          <View style={memberStyles.expandedFooter}>
            <Text style={memberStyles.joinedText}>
              Joined{" "}
              {new Date(member.joinedAt).toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
              })}
            </Text>
            <TouchableOpacity
              style={memberStyles.removeBtn}
              onPress={() => onRemove(member.id)}
              activeOpacity={0.7}
            >
              <Text style={memberStyles.removeBtnText}>Remove</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
};

const memberStyles = StyleSheet.create({
  card: {
    backgroundColor: "#0F172A",
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.04)",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatarWrap: { position: "relative", marginRight: 12 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.08)",
  },
  onlineDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#30D158",
    borderWidth: 2,
    borderColor: "#0F172A",
  },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
  title: { fontSize: 12, color: "#8896AB", marginTop: 1 },
  department: { fontSize: 11, color: "#5A6A7E", marginTop: 1 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.04)",
  },
  metaText: { fontSize: 11, color: "#5A6A7E" },
  metaDivider: { color: "#3A4A5E", marginHorizontal: 6, fontSize: 8 },
  expandedSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.04)",
  },
  permTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8896AB",
    marginBottom: 8,
  },
  permGrid: { marginBottom: 12 },
  expandedFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  joinedText: { fontSize: 11, color: "#3A4A5E" },
  removeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(255,59,48,0.1)",
  },
  removeBtnText: { fontSize: 12, color: "#FF3B30", fontWeight: "700" },
});

// ──────────────────────────────────────────────
// Invite Modal
// ──────────────────────────────────────────────

const InviteModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  onInvite: (invite: TeamInvite) => void;
}> = ({ visible, onClose, onInvite }) => {
  const [email, setEmail] = useState("");
  const [selectedRole, setSelectedRole] = useState<TeamRole>("tech_viewer");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = () => {
    if (!email.trim() || !email.includes("@")) {
      Alert.alert("Invalid Email", "Please enter a valid email address.");
      return;
    }

    setSending(true);

    // Simulate API call
    setTimeout(() => {
      setSending(false);
      onInvite({ email: email.trim(), role: selectedRole, message: message.trim() });
      setEmail("");
      setSelectedRole("tech_viewer");
      setMessage("");
    }, 1200);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={inviteStyles.root}
      >
        {/* Header */}
        <View style={inviteStyles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={inviteStyles.closeBtn}>✕</Text>
          </TouchableOpacity>
          <Text style={inviteStyles.headerTitle}>Invite Team Member</Text>
          <View style={{ width: 28 }} />
        </View>

        <ScrollView
          style={inviteStyles.body}
          contentContainerStyle={inviteStyles.bodyContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Email */}
          <Text style={inviteStyles.label}>Email Address</Text>
          <TextInput
            style={inviteStyles.input}
            placeholder="colleague@company.com"
            placeholderTextColor="#3A4A5E"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* Role Selector */}
          <Text style={inviteStyles.label}>Assign Role</Text>
          <View style={inviteStyles.roleGrid}>
            {AVAILABLE_ROLES.map((role) => {
              const config = ROLE_CONFIG[role];
              const isSelected = selectedRole === role;
              return (
                <TouchableOpacity
                  key={role}
                  style={[
                    inviteStyles.roleCard,
                    isSelected && {
                      borderColor: config.color,
                      backgroundColor: config.bg,
                    },
                  ]}
                  onPress={() => setSelectedRole(role)}
                  activeOpacity={0.7}
                >
                  <Text style={inviteStyles.roleIcon}>{config.icon}</Text>
                  <Text
                    style={[
                      inviteStyles.roleLabel,
                      isSelected && { color: config.color },
                    ]}
                  >
                    {config.label}
                  </Text>
                  <Text style={inviteStyles.roleDesc} numberOfLines={2}>
                    {config.description}
                  </Text>
                  {isSelected && (
                    <View
                      style={[
                        inviteStyles.roleCheck,
                        { backgroundColor: config.color },
                      ]}
                    >
                      <Text style={inviteStyles.roleCheckIcon}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Optional Message */}
          <Text style={inviteStyles.label}>Personal Message (optional)</Text>
          <TextInput
            style={[inviteStyles.input, inviteStyles.inputMultiline]}
            placeholder="Welcome to the team..."
            placeholderTextColor="#3A4A5E"
            value={message}
            onChangeText={setMessage}
            multiline
            maxLength={300}
          />

          {/* Send Button */}
          <TouchableOpacity
            style={[
              inviteStyles.sendBtn,
              sending && inviteStyles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={sending}
            activeOpacity={0.8}
          >
            {sending ? (
              <View style={inviteStyles.sendBtnInner}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={inviteStyles.sendBtnText}>Sending Invite…</Text>
              </View>
            ) : (
              <Text style={inviteStyles.sendBtnText}>
                Send Invitation ✉️
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const inviteStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#020617" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 56 : 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  closeBtn: { fontSize: 20, color: "#8896AB", fontWeight: "600" },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#FFFFFF" },
  body: { flex: 1 },
  bodyContent: { padding: 20, paddingBottom: 40 },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: "#8896AB",
    marginBottom: 8,
    marginTop: 18,
  },
  input: {
    backgroundColor: "#0F172A",
    borderRadius: 12,
    padding: 14,
    color: "#FFFFFF",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  roleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  roleCard: {
    width: "47%",
    backgroundColor: "#0F172A",
    borderRadius: 12,
    padding: 14,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.06)",
    position: "relative",
    minHeight: 100,
  },
  roleIcon: { fontSize: 22, marginBottom: 6 },
  roleLabel: { fontSize: 13, fontWeight: "700", color: "#C8D2DD", marginBottom: 4 },
  roleDesc: { fontSize: 10, color: "#5A6A7E", lineHeight: 14 },
  roleCheck: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  roleCheckIcon: { color: "#020617", fontSize: 12, fontWeight: "800" },
  sendBtn: {
    backgroundColor: "#0A84FF",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 28,
  },
  sendBtnDisabled: { backgroundColor: "#1A3A5C" },
  sendBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sendBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});

// ──────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────

const TeamManager: React.FC = () => {
  const [members, setMembers] = useState<TeamMember[]>(SEED_MEMBERS);
  const [inviteVisible, setInviteVisible] = useState(false);

  const handleRemove = useCallback((id: string) => {
    const member = SEED_MEMBERS.find((m) => m.id === id);
    Alert.alert(
      "Remove Member",
      `Remove ${member?.name ?? "this member"} from the organization?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            setMembers((prev) => prev.filter((m) => m.id !== id));
            Alert.alert("Removed", "Team member has been removed.");
          },
        },
      ]
    );
  }, []);

  const handleInvite = useCallback((invite: TeamInvite) => {
    const config = ROLE_CONFIG[invite.role];
    const newMember: TeamMember = {
      id: `tm-${Date.now()}`,
      name: invite.email.split("@")[0].replace(/[._]/g, " "),
      email: invite.email,
      avatarUri: `https://i.pravatar.cc/150?u=${invite.email}`,
      role: invite.role,
      title: "Invited Member",
      department: "Pending",
      joinedAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      isOnline: false,
      permissions: {
        canApproveBids: invite.role === "admin" || invite.role === "project_manager",
        canReleaseFunds: invite.role === "admin" || invite.role === "accountant",
        canViewReports: true,
        canManageTeam: invite.role === "admin",
        canCreateProjects: invite.role !== "accountant",
      },
    };

    setMembers((prev) => [...prev, newMember]);
    setInviteVisible(false);

    Alert.alert(
      "Invitation Sent ✉️",
      `${invite.email} has been invited as ${config.icon} ${config.label}.`
    );
  }, []);

  // Role summary
  const roleCounts = members.reduce(
    (acc, m) => {
      acc[m.role] = (acc[m.role] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>🏢 Organization</Text>
          <Text style={styles.subtitle}>
            {members.length} members •{" "}
            {members.filter((m) => m.isOnline).length} online
          </Text>
        </View>
        <TouchableOpacity
          style={styles.inviteBtn}
          onPress={() => setInviteVisible(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.inviteBtnText}>+ Invite Member</Text>
        </TouchableOpacity>
      </View>

      {/* Role Summary Bar */}
      <View style={styles.roleSummary}>
        {AVAILABLE_ROLES.map((role) => {
          const config = ROLE_CONFIG[role];
          const count = roleCounts[role] || 0;
          if (count === 0) return null;
          return (
            <View key={role} style={[styles.roleSummaryItem, { backgroundColor: config.bg }]}>
              <Text style={styles.roleSummaryIcon}>{config.icon}</Text>
              <Text style={[styles.roleSummaryCount, { color: config.color }]}>
                {count}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Member List */}
      {members.map((member) => (
        <MemberCard key={member.id} member={member} onRemove={handleRemove} />
      ))}

      {/* Invite Modal */}
      <InviteModal
        visible={inviteVisible}
        onClose={() => setInviteVisible(false)}
        onInvite={handleInvite}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginBottom: 32 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  title: { fontSize: 20, fontWeight: "800", color: "#FFFFFF" },
  subtitle: { fontSize: 13, color: "#5A6A7E", marginTop: 4 },
  inviteBtn: {
    backgroundColor: "#0A84FF",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  inviteBtnText: { fontSize: 13, color: "#FFFFFF", fontWeight: "700" },
  roleSummary: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  roleSummaryItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 4,
  },
  roleSummaryIcon: { fontSize: 14 },
  roleSummaryCount: { fontSize: 14, fontWeight: "800" },
});

export default TeamManager;