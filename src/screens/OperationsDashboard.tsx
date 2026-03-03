// src/screens/OperationsDashboard.tsx

import React, { useCallback, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  Animated,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DarkTheme } from "../theme/tokens";
import { useOperationsData } from "../hooks/useOperationsData";
import { useCriticalAlerts } from "../../hooks/useCriticalAlerts";
import type {
  ProjectSummary,
  UpcomingInspection,
  StatusBreakdown,
  RealtimeEvent,
} from "../hooks/useOperationsData";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";
import { RealtimeIndicator } from "../components/ui/RealtimeIndicator";

// ─── METRIC CARD ────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  accentColor?: string;
}

const MetricCard: React.FC<MetricCardProps> = React.memo(
  ({ label, value, subtitle, accentColor = DarkTheme.accentPrimary }) => (
    <View style={metricStyles.card}>
      <View
        style={[metricStyles.accent, { backgroundColor: accentColor }]}
      />
      <Text style={metricStyles.label}>{label}</Text>
      <Text style={[metricStyles.value, { color: accentColor }]}>
        {value}
      </Text>
      {subtitle && <Text style={metricStyles.subtitle}>{subtitle}</Text>}
    </View>
  )
);

const metricStyles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 150,
    backgroundColor: DarkTheme.surface,
    borderRadius: DarkTheme.radius.lg,
    padding: DarkTheme.spacing.lg,
    borderWidth: 1,
    borderColor: DarkTheme.border,
    overflow: "hidden",
  },
  accent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: DarkTheme.radius.lg,
    borderTopRightRadius: DarkTheme.radius.lg,
  },
  label: {
    fontSize: DarkTheme.font.sizes.xs,
    fontWeight: DarkTheme.font.weights.medium,
    color: DarkTheme.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: DarkTheme.spacing.xs,
  },
  value: {
    fontSize: DarkTheme.font.sizes.xxl,
    fontWeight: DarkTheme.font.weights.bold,
  },
  subtitle: {
    fontSize: DarkTheme.font.sizes.xs,
    color: DarkTheme.textMuted,
    marginTop: DarkTheme.spacing.xs,
  },
});

// ─── STATUS BAR ─────────────────────────────────────────────────────

const StatusBar: React.FC<{ breakdown: StatusBreakdown[] }> = React.memo(
  ({ breakdown }) => (
    <View style={statusBarStyles.container}>
      <Text style={statusBarStyles.title}>Project Status</Text>
      <View style={statusBarStyles.bar}>
        {breakdown
          .filter((s) => s.count > 0)
          .map((s) => (
            <View
              key={s.status}
              style={[
                statusBarStyles.segment,
                {
                  flex: s.percentage,
                  backgroundColor: s.color,
                },
              ]}
            />
          ))}
      </View>
      <View style={statusBarStyles.legend}>
        {breakdown
          .filter((s) => s.count > 0)
          .map((s) => (
            <View key={s.status} style={statusBarStyles.legendItem}>
              <View
                style={[
                  statusBarStyles.legendDot,
                  { backgroundColor: s.color },
                ]}
              />
              <Text style={statusBarStyles.legendLabel}>
                {s.status.replace("_", " ")}
              </Text>
              <Text style={statusBarStyles.legendCount}>{s.count}</Text>
            </View>
          ))}
      </View>
    </View>
  )
);

const statusBarStyles = StyleSheet.create({
  container: {
    backgroundColor: DarkTheme.surface,
    borderRadius: DarkTheme.radius.lg,
    padding: DarkTheme.spacing.lg,
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  title: {
    fontSize: DarkTheme.font.sizes.md,
    fontWeight: DarkTheme.font.weights.semibold,
    color: DarkTheme.textPrimary,
    marginBottom: DarkTheme.spacing.md,
  },
  bar: {
    flexDirection: "row",
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    gap: 2,
    marginBottom: DarkTheme.spacing.md,
  },
  segment: {
    flex: 1,
    borderRadius: 4,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: DarkTheme.spacing.md,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: DarkTheme.font.sizes.xs,
    color: DarkTheme.textSecondary,
    textTransform: "capitalize",
  },
  legendCount: {
    fontSize: DarkTheme.font.sizes.xs,
    fontWeight: DarkTheme.font.weights.semibold,
    color: DarkTheme.textMuted,
  },
});

// ─── PROJECT ROW ────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  critical: DarkTheme.accentDanger,
  high: DarkTheme.accentWarning,
  medium: DarkTheme.accentPrimary,
  low: DarkTheme.textMuted,
};

const BUDGET_HEALTH_COLORS: Record<string, string> = {
  healthy: DarkTheme.accentSuccess,
  warning: DarkTheme.accentWarning,
  critical: DarkTheme.accentDanger,
};

const ProjectRow: React.FC<{ project: ProjectSummary }> = React.memo(
  ({ project }) => (
    <Pressable
      style={({ pressed }) => [
        projectStyles.row,
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={projectStyles.header}>
        <View style={projectStyles.titleRow}>
          <View
            style={[
              projectStyles.priorityDot,
              { backgroundColor: PRIORITY_COLORS[project.priority] },
            ]}
          />
          <Text style={projectStyles.name} numberOfLines={1}>
            {project.name}
          </Text>
        </View>
        <View
          style={[
            projectStyles.statusBadge,
            {
              backgroundColor:
                project.status === "active"
                  ? DarkTheme.statusActiveBg
                  : project.status === "completed"
                    ? DarkTheme.statusSuccessBg
                    : DarkTheme.statusPendingBg,
            },
          ]}
        >
          <Text
            style={[
              projectStyles.statusText,
              {
                color:
                  project.status === "active"
                    ? DarkTheme.accentPrimary
                    : project.status === "completed"
                      ? DarkTheme.accentSuccess
                      : DarkTheme.textSecondary,
              },
            ]}
          >
            {project.status.replace("_", " ")}
          </Text>
        </View>
      </View>

      <Text style={projectStyles.client}>{project.clientName}</Text>

      {/* Progress bar */}
      <View style={projectStyles.progressContainer}>
        <View style={projectStyles.progressTrack}>
          <View
            style={[
              projectStyles.progressFill,
              {
                width: `${project.progress}%`,
                backgroundColor:
                  BUDGET_HEALTH_COLORS[project.budgetHealth],
              },
            ]}
          />
        </View>
        <Text style={projectStyles.progressText}>{project.progress}%</Text>
      </View>

      <View style={projectStyles.meta}>
        {project.openFindings > 0 && (
          <Text style={projectStyles.findings}>
            {project.openFindings} open finding
            {project.openFindings > 1 ? "s" : ""}
          </Text>
        )}
        {project.nextInspection && (
          <Text style={projectStyles.nextInspection}>
            Next: {project.nextInspection.toLocaleDateString()}
          </Text>
        )}
      </View>
    </Pressable>
  )
);

const projectStyles = StyleSheet.create({
  row: {
    backgroundColor: DarkTheme.surface,
    borderRadius: DarkTheme.radius.lg,
    padding: DarkTheme.spacing.lg,
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: DarkTheme.spacing.xs,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: DarkTheme.spacing.sm,
    flex: 1,
  },
  priorityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  name: {
    fontSize: DarkTheme.font.sizes.md,
    fontWeight: DarkTheme.font.weights.semibold,
    color: DarkTheme.textPrimary,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: DarkTheme.spacing.sm,
    paddingVertical: 2,
    borderRadius: DarkTheme.radius.full,
  },
  statusText: {
    fontSize: DarkTheme.font.sizes.xs,
    fontWeight: DarkTheme.font.weights.semibold,
    textTransform: "capitalize",
  },
  client: {
    fontSize: DarkTheme.font.sizes.sm,
    color: DarkTheme.textMuted,
    marginBottom: DarkTheme.spacing.md,
    marginLeft: 18,
  },
  progressContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: DarkTheme.spacing.sm,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: DarkTheme.surfaceElevated,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  progressText: {
    fontSize: DarkTheme.font.sizes.xs,
    fontWeight: DarkTheme.font.weights.semibold,
    color: DarkTheme.textSecondary,
    width: 36,
    textAlign: "right",
  },
  meta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: DarkTheme.spacing.sm,
  },
  findings: {
    fontSize: DarkTheme.font.sizes.xs,
    color: DarkTheme.accentWarning,
    fontWeight: DarkTheme.font.weights.medium,
  },
  nextInspection: {
    fontSize: DarkTheme.font.sizes.xs,
    color: DarkTheme.textMuted,
  },
});

// ─── INSPECTION ROW ─────────────────────────────────────────────────

const InspectionRow: React.FC<{ inspection: UpcomingInspection }> = React.memo(
  ({ inspection }) => {
    const isToday =
      inspection.scheduledAt.toDateString() === new Date().toDateString();

    return (
      <View style={inspectionStyles.row}>
        <View style={inspectionStyles.timeColumn}>
          <Text
            style={[
              inspectionStyles.time,
              isToday && { color: DarkTheme.accentPrimary },
            ]}
          >
            {inspection.scheduledAt.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
          <Text style={inspectionStyles.date}>
            {isToday
              ? "Today"
              : inspection.scheduledAt.toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                })}
          </Text>
        </View>

        <View style={inspectionStyles.divider}>
          <View
            style={[
              inspectionStyles.dot,
              {
                backgroundColor:
                  PRIORITY_COLORS[inspection.priority] ??
                  DarkTheme.textMuted,
              },
            ]}
          />
          <View style={inspectionStyles.line} />
        </View>

        <View style={inspectionStyles.content}>
          <Text style={inspectionStyles.title} numberOfLines={1}>
            {inspection.title}
          </Text>
          <Text style={inspectionStyles.project} numberOfLines={1}>
            {inspection.projectName}
          </Text>
          <View style={inspectionStyles.metaRow}>
            <Text style={inspectionStyles.inspector}>
              👷 {inspection.inspectorName}
            </Text>
            <Text style={inspectionStyles.location}>
              📍 {inspection.location}
            </Text>
          </View>
        </View>
      </View>
    );
  }
);

const inspectionStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: DarkTheme.spacing.md,
  },
  timeColumn: {
    width: 52,
    alignItems: "flex-end",
    paddingTop: 2,
  },
  time: {
    fontSize: DarkTheme.font.sizes.sm,
    fontWeight: DarkTheme.font.weights.semibold,
    color: DarkTheme.textSecondary,
  },
  date: {
    fontSize: DarkTheme.font.sizes.xs,
    color: DarkTheme.textMuted,
  },
  divider: {
    alignItems: "center",
    width: 20,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
  },
  line: {
    width: 2,
    flex: 1,
    backgroundColor: DarkTheme.border,
    marginTop: 4,
  },
  content: {
    flex: 1,
    backgroundColor: DarkTheme.surface,
    borderRadius: DarkTheme.radius.md,
    padding: DarkTheme.spacing.md,
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  title: {
    fontSize: DarkTheme.font.sizes.md,
    fontWeight: DarkTheme.font.weights.semibold,
    color: DarkTheme.textPrimary,
    marginBottom: 2,
  },
  project: {
    fontSize: DarkTheme.font.sizes.sm,
    color: DarkTheme.accentPrimary,
    marginBottom: DarkTheme.spacing.sm,
  },
  metaRow: {
    flexDirection: "row",
    gap: DarkTheme.spacing.md,
  },
  inspector: {
    fontSize: DarkTheme.font.sizes.xs,
    color: DarkTheme.textMuted,
  },
  location: {
    fontSize: DarkTheme.font.sizes.xs,
    color: DarkTheme.textMuted,
  },
});

// ─── REALTIME ACTIVITY FEED ─────────────────────────────────────────

const EVENT_ICONS: Record<RealtimeEvent["type"], string> = {
  project_update: "🔄",
  new_inspection: "🔍",
  inspection_complete: "✅",
};

const ActivityFeed: React.FC<{ events: RealtimeEvent[] }> = React.memo(
  ({ events }) => {
    if (events.length === 0) return null;

    return (
      <View style={feedStyles.container}>
        <Text style={feedStyles.title}>Live Activity</Text>
        {events.slice(0, 5).map((event) => (
          <View key={event.id} style={feedStyles.item}>
            <Text style={feedStyles.icon}>
              {EVENT_ICONS[event.type]}
            </Text>
            <View style={feedStyles.content}>
              <Text style={feedStyles.message}>{event.message}</Text>
              <Text style={feedStyles.time}>
                {event.timestamp.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </Text>
            </View>
          </View>
        ))}
      </View>
    );
  }
);

const feedStyles = StyleSheet.create({
  container: {
    backgroundColor: DarkTheme.surface,
    borderRadius: DarkTheme.radius.lg,
    padding: DarkTheme.spacing.lg,
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  title: {
    fontSize: DarkTheme.font.sizes.md,
    fontWeight: DarkTheme.font.weights.semibold,
    color: DarkTheme.textPrimary,
    marginBottom: DarkTheme.spacing.md,
  },
  item: {
    flexDirection: "row",
    gap: DarkTheme.spacing.sm,
    paddingVertical: DarkTheme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: DarkTheme.border,
  },
  icon: {
    fontSize: 16,
    marginTop: 1,
  },
  content: {
    flex: 1,
  },
  message: {
    fontSize: DarkTheme.font.sizes.sm,
    color: DarkTheme.textSecondary,
  },
  time: {
    fontSize: DarkTheme.font.sizes.xs,
    color: DarkTheme.textMuted,
    marginTop: 2,
  },
});

// ─── CRITICAL ALERTS TICKER ─────────────────────────────────────────

const CriticalAlertsTicker: React.FC<{ alerts: any[] }> = React.memo(({ alerts }) => {
  const [marqueeOffset] = useState(new Animated.Value(0));
  const screenWidth = Dimensions.get('window').width;

  // Start marquee animation
  useEffect(() => {
    if (alerts.length > 0) {
      const animation = Animated.loop(
        Animated.timing(marqueeOffset, {
          toValue: -screenWidth,
          duration: 15000,
          useNativeDriver: true,
        })
      );
      animation.start();
      return () => animation.stop();
    }
  }, [alerts.length, marqueeOffset, screenWidth]);

  if (alerts.length === 0) {
    return (
      <View style={tickerStyles.container}>
        <View style={[tickerStyles.bar, tickerStyles.healthyBar]}>
          <Text style={tickerStyles.healthyText}>✅ System Healthy - No Critical Alerts</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={tickerStyles.container}>
      <View style={[tickerStyles.bar, tickerStyles.alertBar]}>
        <Animated.View
          style={[
            tickerStyles.marqueeContainer,
            { transform: [{ translateX: marqueeOffset }] }
          ]}
        >
          {alerts.map((alert) => (
            <Text key={alert.id} style={tickerStyles.alertText}>
              {alert.title}: {alert.message} (Asset: {alert.assetTag})
            </Text>
          ))}
        </Animated.View>
      </View>
    </View>
  );
});

const tickerStyles = StyleSheet.create({
  container: {
    marginBottom: DarkTheme.spacing.md,
  },
  bar: {
    paddingVertical: DarkTheme.spacing.sm,
    paddingHorizontal: DarkTheme.spacing.md,
    borderRadius: DarkTheme.radius.full,
    overflow: 'hidden',
  },
  alertBar: {
    backgroundColor: DarkTheme.accentDanger,
  },
  healthyBar: {
    backgroundColor: DarkTheme.accentSuccess,
  },
  marqueeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  alertText: {
    color: 'white',
    fontSize: DarkTheme.font.sizes.sm,
    fontWeight: DarkTheme.font.weights.semibold,
    marginRight: 40,
  },
  healthyText: {
    color: 'white',
    fontSize: DarkTheme.font.sizes.sm,
    fontWeight: DarkTheme.font.weights.medium,
    textAlign: 'center',
  },
});

// ─── SECTION HEADER ─────────────────────────────────────────────────

const SectionHeader: React.FC<{
  title: string;
  count?: number;
  action?: string;
  onAction?: () => void;
}> = React.memo(({ title, count, action, onAction }) => (
  <View style={sectionStyles.container}>
    <View style={sectionStyles.left}>
      <Text style={sectionStyles.title}>{title}</Text>
      {count !== undefined && (
        <View style={sectionStyles.badge}>
          <Text style={sectionStyles.badgeText}>{count}</Text>
        </View>
      )}
    </View>
    {action && onAction && (
      <Pressable onPress={onAction}>
        <Text style={sectionStyles.action}>{action}</Text>
      </Pressable>
    )}
  </View>
));

const sectionStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: DarkTheme.spacing.md,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: DarkTheme.spacing.sm,
  },
  title: {
    fontSize: DarkTheme.font.sizes.lg,
    fontWeight: DarkTheme.font.weights.bold,
    color: DarkTheme.textPrimary,
  },
  badge: {
    backgroundColor: DarkTheme.statusActiveBg,
    paddingHorizontal: DarkTheme.spacing.sm,
    paddingVertical: 2,
    borderRadius: DarkTheme.radius.full,
  },
  badgeText: {
    fontSize: DarkTheme.font.sizes.xs,
    fontWeight: DarkTheme.font.weights.bold,
    color: DarkTheme.accentPrimary,
  },
  action: {
    fontSize: DarkTheme.font.sizes.sm,
    fontWeight: DarkTheme.font.weights.semibold,
    color: DarkTheme.accentPrimary,
  },
});

// ═════════════════════════════════════════════════════════════════════
// ═══ MAIN DASHBOARD ═════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════

export const OperationsDashboard: React.FC = () => {
  const {
    metrics,
    statusBreakdown,
    upcomingInspections,
    projectSummaries,
    realtimeEvents,
    isLoading,
    isRefreshing,
    error,
    lastSyncedAt,
    isRealtimeConnected,
    refresh,
    clearError,
  } = useOperationsData();

  // Critical Alerts integration
  const { alerts, loading: alertsLoading } = useCriticalAlerts();

  // ── Render: Loading ───────────────────────────────────────────────
  if (isLoading) {
    return <LoadingState message="Syncing operations data…" />;
  }

  // ── Render: Fatal Error (no data at all) ──────────────────────────
  if (error && projectSummaries.length === 0) {
    return (
      <ErrorState
        message={error}
        onRetry={refresh}
        fullScreen
      />
    );
  }

  const formatCurrency = (amount: number): string => {
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
    if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
    return `$${amount}`;
  };

  return (
    <SafeAreaView style={dashStyles.safeArea}>
      <ScrollView
        style={dashStyles.scroll}
        contentContainerStyle={dashStyles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refresh}
            tintColor={DarkTheme.accentPrimary}
            colors={[DarkTheme.accentPrimary]}
            progressBackgroundColor={DarkTheme.surface}
          />
        }
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <View style={dashStyles.header}>
          <View>
            <Text style={dashStyles.headerTitle}>Operations</Text>
            <Text style={dashStyles.headerSubtitle}>
              Dashboard Overview
            </Text>
          </View>
          <RealtimeIndicator
            isConnected={isRealtimeConnected}
            lastSyncedAt={lastSyncedAt}
          />
        </View>

        {/* ── Non-fatal Error Banner ─────────────────────────────── */}
        {error && (
          <ErrorState
            message={error}
            onRetry={refresh}
            onDismiss={clearError}
          />
        )}

        {/* ── Critical Alerts Ticker ─────────────────────────────── */}
        <View style={dashStyles.section}>
          <CriticalAlertsTicker alerts={alerts} />
        </View>

        {/* ── KPI Metrics Grid ───────────────────────────────────── */}
        <View style={dashStyles.metricsGrid}>
          <View style={dashStyles.metricsRow}>
            <MetricCard
              label="Active Projects"
              value={metrics.activeProjects}
              subtitle={`of ${metrics.totalProjects} total`}
              accentColor={DarkTheme.accentPrimary}
            />
            <MetricCard
              label="Inspections"
              value={metrics.pendingInspections}
              subtitle="pending"
              accentColor={DarkTheme.accentWarning}
            />
          </View>
          <View style={dashStyles.metricsRow}>
            <MetricCard
              label="Avg Score"
              value={metrics.averageScore > 0 ? `${metrics.averageScore}%` : "—"}
              subtitle="inspection quality"
              accentColor={DarkTheme.accentSuccess}
            />
            <MetricCard
              label="Budget Used"
              value={`${metrics.budgetUtilization}%`}
              subtitle={`${formatCurrency(metrics.totalSpent)} of ${formatCurrency(metrics.totalBudget)}`}
              accentColor={
                metrics.budgetUtilization > 90
                  ? DarkTheme.accentDanger
                  : metrics.budgetUtilization > 75
                    ? DarkTheme.accentWarning
                    : DarkTheme.accentSuccess
              }
            />
          </View>
          {metrics.criticalFindings > 0 && (
            <MetricCard
              label="Critical Findings"
              value={metrics.criticalFindings}
              subtitle="require immediate attention"
              accentColor={DarkTheme.accentDanger}
            />
          )}
        </View>

        {/* ── Status Breakdown ───────────────────────────────────── */}
        <View style={dashStyles.section}>
          <StatusBar breakdown={statusBreakdown} />
        </View>

        {/* ── Live Activity Feed ─────────────────────────────────── */}
        {realtimeEvents.length > 0 && (
          <View style={dashStyles.section}>
            <ActivityFeed events={realtimeEvents} />
          </View>
        )}

        {/* ── Upcoming Inspections ───────────────────────────────── */}
        {upcomingInspections.length > 0 && (
          <View style={dashStyles.section}>
            <SectionHeader
              title="Upcoming Inspections"
              count={upcomingInspections.length}
              action="View All"
              onAction={() => {
                /* navigation.navigate('Inspections') */
              }}
            />
            <View style={dashStyles.inspectionsList}>
              {upcomingInspections.map((inspection) => (
                <InspectionRow
                  key={inspection.id}
                  inspection={inspection}
                />
              ))}
            </View>
          </View>
        )}

        {/* ── Projects List ──────────────────────────────────────── */}
        <View style={dashStyles.section}>
          <SectionHeader
            title="Projects"
            count={projectSummaries.length}
            action="View All"
            onAction={() => {
              /* navigation.navigate('Projects') */
            }}
          />
          <View style={dashStyles.projectsList}>
            {projectSummaries.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </View>
        </View>

        {/* Bottom spacer */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

// ─── Dashboard Styles ───────────────────────────────────────────────

const dashStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: DarkTheme.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: DarkTheme.spacing.lg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: DarkTheme.spacing.xl,
  },
  headerTitle: {
    fontSize: DarkTheme.font.sizes.display,
    fontWeight: DarkTheme.font.weights.bold,
    color: DarkTheme.textPrimary,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: DarkTheme.font.sizes.sm,
    color: DarkTheme.textMuted,
    marginTop: 2,
  },
  metricsGrid: {
    gap: DarkTheme.spacing.md,
    marginBottom: DarkTheme.spacing.xxl,
  },
  metricsRow: {
    flexDirection: "row",
    gap: DarkTheme.spacing.md,
  },
  section: {
    marginBottom: DarkTheme.spacing.xxl,
  },
  inspectionsList: {
    gap: DarkTheme.spacing.sm,
  },
  projectsList: {
    gap: DarkTheme.spacing.md,
  },
});

export default OperationsDashboard;