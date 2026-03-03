// src/components/client/network/PreferredNetwork.tsx
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Switch,
  FlatList,
  Dimensions,
  Alert,
  Platform,
} from "react-native";
import type { InspectorProfile } from "../../../types/network";

// ──────────────────────────────────────────────
// Seed Data
// ──────────────────────────────────────────────

const SEED_PREFERRED: InspectorProfile[] = [
  {
    id: "pref-001",
    name: "Capt. Elena Vasquez",
    avatarUri: "https://i.pravatar.cc/150?img=47",
    company: "Maritime Integrity Solutions",
    location: "Houston, TX",
    dailyRate: 1200,
    starRating: 4.9,
    totalReviews: 127,
    completedJobs: 342,
    avgCompletionDays: 3.2,
    findingsAccuracy: 0.96,
    specializations: ["Tank Inspection", "Hull Survey"],
    certifications: [
      {
        id: "c1",
        code: "API-653",
        label: "Tank Inspection",
        issuedBy: "API",
        expiresAt: "2027-03-15",
        verified: true,
      },
      {
        id: "c2",
        code: "AWS-CWI",
        label: "Welding Inspector",
        issuedBy: "AWS",
        expiresAt: "2026-11-01",
        verified: true,
      },
    ],
    equipment: [],
    availableFrom: "2025-07-01",
    isPreferred: true,
    inviteOnly: true,
  },
  {
    id: "pref-002",
    name: "Ingrid Solberg",
    avatarUri: "https://i.pravatar.cc/150?img=44",
    company: "Nordic Integrity AS",
    location: "Stavanger, Norway",
    dailyRate: 1450,
    starRating: 4.95,
    totalReviews: 203,
    completedJobs: 478,
    avgCompletionDays: 2.8,
    findingsAccuracy: 0.98,
    specializations: ["FPSO Inspection", "RBI"],
    certifications: [
      {
        id: "c3",
        code: "PCN-L3",
        label: "NDT Level 3",
        issuedBy: "BINDT",
        expiresAt: "2028-02-28",
        verified: true,
      },
    ],
    equipment: [],
    availableFrom: "2025-08-01",
    isPreferred: true,
    inviteOnly: true,
  },
  {
    id: "pref-003",
    name: "Dr. James Okonkwo",
    avatarUri: "https://i.pravatar.cc/150?img=68",
    company: "Subsea Diagnostics Ltd.",
    location: "Lagos, Nigeria",
    dailyRate: 950,
    starRating: 4.7,
    totalReviews: 89,
    completedJobs: 215,
    avgCompletionDays: 4.1,
    findingsAccuracy: 0.91,
    specializations: ["Subsea Pipeline", "ROV Ops"],
    certifications: [
      {
        id: "c4",
        code: "CSWIP-3.4U",
        label: "Underwater Controller",
        issuedBy: "TWI",
        expiresAt: "2026-06-30",
        verified: true,
      },
    ],
    equipment: [],
    availableFrom: "2025-07-15",
    isPreferred: true,
    inviteOnly: false,
  },
  {
    id: "pref-004",
    name: "Marco Bellini",
    avatarUri: "https://i.pravatar.cc/150?img=59",
    company: "Adriatic Survey Group",
    location: "Trieste, Italy",
    dailyRate: 1100,
    starRating: 4.6,
    totalReviews: 64,
    completedJobs: 178,
    avgCompletionDays: 3.9,
    findingsAccuracy: 0.89,
    specializations: ["Yacht Survey", "Class Renewal"],
    certifications: [
      {
        id: "c5",
        code: "RINA",
        label: "RINA Class Surveyor",
        issuedBy: "RINA",
        expiresAt: "2027-01-01",
        verified: true,
      },
    ],
    equipment: [],
    availableFrom: "2025-07-10",
    isPreferred: true,
    inviteOnly: false,
  },
  {
    id: "pref-005",
    name: "Aisha Patel",
    avatarUri: "https://i.pravatar.cc/150?img=45",
    company: "IndoMaritime Consultants",
    location: "Mumbai, India",
    dailyRate: 800,
    starRating: 4.8,
    totalReviews: 156,
    completedJobs: 290,
    avgCompletionDays: 3.5,
    findingsAccuracy: 0.93,
    specializations: ["Cargo Hold", "Ballast Tank"],
    certifications: [
      {
        id: "c6",
        code: "IRS",
        label: "IRS Class Surveyor",
        issuedBy: "Indian Register of Shipping",
        expiresAt: "2026-09-15",
        verified: true,
      },
    ],
    equipment: [],
    availableFrom: "2025-07-05",
    isPreferred: true,
    inviteOnly: true,
  },
];

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = SCREEN_WIDTH * 0.72;

// ──────────────────────────────────────────────
// Inspector Card
// ──────────────────────────────────────────────

const InspectorCard: React.FC<{
  inspector: InspectorProfile;
  isSaved: boolean;
  onToggleSave: (id: string) => void;
  onToggleInvite: (id: string, value: boolean) => void;
}> = ({ inspector, isSaved, onToggleSave, onToggleInvite }) => {
  return (
    <View style={cardStyles.card}>
      {/* Top Row */}
      <View style={cardStyles.topRow}>
        <Image
          source={{ uri: inspector.avatarUri }}
          style={cardStyles.avatar}
        />
        <TouchableOpacity
          style={[cardStyles.heartBtn, isSaved && cardStyles.heartBtnActive]}
          onPress={() => onToggleSave(inspector.id)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={cardStyles.heartIcon}>{isSaved ? "❤️" : "🤍"}</Text>
        </TouchableOpacity>
      </View>

      {/* Info */}
      <Text style={cardStyles.name}>{inspector.name}</Text>
      <Text style={cardStyles.company}>{inspector.company}</Text>
      <Text style={cardStyles.location}>📍 {inspector.location}</Text>

      {/* Rating */}
      <View style={cardStyles.ratingRow}>
        <Text style={cardStyles.star}>⭐</Text>
        <Text style={cardStyles.ratingValue}>{inspector.starRating}</Text>
        <Text style={cardStyles.ratingCount}>
          ({inspector.totalReviews})
        </Text>
        <View style={cardStyles.ratingDivider} />
        <Text style={cardStyles.jobCount}>
          {inspector.completedJobs} jobs
        </Text>
      </View>

      {/* Cert Badges */}
      <View style={cardStyles.certRow}>
        {inspector.certifications.slice(0, 2).map((cert) => (
          <View key={cert.id} style={cardStyles.certBadge}>
            <Text style={cardStyles.certText}>{cert.code}</Text>
            {cert.verified && <Text style={cardStyles.certVerified}>✓</Text>}
          </View>
        ))}
      </View>

      {/* Specializations */}
      <View style={cardStyles.specRow}>
        {inspector.specializations.slice(0, 2).map((spec, idx) => (
          <View key={idx} style={cardStyles.specBadge}>
            <Text style={cardStyles.specText}>{spec}</Text>
          </View>
        ))}
      </View>

      {/* Invite-Only Toggle */}
      <View style={cardStyles.inviteRow}>
        <View style={cardStyles.inviteInfo}>
          <Text style={cardStyles.inviteLabel}>Invite-Only Tenders</Text>
          <Text style={cardStyles.inviteDesc}>
            Private bids only
          </Text>
        </View>
        <Switch
          value={inspector.inviteOnly}
          onValueChange={(value) => onToggleInvite(inspector.id, value)}
          trackColor={{
            false: "rgba(255,255,255,0.08)",
            true: "rgba(10,132,255,0.4)",
          }}
          thumbColor={inspector.inviteOnly ? "#0A84FF" : "#5A6A7E"}
          ios_backgroundColor="rgba(255,255,255,0.08)"
        />
      </View>

      {/* Rate & Availability */}
      <View style={cardStyles.footerRow}>
        <View>
          <Text style={cardStyles.rateLabel}>Day Rate</Text>
          <Text style={cardStyles.rateValue}>${inspector.dailyRate}</Text>
        </View>
        <View style={cardStyles.footerDivider} />
        <View>
          <Text style={cardStyles.rateLabel}>Available</Text>
          <Text style={cardStyles.availValue}>
            {new Date(inspector.availableFrom).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </Text>
        </View>
      </View>
    </View>
  );
};

const cardStyles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    backgroundColor: "#0F172A",
    borderRadius: 16,
    padding: 18,
    marginRight: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: "rgba(10,132,255,0.3)",
  },
  heartBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  heartBtnActive: {
    backgroundColor: "rgba(255,59,48,0.12)",
  },
  heartIcon: { fontSize: 18 },
  name: { fontSize: 17, fontWeight: "700", color: "#FFFFFF" },
  company: { fontSize: 12, color: "#8896AB", marginTop: 2 },
  location: { fontSize: 11, color: "#5A6A7E", marginTop: 3, marginBottom: 10 },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  star: { fontSize: 13, marginRight: 4 },
  ratingValue: { fontSize: 14, fontWeight: "700", color: "#FFD60A" },
  ratingCount: { fontSize: 12, color: "#5A6A7E", marginLeft: 3 },
  ratingDivider: {
    width: 1,
    height: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginHorizontal: 8,
  },
  jobCount: { fontSize: 12, color: "#8896AB", fontWeight: "600" },
  certRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 8,
  },
  certBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(10,132,255,0.1)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  certText: { fontSize: 11, color: "#0A84FF", fontWeight: "700" },
  certVerified: { fontSize: 9, color: "#30D158", fontWeight: "800" },
  specRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 14,
  },
  specBadge: {
    backgroundColor: "rgba(191,90,242,0.1)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  specText: { fontSize: 10, color: "#BF5AF2", fontWeight: "700" },
  inviteRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  inviteInfo: { flex: 1, marginRight: 12 },
  inviteLabel: { fontSize: 13, fontWeight: "600", color: "#C8D2DD" },
  inviteDesc: { fontSize: 11, color: "#5A6A7E", marginTop: 2 },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  footerDivider: {
    width: 1,
    height: 30,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  rateLabel: { fontSize: 10, color: "#5A6A7E", fontWeight: "600" },
  rateValue: { fontSize: 16, fontWeight: "800", color: "#30D158", marginTop: 2 },
  availValue: { fontSize: 14, fontWeight: "700", color: "#0A84FF", marginTop: 2 },
});

// ──────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────

const PreferredNetwork: React.FC = () => {
  const [inspectors, setInspectors] = useState<InspectorProfile[]>(SEED_PREFERRED);
  const [savedIds, setSavedIds] = useState<Set<string>>(
    new Set(["pref-001", "pref-002", "pref-005"])
  );

  const handleToggleSave = useCallback((id: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        Alert.alert("Removed", "Inspector removed from favorites.");
      } else {
        next.add(id);
        Alert.alert("Saved ❤️", "Inspector added to favorites.");
      }
      return next;
    });
  }, []);

  const handleToggleInvite = useCallback((id: string, value: boolean) => {
    setInspectors((prev) =>
      prev.map((insp) =>
        insp.id === id ? { ...insp, inviteOnly: value } : insp
      )
    );
    Alert.alert(
      value ? "Invite-Only Enabled 🔒" : "Invite-Only Disabled 🔓",
      value
        ? "This inspector will only receive your private tenders."
        : "This inspector can now see your public tenders."
    );
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>🤝 Preferred Network</Text>
          <Text style={styles.subtitle}>
            {inspectors.length} trusted inspectors •{" "}
            {savedIds.size} favorited
          </Text>
        </View>
        <TouchableOpacity style={styles.addBtn} activeOpacity={0.7}>
          <Text style={styles.addBtnText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={inspectors}
        renderItem={({ item }) => (
          <InspectorCard
            inspector={item}
            isSaved={savedIds.has(item.id)}
            onToggleSave={handleToggleSave}
            onToggleInvite={handleToggleInvite}
          />
        )}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        snapToInterval={CARD_WIDTH + 12}
        decelerationRate="fast"
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
    paddingRight: 4,
  },
  title: { fontSize: 20, fontWeight: "800", color: "#FFFFFF" },
  subtitle: { fontSize: 13, color: "#5A6A7E", marginTop: 4 },
  addBtn: {
    backgroundColor: "rgba(10,132,255,0.15)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addBtnText: { fontSize: 13, color: "#0A84FF", fontWeight: "700" },
  listContent: {
    paddingRight: 16,
  },
});

export default PreferredNetwork;