// app/client/network/index.tsx
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  StatusBar,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import SmartAnalysis from "../../../src/components/client/network/SmartAnalysis";
import PreferredNetwork from "../../../src/components/client/network/PreferredNetwork";
import TeamManager from "../../../src/components/client/network/TeamManager";

const NetworkIntelligenceScreen: React.FC = () => {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Gradient Header ── */}
        <LinearGradient
          colors={["#0A84FF", "#0055D4", "#020617"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.headerGradient}
        >
          <View style={styles.headerContent}>
            {/* Back Button */}
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => router.back()}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.backIcon}>‹</Text>
              <Text style={styles.backText}>Dashboard</Text>
            </TouchableOpacity>

            {/* Title Block */}
            <View style={styles.titleBlock}>
              <Text style={styles.screenIcon}>🌐</Text>
              <Text style={styles.screenTitle}>
                Network & Intelligence
              </Text>
              <Text style={styles.screenSubtitle}>
                Smart bidding, trusted inspectors, and team management
              </Text>
            </View>

            {/* Quick Stats */}
            <View style={styles.quickStats}>
              <View style={styles.quickStatCard}>
                <Text style={styles.quickStatValue}>3</Text>
                <Text style={styles.quickStatLabel}>Inspectors Analyzed</Text>
              </View>
              <View style={styles.quickStatDivider} />
              <View style={styles.quickStatCard}>
                <Text style={styles.quickStatValue}>5</Text>
                <Text style={styles.quickStatLabel}>In Network</Text>
              </View>
              <View style={styles.quickStatDivider} />
              <View style={styles.quickStatCard}>
                <Text style={styles.quickStatValue}>3</Text>
                <Text style={styles.quickStatLabel}>Team Members</Text>
              </View>
            </View>
          </View>
        </LinearGradient>

        {/* ── Content Body ── */}
        <View style={styles.body}>
          {/* Module 1: Smart Analysis */}
          <SmartAnalysis />

          {/* Module 2: Preferred Network */}
          <PreferredNetwork />

          {/* Module 3: Team Manager */}
          <TeamManager />

          {/* Footer Spacer */}
          <View style={styles.footerSpacer} />
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#020617",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },

  // Header
  headerGradient: {
    paddingTop: Platform.OS === "ios" ? 60 : 40,
    paddingBottom: 28,
    paddingHorizontal: 20,
  },
  headerContent: {},
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    alignSelf: "flex-start",
  },
  backIcon: {
    fontSize: 28,
    color: "rgba(255,255,255,0.8)",
    fontWeight: "300",
    marginRight: 4,
    marginTop: -2,
  },
  backText: {
    fontSize: 15,
    color: "rgba(255,255,255,0.8)",
    fontWeight: "500",
  },
  titleBlock: {
    marginBottom: 24,
  },
  screenIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },
  screenSubtitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.6)",
    marginTop: 6,
    lineHeight: 20,
  },

  // Quick Stats
  quickStats: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: 16,
    justifyContent: "space-around",
    alignItems: "center",
  },
  quickStatCard: {
    alignItems: "center",
    flex: 1,
  },
  quickStatValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  quickStatLabel: {
    fontSize: 10,
    color: "rgba(255,255,255,0.5)",
    marginTop: 4,
    textAlign: "center",
    fontWeight: "600",
  },
  quickStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: "rgba(255,255,255,0.12)",
  },

  // Body
  body: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },

  footerSpacer: {
    height: 60,
  },
});

export default NetworkIntelligenceScreen;