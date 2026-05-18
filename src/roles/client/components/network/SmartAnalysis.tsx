// src/components/client/network/SmartAnalysis.tsx
import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Image,
  ScrollView,
  Dimensions,
} from "react-native";
import type {
  InspectorProfile,
  MatchAnalysis,
  Certification,
  EquipmentCalibration,
} from "@/src/types/network";

// ──────────────────────────────────────────────
// Seed Data
// ──────────────────────────────────────────────

const SEED_INSPECTORS: InspectorProfile[] = [
  {
    id: "insp-001",
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
    specializations: ["Tank Inspection", "Hull Survey", "Underwater NDT"],
    certifications: [
      {
        id: "cert-1",
        code: "API-653",
        label: "Tank Inspection",
        issuedBy: "American Petroleum Institute",
        expiresAt: "2027-03-15",
        verified: true,
      },
      {
        id: "cert-2",
        code: "AWS-CWI",
        label: "Certified Welding Inspector",
        issuedBy: "American Welding Society",
        expiresAt: "2026-11-01",
        verified: true,
      },
      {
        id: "cert-3",
        code: "NACE-CIP2",
        label: "Coating Inspector Level 2",
        issuedBy: "AMPP / NACE International",
        expiresAt: "2026-08-22",
        verified: true,
      },
    ],
    equipment: [
      {
        id: "eq-1",
        instrument: "UT Thickness Gauge — Olympus 38DL Plus",
        lastCalibrated: "2025-05-10",
        nextDue: "2025-11-10",
        status: "current",
      },
      {
        id: "eq-2",
        instrument: "Phased Array — Zetec TOPAZ 64",
        lastCalibrated: "2025-04-20",
        nextDue: "2025-10-20",
        status: "current",
      },
    ],
    availableFrom: "2025-07-01",
    isPreferred: true,
    inviteOnly: false,
  },
  {
    id: "insp-002",
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
    specializations: ["Subsea Pipeline", "Riser Inspection", "ROV Operations"],
    certifications: [
      {
        id: "cert-4",
        code: "CSWIP-3.4U",
        label: "Underwater Inspection Controller",
        issuedBy: "TWI Certification Ltd.",
        expiresAt: "2026-06-30",
        verified: true,
      },
      {
        id: "cert-5",
        code: "DNV-GL",
        label: "Marine Surveyor",
        issuedBy: "DNV",
        expiresAt: "2027-01-15",
        verified: true,
      },
    ],
    equipment: [
      {
        id: "eq-3",
        instrument: "ROV Sonar — BlueRobotics Navigator",
        lastCalibrated: "2025-03-01",
        nextDue: "2025-09-01",
        status: "current",
      },
      {
        id: "eq-4",
        instrument: "Cathodic Protection Tester",
        lastCalibrated: "2024-12-10",
        nextDue: "2025-06-10",
        status: "expiring_soon",
      },
    ],
    availableFrom: "2025-07-15",
    isPreferred: false,
    inviteOnly: false,
  },
  {
    id: "insp-003",
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
    specializations: ["FPSO Inspection", "Structural Integrity", "Risk-Based Inspection"],
    certifications: [
      {
        id: "cert-6",
        code: "PCN-Level3",
        label: "NDT Level 3 — All Methods",
        issuedBy: "PCN / BINDT",
        expiresAt: "2028-02-28",
        verified: true,
      },
      {
        id: "cert-7",
        code: "API-510",
        label: "Pressure Vessel Inspector",
        issuedBy: "American Petroleum Institute",
        expiresAt: "2027-05-01",
        verified: true,
      },
      {
        id: "cert-8",
        code: "ISO-9712",
        label: "NDT Personnel Qualification",
        issuedBy: "ISO / Bureau Veritas",
        expiresAt: "2027-09-30",
        verified: true,
      },
    ],
    equipment: [
      {
        id: "eq-5",
        instrument: "TOFD System — Sonatest Veo+",
        lastCalibrated: "2025-06-01",
        nextDue: "2025-12-01",
        status: "current",
      },
      {
        id: "eq-6",
        instrument: "3D Laser Scanner — FARO Focus",
        lastCalibrated: "2025-05-15",
        nextDue: "2025-11-15",
        status: "current",
      },
      {
        id: "eq-7",
        instrument: "MFL Pipeline Scanner — Rosen",
        lastCalibrated: "2025-04-01",
        nextDue: "2025-10-01",
        status: "current",
      },
    ],
    availableFrom: "2025-08-01",
    isPreferred: true,
    inviteOnly: true,
  },
];

const JOB_TYPE = "Tank Inspection — API-653";

// ──────────────────────────────────────────────
// Analysis Engine
// ──────────────────────────────────────────────

const MAX_DAILY_RATE = 2000;
const BENCHMARK_COMPLETION_DAYS = 5;

function computeAnalysis(inspector: InspectorProfile): MatchAnalysis {
  // Cost Efficiency: inverse of rate against max
  const costEfficiency = Math.round(
    ((MAX_DAILY_RATE - inspector.dailyRate) / MAX_DAILY_RATE) * 100
  );

  // Quality: weighted blend of star rating + findings accuracy
  const ratingNorm = (inspector.starRating / 5) * 100;
  const accuracyNorm = inspector.findingsAccuracy * 100;
  const qualityScore = Math.round(ratingNorm * 0.4 + accuracyNorm * 0.6);

  // Speed: inverse of avg completion vs benchmark
  const speedRatio = Math.min(
    1,
    BENCHMARK_COMPLETION_DAYS / inspector.avgCompletionDays
  );
  const speedScore = Math.round(speedRatio * 100);

  // Equipment calibration penalty
  const calibrationPenalty = inspector.equipment.reduce((penalty, eq) => {
    if (eq.status === "expired") return penalty + 15;
    if (eq.status === "expiring_soon") return penalty + 5;
    return penalty;
  }, 0);

  // Weighted match score
  const rawMatch =
    costEfficiency * 0.25 + qualityScore * 0.45 + speedScore * 0.3;
  const matchScore = Math.max(0, Math.min(100, Math.round(rawMatch - calibrationPenalty)));

  let recommendation: MatchAnalysis["recommendation"];
  if (matchScore >= 90) recommendation = "top_choice";
  else if (matchScore >= 80) recommendation = "strong_match";
  else if (matchScore >= 65) recommendation = "good_fit";
  else recommendation = "review_needed";

  const reasons: string[] = [];
  if (qualityScore >= 90) reasons.push("Exceptional quality track record");
  if (costEfficiency >= 50) reasons.push("Competitive pricing");
  if (speedScore >= 85) reasons.push("Fast turnaround history");
  if (calibrationPenalty === 0) reasons.push("All equipment fully calibrated");
  if (inspector.certifications.some((c) => c.code === "API-653"))
    reasons.push("Holds required API-653 certification");
  if (inspector.completedJobs > 300)
    reasons.push(`${inspector.completedJobs} jobs completed`);

  return {
    inspectorId: inspector.id,
    jobType: JOB_TYPE,
    costEfficiency,
    qualityScore,
    speedScore,
    matchScore,
    recommendation,
    reasons,
  };
}

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

const AnimatedBar: React.FC<{
  label: string;
  value: number;
  color: string;
  icon: string;
  delay: number;
}> = ({ label, value, color, icon, delay }) => {
  const widthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: value,
      duration: 800,
      delay,
      useNativeDriver: false,
    }).start();
  }, [value, delay]);

  const widthInterp = widthAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={barStyles.container}>
      <View style={barStyles.labelRow}>
        <Text style={barStyles.icon}>{icon}</Text>
        <Text style={barStyles.label}>{label}</Text>
        <Text style={[barStyles.value, { color }]}>{value}%</Text>
      </View>
      <View style={barStyles.track}>
        <Animated.View
          style={[barStyles.fill, { width: widthInterp, backgroundColor: color }]}
        />
      </View>
    </View>
  );
};

const barStyles = StyleSheet.create({
  container: { marginBottom: 14 },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  icon: { fontSize: 14, marginRight: 6 },
  label: { flex: 1, fontSize: 13, color: "#C8D2DD", fontWeight: "600" },
  value: { fontSize: 14, fontWeight: "700" },
  track: {
    height: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 4,
    overflow: "hidden",
  },
  fill: {
    height: 8,
    borderRadius: 4,
  },
});

const RecommendationBadge: React.FC<{
  recommendation: MatchAnalysis["recommendation"];
}> = ({ recommendation }) => {
  const config: Record<
    MatchAnalysis["recommendation"],
    { label: string; icon: string; bg: string; text: string }
  > = {
    top_choice: {
      label: "Top Choice",
      icon: "🏆",
      bg: "rgba(255,214,10,0.15)",
      text: "#FFD60A",
    },
    strong_match: {
      label: "Strong Match",
      icon: "⭐",
      bg: "rgba(48,209,88,0.15)",
      text: "#30D158",
    },
    good_fit: {
      label: "Good Fit",
      icon: "👍",
      bg: "rgba(10,132,255,0.15)",
      text: "#0A84FF",
    },
    review_needed: {
      label: "Needs Review",
      icon: "🔍",
      bg: "rgba(255,159,10,0.15)",
      text: "#FF9F0A",
    },
  };

  const c = config[recommendation];

  return (
    <View style={[recStyles.badge, { backgroundColor: c.bg }]}>
      <Text style={recStyles.icon}>{c.icon}</Text>
      <Text style={[recStyles.text, { color: c.text }]}>{c.label}</Text>
    </View>
  );
};

const recStyles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: "flex-start",
    gap: 5,
  },
  icon: { fontSize: 14 },
  text: { fontSize: 12, fontWeight: "800" },
});

const CertBadge: React.FC<{ cert: Certification }> = ({ cert }) => (
  <View style={certStyles.badge}>
    <View style={certStyles.dot} />
    <Text style={certStyles.code}>{cert.code}</Text>
    {cert.verified && <Text style={certStyles.verified}>✓</Text>}
  </View>
);

const certStyles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(10,132,255,0.1)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#0A84FF",
  },
  code: { fontSize: 11, color: "#0A84FF", fontWeight: "700" },
  verified: { fontSize: 10, color: "#30D158", fontWeight: "800" },
});

const CalibrationRow: React.FC<{ eq: EquipmentCalibration }> = ({ eq }) => {
  const statusColors: Record<EquipmentCalibration["status"], string> = {
    current: "#30D158",
    expiring_soon: "#FFD60A",
    expired: "#FF3B30",
  };
  const statusLabels: Record<EquipmentCalibration["status"], string> = {
    current: "Calibrated",
    expiring_soon: "Expiring Soon",
    expired: "Expired",
  };

  return (
    <View style={eqStyles.row}>
      <View style={eqStyles.info}>
        <Text style={eqStyles.name} numberOfLines={1}>{eq.instrument}</Text>
        <Text style={eqStyles.date}>
          Next cal: {new Date(eq.nextDue).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </Text>
      </View>
      <View
        style={[
          eqStyles.statusBadge,
          { backgroundColor: `${statusColors[eq.status]}20` },
        ]}
      >
        <View
          style={[eqStyles.statusDot, { backgroundColor: statusColors[eq.status] }]}
        />
        <Text style={[eqStyles.statusText, { color: statusColors[eq.status] }]}>
          {statusLabels[eq.status]}
        </Text>
      </View>
    </View>
  );
};

const eqStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  info: { flex: 1, marginRight: 12 },
  name: { fontSize: 13, color: "#C8D2DD", fontWeight: "600" },
  date: { fontSize: 11, color: "#5A6A7E", marginTop: 2 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: "700" },
});

// ──────────────────────────────────────────────
// Inspector Analysis Card
// ──────────────────────────────────────────────

const InspectorAnalysisCard: React.FC<{
  inspector: InspectorProfile;
  analysis: MatchAnalysis;
  expanded: boolean;
  onToggle: () => void;
}> = ({ inspector, analysis, expanded, onToggle }) => {
  const rotateAnim = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(rotateAnim, {
      toValue: expanded ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [expanded]);

  const chevronRotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  return (
    <View style={cardStyles.card}>
      {/* Header: always visible */}
      <TouchableOpacity
        style={cardStyles.header}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        <Image source={{ uri: inspector.avatarUri }} style={cardStyles.avatar} />
        <View style={cardStyles.headerInfo}>
          <Text style={cardStyles.name}>{inspector.name}</Text>
          <Text style={cardStyles.company}>{inspector.company}</Text>
          <Text style={cardStyles.location}>📍 {inspector.location}</Text>
        </View>
        <View style={cardStyles.headerRight}>
          <View style={cardStyles.matchCircle}>
            <Text style={cardStyles.matchValue}>{analysis.matchScore}</Text>
            <Text style={cardStyles.matchPercent}>%</Text>
          </View>
          <Animated.Text
            style={[
              cardStyles.chevron,
              { transform: [{ rotate: chevronRotation }] },
            ]}
          >
            ▼
          </Animated.Text>
        </View>
      </TouchableOpacity>

      <RecommendationBadge recommendation={analysis.recommendation} />

      {/* Expanded Details */}
      {expanded && (
        <View style={cardStyles.expandedSection}>
          {/* Match Score Bars */}
          <View style={cardStyles.section}>
            <Text style={cardStyles.sectionLabel}>📊 Performance Analysis</Text>
            <Text style={cardStyles.jobContext}>For: {analysis.jobType}</Text>
            <View style={cardStyles.barsContainer}>
              <AnimatedBar
                label="Cost Efficiency"
                value={analysis.costEfficiency}
                color="#30D158"
                icon="💰"
                delay={0}
              />
              <AnimatedBar
                label="Quality Score"
                value={analysis.qualityScore}
                color="#0A84FF"
                icon="⭐"
                delay={150}
              />
              <AnimatedBar
                label="Speed & Availability"
                value={analysis.speedScore}
                color="#BF5AF2"
                icon="⚡"
                delay={300}
              />
            </View>
          </View>

          {/* Key Stats */}
          <View style={cardStyles.statsGrid}>
            <View style={cardStyles.statBox}>
              <Text style={cardStyles.statValue}>${inspector.dailyRate}</Text>
              <Text style={cardStyles.statLabel}>Day Rate</Text>
            </View>
            <View style={cardStyles.statBox}>
              <Text style={cardStyles.statValue}>
                {inspector.starRating}
                <Text style={cardStyles.statUnit}>/5</Text>
              </Text>
              <Text style={cardStyles.statLabel}>
                {inspector.totalReviews} reviews
              </Text>
            </View>
            <View style={cardStyles.statBox}>
              <Text style={cardStyles.statValue}>
                {inspector.avgCompletionDays}d
              </Text>
              <Text style={cardStyles.statLabel}>Avg. completion</Text>
            </View>
            <View style={cardStyles.statBox}>
              <Text style={cardStyles.statValue}>
                {(inspector.findingsAccuracy * 100).toFixed(0)}%
              </Text>
              <Text style={cardStyles.statLabel}>Accuracy</Text>
            </View>
          </View>

          {/* Certifications */}
          <View style={cardStyles.section}>
            <Text style={cardStyles.sectionLabel}>📜 Certifications</Text>
            <View style={cardStyles.certRow}>
              {inspector.certifications.map((cert) => (
                <CertBadge key={cert.id} cert={cert} />
              ))}
            </View>
          </View>

          {/* Equipment Calibration */}
          <View style={cardStyles.section}>
            <Text style={cardStyles.sectionLabel}>🔧 Equipment Status</Text>
            {inspector.equipment.map((eq) => (
              <CalibrationRow key={eq.id} eq={eq} />
            ))}
          </View>

          {/* AI Reasons */}
          <View style={cardStyles.section}>
            <Text style={cardStyles.sectionLabel}>🧠 Why This Match</Text>
            {analysis.reasons.map((reason, idx) => (
              <View key={idx} style={cardStyles.reasonRow}>
                <Text style={cardStyles.reasonBullet}>✦</Text>
                <Text style={cardStyles.reasonText}>{reason}</Text>
              </View>
            ))}
          </View>

          {/* Actions */}
          <View style={cardStyles.actionRow}>
            <TouchableOpacity style={cardStyles.actionBtnPrimary} activeOpacity={0.8}>
              <Text style={cardStyles.actionBtnPrimaryText}>
                Request Quote
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={cardStyles.actionBtnSecondary} activeOpacity={0.8}>
              <Text style={cardStyles.actionBtnSecondaryText}>
                View Full Profile
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: "#0F172A",
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.04)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: "rgba(10,132,255,0.3)",
    marginRight: 12,
  },
  headerInfo: { flex: 1 },
  name: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  company: { fontSize: 12, color: "#8896AB", marginTop: 2 },
  location: { fontSize: 11, color: "#5A6A7E", marginTop: 2 },
  headerRight: { alignItems: "center", gap: 6 },
  matchCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 3,
    borderColor: "#0A84FF",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,132,255,0.08)",
    flexDirection: "row",
  },
  matchValue: { fontSize: 18, fontWeight: "800", color: "#0A84FF" },
  matchPercent: { fontSize: 10, fontWeight: "700", color: "#0A84FF", marginTop: 2 },
  chevron: { fontSize: 10, color: "#5A6A7E" },

  // Expanded
  expandedSection: { marginTop: 16 },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#C8D2DD",
    marginBottom: 10,
  },
  jobContext: {
    fontSize: 12,
    color: "#5A6A7E",
    marginBottom: 12,
    fontStyle: "italic",
  },
  barsContainer: { marginTop: 4 },

  // Stats Grid
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
  },
  statBox: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  statValue: { fontSize: 18, fontWeight: "800", color: "#FFFFFF" },
  statUnit: { fontSize: 12, fontWeight: "600", color: "#5A6A7E" },
  statLabel: { fontSize: 11, color: "#5A6A7E", marginTop: 4, textAlign: "center" },

  // Certs
  certRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },

  // Reasons
  reasonRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 6,
    paddingLeft: 4,
  },
  reasonBullet: { color: "#30D158", fontSize: 12, marginRight: 8, marginTop: 1 },
  reasonText: { flex: 1, fontSize: 13, color: "#C8D2DD", lineHeight: 18 },

  // Actions
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  actionBtnPrimary: {
    flex: 1,
    backgroundColor: "#0A84FF",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  actionBtnPrimaryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  actionBtnSecondary: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  actionBtnSecondaryText: { color: "#8896AB", fontSize: 14, fontWeight: "600" },
});

// ──────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────

const SmartAnalysis: React.FC = () => {
  const [expandedId, setExpandedId] = useState<string | null>(
    SEED_INSPECTORS[0].id
  );

  const analyses = SEED_INSPECTORS.map((insp) => ({
    inspector: insp,
    analysis: computeAnalysis(insp),
  }));

  // Sort by match score descending
  analyses.sort((a, b) => b.analysis.matchScore - a.analysis.matchScore);

  const handleToggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>🧠 Smart Bidding Analysis</Text>
          <Text style={styles.subtitle}>
            AI-powered matching for {JOB_TYPE}
          </Text>
        </View>
      </View>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#30D158" }]} />
          <Text style={styles.legendText}>Cost</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#0A84FF" }]} />
          <Text style={styles.legendText}>Quality</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#BF5AF2" }]} />
          <Text style={styles.legendText}>Speed</Text>
        </View>
      </View>

      {analyses.map(({ inspector, analysis }) => (
        <InspectorAnalysisCard
          key={inspector.id}
          inspector={inspector}
          analysis={analysis}
          expanded={expandedId === inspector.id}
          onToggle={() => handleToggle(inspector.id)}
        />
      ))}
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
  legendRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 16,
    paddingLeft: 4,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: "#5A6A7E", fontWeight: "600" },
});

export default SmartAnalysis;