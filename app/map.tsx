// ════════════════════════════════════════════════════════════════════════════════
// app/(shared)/interactive-map.tsx
//
// NEXPEC — Unified Interactive Map System
// Role-aware job map with clustering, geolocation, and actionable bottom sheet.
//
// Inspector: Sees all open jobs → Can accept
// Client/Agency: Sees own posted jobs → Can edit/manage
// ════════════════════════════════════════════════════════════════════════════════

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Platform,
  Dimensions,
  StatusBar,
  Image,
} from 'react-native';
import MapView, {
  Marker,
  Region,
  PROVIDER_DEFAULT,
  MapStyleElement,
} from 'react-native-maps';
import ClusteredMapView from 'react-native-map-clustering';
import * as Location from 'expo-location';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, {
  BottomSheetView,
  BottomSheetBackdrop,
} from '@gorhom/bottom-sheet';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
} from 'react-native-reanimated';
import { supabase } from '../lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { navigateToLocation } from '@/src/utils/navigationHelper';

// ── Dimensions ──────────────────────────────────────────────
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ── Theme ───────────────────────────────────────────────────
const COLORS = {
  background: '#020617',
  surface: '#0F172A',
  surfaceLight: '#1E293B',
  border: '#1F2937',
  borderLight: '#334155',
  primary: '#7C3AED',
  primaryBlue: '#3B82F6',
  green: '#10B981',
  greenDark: '#059669',
  greenBg: 'rgba(16, 185, 129, 0.12)',
  orange: '#F59E0B',
  orangeBg: 'rgba(245, 158, 11, 0.12)',
  red: '#EF4444',
  redBg: 'rgba(239, 68, 68, 0.12)',
  blue: '#3B82F6',
  blueBg: 'rgba(59, 130, 246, 0.12)',
  white: '#F8FAFC',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
};

// ── Fallback Region (Montreal) ──────────────────────────────
const DEFAULT_REGION: Region = {
  latitude: 45.5017,
  longitude: -73.5673,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

// ════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════

type UserRole = 'inspector' | 'client' | 'agency' | 'enterprise';

interface JobMarker {
  id: string;
  title: string;
  description: string | null;
  status: string;
  budget: number | null;
  latitude: number;
  longitude: number;
  location: string | null;
  client_id: string;
  contractor_id: string | null;
  created_at: string;
  inspection_type: string | null;
}

type BudgetTier = 'high' | 'mid' | 'low' | 'unknown';

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

const getBudgetTier = (budget: number | null): BudgetTier => {
  if (budget === null || budget === undefined) return 'unknown';
  if (budget >= 3000) return 'high';
  if (budget >= 1000) return 'mid';
  return 'low';
};

const BUDGET_TIER_CONFIG: Record<
  BudgetTier,
  { color: string; bg: string; label: string; icon: string }
> = {
  high: { color: COLORS.green, bg: COLORS.greenBg, label: 'High Value', icon: 'trending-up' },
  mid: { color: COLORS.orange, bg: COLORS.orangeBg, label: 'Mid Range', icon: 'remove' },
  low: { color: COLORS.blue, bg: COLORS.blueBg, label: 'Entry Level', icon: 'trending-down' },
  unknown: { color: COLORS.textMuted, bg: 'rgba(100,116,139,0.12)', label: 'TBD', icon: 'help' },
};

const formatBudget = (budget: number | null): string => {
  if (budget === null || budget === undefined) return 'Budget TBD';
  return `$${budget.toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
};

const formatDate = (iso: string): string => {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const getStatusConfig = (
  status: string
): { color: string; bg: string; label: string } => {
  const configs: Record<string, { color: string; bg: string; label: string }> = {
    open: { color: COLORS.green, bg: COLORS.greenBg, label: 'Open' },
    assigned: { color: COLORS.orange, bg: COLORS.orangeBg, label: 'Assigned' },
    in_progress: { color: COLORS.primaryBlue, bg: COLORS.blueBg, label: 'In Progress' },
    completed: { color: COLORS.textMuted, bg: 'rgba(100,116,139,0.12)', label: 'Completed' },
    cancelled: { color: COLORS.red, bg: COLORS.redBg, label: 'Cancelled' },
  };
  return configs[status] || configs.open;
};

// ── Dark Map Style (Google Maps — Android & iOS) ────────────
const DARK_MAP_STYLE: MapStyleElement[] = [
  { elementType: 'geometry', stylers: [{ color: '#0F172A' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0F172A' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#64748B' }] },
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#94A3B8' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#1E293B' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#334155' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#334155' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#020617' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#334155' }],
  },
  {
    featureType: 'poi',
    elementType: 'geometry',
    stylers: [{ color: '#1E293B' }],
  },
  {
    featureType: 'poi',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#64748B' }],
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#1E293B' }],
  },
];

// ════════════════════════════════════════════════════════════
// CUSTOM MARKER COMPONENT
// ════════════════════════════════════════════════════════════

const CustomMarkerView: React.FC<{
  budget: number | null;
  isSelected: boolean;
}> = React.memo(({ budget, isSelected }) => {
  const tier = getBudgetTier(budget);
  const config = BUDGET_TIER_CONFIG[tier];
  const markerSize = isSelected ? 44 : 36;
  const dotSize = isSelected ? 14 : 10;

  return (
    <View style={[markerStyles.container, { width: markerSize, height: markerSize }]}>
      {/* Outer ring */}
      <View
        style={[
          markerStyles.outerRing,
          {
            width: markerSize,
            height: markerSize,
            borderRadius: markerSize / 2,
            borderColor: config.color,
            backgroundColor: isSelected ? `${config.color}30` : `${config.color}15`,
            borderWidth: isSelected ? 3 : 2,
          },
        ]}
      >
        {/* Inner dot */}
        <View
          style={[
            markerStyles.innerDot,
            {
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              backgroundColor: config.color,
            },
          ]}
        />
      </View>

      {/* Budget label */}
      {budget !== null && (
        <View style={[markerStyles.budgetPill, { backgroundColor: config.color }]}>
          <Text style={markerStyles.budgetPillText}>
            ${budget >= 1000 ? `${(budget / 1000).toFixed(0)}k` : budget}
          </Text>
        </View>
      )}
    </View>
  );
});

const markerStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerRing: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  innerDot: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  budgetPill: {
    position: 'absolute',
    top: -8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    minWidth: 28,
    alignItems: 'center',
  },
  budgetPillText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
});

// ════════════════════════════════════════════════════════════
// USER LOCATION BUTTON
// ════════════════════════════════════════════════════════════

const MyLocationButton: React.FC<{
  onPress: () => void;
  loading: boolean;
}> = ({ onPress, loading }) => (
  <TouchableOpacity
    style={controlStyles.locationButton}
    onPress={onPress}
    activeOpacity={0.8}
    disabled={loading}
  >
    {loading ? (
      <ActivityIndicator size="small" color={COLORS.primary} />
    ) : (
      <Ionicons name="locate" size={22} color={COLORS.primary} />
    )}
  </TouchableOpacity>
);

// ── Map Legend ───────────────────────────────────────────────
const MapLegend: React.FC = React.memo(() => (
  <View style={controlStyles.legend}>
    {(['high', 'mid', 'low'] as BudgetTier[]).map((tier) => {
      const cfg = BUDGET_TIER_CONFIG[tier];
      return (
        <View key={tier} style={controlStyles.legendItem}>
          <View
            style={[controlStyles.legendDot, { backgroundColor: cfg.color }]}
          />
          <Text style={controlStyles.legendText}>{cfg.label}</Text>
        </View>
      );
    })}
  </View>
));

const controlStyles = StyleSheet.create({
  locationButton: {
    position: 'absolute',
    bottom: 160,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  legend: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 110 : 90,
    left: 16,
    backgroundColor: `${COLORS.surface}E6`,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
});

// ════════════════════════════════════════════════════════════
// LOADING OVERLAY
// ════════════════════════════════════════════════════════════

const LoadingOverlay: React.FC<{ message: string }> = ({ message }) => (
  <Animated.View entering={FadeIn.duration(200)} style={overlayStyles.container}>
    <View style={overlayStyles.card}>
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text style={overlayStyles.text}>{message}</Text>
    </View>
  </Animated.View>
);

const overlayStyles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 6, 23, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    gap: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    minWidth: 200,
  },
  text: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
});

// ════════════════════════════════════════════════════════════
// EMPTY STATE
// ════════════════════════════════════════════════════════════

const EmptyMapState: React.FC<{ role: UserRole }> = ({ role }) => (
  <View style={emptyStyles.container}>
    <View style={emptyStyles.card}>
      <View style={emptyStyles.iconWrap}>
        <Ionicons name="map-outline" size={40} color={COLORS.primary} />
      </View>
      <Text style={emptyStyles.title}>No Jobs Found</Text>
      <Text style={emptyStyles.subtitle}>
        {role === 'inspector'
          ? 'There are no open inspection jobs in this area right now. Pull down to refresh or expand your search.'
          : 'You haven\'t posted any jobs with location data yet. Add coordinates when creating a job to see them on the map.'}
      </Text>
    </View>
  </View>
);

const emptyStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    zIndex: 100,
  },
  card: {
    backgroundColor: `${COLORS.surface}F2`,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});

// ════════════════════════════════════════════════════════════
// HEADER BAR
// ════════════════════════════════════════════════════════════

const MapHeader: React.FC<{
  jobCount: number;
  role: UserRole;
  onRefresh: () => void;
  refreshing: boolean;
}> = ({ jobCount, role, onRefresh, refreshing }) => (
  <View style={headerStyles.container}>
    <View style={{ flex: 1 }}>
      <Text style={headerStyles.title}>
        {role === 'inspector' ? 'Available Jobs' : 'Your Job Map'}
      </Text>
      <Text style={headerStyles.subtitle}>
        {jobCount} {jobCount === 1 ? 'job' : 'jobs'} on map
      </Text>
    </View>
    <TouchableOpacity
      style={headerStyles.refreshBtn}
      onPress={onRefresh}
      disabled={refreshing}
      activeOpacity={0.7}
    >
      {refreshing ? (
        <ActivityIndicator size="small" color={COLORS.primary} />
      ) : (
        <Ionicons name="refresh" size={20} color={COLORS.primary} />
      )}
    </TouchableOpacity>
  </View>
);

const headerStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 40,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${COLORS.surface}F2`,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.white,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
    marginTop: 2,
  },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.25)',
  },
});

// ════════════════════════════════════════════════════════════
// MAIN SCREEN COMPONENT
// ════════════════════════════════════════════════════════════

export default function InteractiveMapScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const user = session?.user;

  // ── Refs ──────────────────────────────────────────────────
  const mapRef = useRef<MapView>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);

  // ── State ─────────────────────────────────────────────────
  const [role, setRole] = useState<UserRole>('inspector');
  const [jobs, setJobs] = useState<JobMarker[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobMarker | null>(null);
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  // Loading states
  const [initialLoading, setInitialLoading] = useState(true);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [acceptingJob, setAcceptingJob] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // ── Bottom Sheet Config ───────────────────────────────────
  const snapPoints = useMemo(() => ['38%', '65%'], []);

  // ── Fetch User Role ───────────────────────────────────────
  useEffect(() => {
    const fetchRole = async () => {
      if (!user?.id) return;
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();

        if (!error && data?.role) {
          // Enterprise is now a first-class role on mobile.
          setRole(data.role as UserRole);
        }
      } catch (err) {
        console.warn('[Map] Role fetch error:', err);
      }
    };
    fetchRole();
  }, [user?.id]);

  // ── Request Location ──────────────────────────────────────
  const requestLocation = useCallback(async () => {
    setLocationLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        console.log('[Map] Location permission denied, using default region');
        setRegion(DEFAULT_REGION);
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };

      setUserLocation(coords);

      const newRegion: Region = {
        ...coords,
        latitudeDelta: 0.06,
        longitudeDelta: 0.06,
      };

      setRegion(newRegion);

      // Animate map to user location
      mapRef.current?.animateToRegion(newRegion, 1000);

      console.log(
        `[Map] User location: ${coords.latitude}, ${coords.longitude}`
      );
    } catch (error) {
      console.warn('[Map] Location error:', error);
      setRegion(DEFAULT_REGION);
    } finally {
      setLocationLoading(false);
    }
  }, []);

  // ── Fetch Jobs from Supabase ──────────────────────────────
  const fetchJobs = useCallback(async () => {
    if (!user?.id) return;

    setJobsLoading(true);
    try {
      let query = supabase
        .from('jobs')
        .select(
          'id, title, description, status, budget, latitude, longitude, location, client_id, contractor_id, created_at, inspection_type'
        )
        .not('latitude', 'is', null)
        .not('longitude', 'is', null);

      if (role === 'inspector') {
        // Inspectors see ALL open jobs
        query = query.eq('status', 'open');
      } else {
        // Clients & Agencies see ONLY their own posted jobs
        query = query.eq('client_id', user.id);
      }

      query = query.order('created_at', { ascending: false }).limit(200);

      const { data, error } = await query;

      // 🪤 TRAP: Let's see exactly what fields are available for a job!
      if (data && data.length > 0) {
        console.log('\n=== 🕵️‍♂️ NEXPEC DB TRAP: JOB DATA ===');
        console.log(JSON.stringify(data[0], null, 2));
        console.log('=====================================\n');
      }

      if (error) {
        console.error('[Map] Jobs fetch error:', error.message);
        Alert.alert('Error', 'Failed to load jobs. Pull to refresh.');
        return;
      }

      const validJobs: JobMarker[] = (data || []).filter(
        (job: any) =>
          typeof job.latitude === 'number' &&
          typeof job.longitude === 'number' &&
          !isNaN(job.latitude) &&
          !isNaN(job.longitude) &&
          Math.abs(job.latitude) <= 90 &&
          Math.abs(job.longitude) <= 180
      ) as JobMarker[];

      setJobs(validJobs);
      console.log(`[Map] Loaded ${validJobs.length} jobs with valid coordinates`);

      // If we have jobs but no user location, fit map to show all markers
      if (validJobs.length > 0 && !userLocation) {
        fitMapToMarkers(validJobs);
      }
    } catch (err) {
      console.error('[Map] Unexpected jobs error:', err);
    } finally {
      setJobsLoading(false);
    }
  }, [user?.id, role, userLocation]);

  // ── Fit Map to Show All Markers ───────────────────────────
  const fitMapToMarkers = useCallback(
    (markers: JobMarker[]) => {
      if (markers.length === 0 || !mapRef.current) return;

      const coords = markers.map((j) => ({
        latitude: j.latitude,
        longitude: j.longitude,
      }));

      // Include user location if available
      if (userLocation) {
        coords.push(userLocation);
      }

      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 120, right: 60, bottom: 200, left: 60 },
        animated: true,
      });
    },
    [userLocation]
  );

  // ── Initial Load ──────────────────────────────────────────
  useEffect(() => {
    const initialize = async () => {
      setInitialLoading(true);
      await requestLocation();
      await fetchJobs();
      setInitialLoading(false);
    };
    if (user?.id) {
      initialize();
    }
  }, [user?.id, role]);

  // ── Refresh Handler ───────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchJobs();
    setRefreshing(false);
  }, [fetchJobs]);

  // ── Recenter to User Location ─────────────────────────────
  const recenterToUser = useCallback(async () => {
    if (userLocation) {
      mapRef.current?.animateToRegion(
        {
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        },
        800
      );
    } else {
      await requestLocation();
    }
  }, [userLocation, requestLocation]);

  // ── Marker Press Handler ──────────────────────────────────
  const handleMarkerPress = useCallback(
    (job: JobMarker) => {
      setSelectedJob(job);

      // Animate map to center on the selected marker
      mapRef.current?.animateToRegion(
        {
          latitude: job.latitude - 0.008, // Offset slightly so marker isn't behind bottom sheet
          longitude: job.longitude,
          latitudeDelta: 0.03,
          longitudeDelta: 0.03,
        },
        600
      );

      // Open bottom sheet
      bottomSheetRef.current?.snapToIndex(0);
    },
    []
  );

  // ── View Job Details (Inspector) ────────────────────────────────
  const handleViewDetails = useCallback(() => {
    if (!selectedJob) return;
    
    Alert.alert(
      'View Job Details',
      `Navigate to job details for "${selectedJob.title}".\n\nRoute: /jobs/${selectedJob.id}/apply`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'View Details',
          style: 'default',
          onPress: () => {
            bottomSheetRef.current?.close();
            router.push(`/jobs/${selectedJob.id}/apply`);
          },
        },
      ]
    );
  }, [selectedJob, router]);

  // ── Edit Job (Client / Agency) ────────────────────────────
  const handleEditJob = useCallback(() => {
    if (!selectedJob) return;
    bottomSheetRef.current?.close();
    // Navigate to job edit/detail screen
    Alert.alert(
      'Edit Job',
      `Navigate to edit screen for "${selectedJob.title}".\n\nRoute: /jobs/${selectedJob.id}/edit`
    );
    // In production:
    // router.push(`/jobs/${selectedJob.id}/edit`);
  }, [selectedJob]);

  // ── View Applicants (Client / Agency) ─────────────────────
  const handleViewApplicants = useCallback(() => {
    if (!selectedJob) return;
    bottomSheetRef.current?.close();
    Alert.alert(
      'View Applicants',
      `Navigate to applicants for "${selectedJob.title}".\n\nRoute: /jobs/${selectedJob.id}/applicants`
    );
    // In production:
    // router.push(`/jobs/${selectedJob.id}/applicants`);
  }, [selectedJob]);

  // ── Bottom Sheet Close Handler ────────────────────────────
  const handleSheetChange = useCallback((index: number) => {
    if (index === -1) {
      setSelectedJob(null);
    }
  }, []);

  // ── Render Bottom Sheet Backdrop ──────────────────────────
  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.4}
        pressBehavior="close"
      />
    ),
    []
  );

  // ════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />

      <View style={styles.container}>
        {/* ── Loading Overlay ──────────────────────────────── */}
        {initialLoading && (
          <LoadingOverlay message="Loading map data…" />
        )}

        {/* ── Map ─────────────────────────────────────────── */}
        <ClusteredMapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_DEFAULT}
          initialRegion={DEFAULT_REGION}
          region={undefined} // Let the map handle its own region after initial
          customMapStyle={DARK_MAP_STYLE}
          showsUserLocation={!!userLocation}
          showsMyLocationButton={false}
          showsCompass={false}
          showsScale={false}
          showsIndoors={false}
          showsBuildings={false}
          showsTraffic={false}
          showsPointsOfInterest={false}
          mapPadding={{ top: 100, right: 0, bottom: 100, left: 0 }}
          userInterfaceStyle="dark"
          // Clustering config
          clusterColor={COLORS.primary}
          clusterTextColor={COLORS.white}
          clusterFontFamily={Platform.OS === 'ios' ? 'System' : 'sans-serif-medium'}
          radius={60}
          minZoomLevel={3}
          maxZoomLevel={20}
          extent={512}
          minPoints={3}
          animationEnabled={true}
          onPress={() => {
            // Deselect when tapping empty map area
            if (selectedJob) {
              setSelectedJob(null);
              bottomSheetRef.current?.close();
            }
          }}
        >
          {/* ── Job Markers ──────────────────────────────── */}
          {jobs.map((job) => (
            <Marker
              key={job.id}
              identifier={job.id}
              coordinate={{
                latitude: job.latitude,
                longitude: job.longitude,
              }}
              tracksViewChanges={false}
              onPress={(e) => {
                e.stopPropagation();
                handleMarkerPress(job);
              }}
            >
              <CustomMarkerView
                budget={job.budget}
                isSelected={selectedJob?.id === job.id}
              />
            </Marker>
          ))}
        </ClusteredMapView>

        {/* ── Header Bar ──────────────────────────────────── */}
        <MapHeader
          jobCount={jobs.length}
          role={role}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />

        {/* ── Legend ───────────────────────────────────────── */}
        <MapLegend />

        {/* ── My Location Button ──────────────────────────── */}
        <MyLocationButton
          onPress={recenterToUser}
          loading={locationLoading}
        />

        {/* ── Empty State ─────────────────────────────────── */}
        {!initialLoading && !jobsLoading && jobs.length === 0 && (
          <EmptyMapState role={role} />
        )}

        {/* ── Bottom Sheet (Job Detail) ───────────────────── */}
        <BottomSheet
          ref={bottomSheetRef}
          index={-1}
          snapPoints={snapPoints}
          onChange={handleSheetChange}
          enablePanDownToClose
          enableDynamicSizing={false}
          backgroundStyle={sheetStyles.background}
          handleIndicatorStyle={sheetStyles.handleIndicator}
          backdropComponent={renderBackdrop}
          style={sheetStyles.sheet}
        >
          <BottomSheetView style={sheetStyles.content}>
            {selectedJob ? (
              <>
                {/* ── Job Header ────────────────────────── */}
                <View style={sheetStyles.jobHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={sheetStyles.jobTitle} numberOfLines={2}>
                      {selectedJob.title}
                    </Text>
                    {selectedJob.inspection_type && (
                      <View style={sheetStyles.typeBadge}>
                        <Ionicons
                          name="flask"
                          size={12}
                          color={COLORS.primary}
                        />
                        <Text style={sheetStyles.typeText}>
                          {selectedJob.inspection_type}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Budget badge */}
                  <View
                    style={[
                      sheetStyles.budgetBadge,
                      {
                        backgroundColor:
                          BUDGET_TIER_CONFIG[getBudgetTier(selectedJob.budget)]
                            .bg,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        sheetStyles.budgetText,
                        {
                          color:
                            BUDGET_TIER_CONFIG[
                              getBudgetTier(selectedJob.budget)
                            ].color,
                        },
                      ]}
                    >
                      {formatBudget(selectedJob.budget)}
                    </Text>
                  </View>
                </View>

                {/* ── Status Bar ────────────────────────── */}
                <View style={sheetStyles.statusRow}>
                  <View
                    style={[
                      sheetStyles.statusBadge,
                      {
                        backgroundColor: getStatusConfig(selectedJob.status).bg,
                      },
                    ]}
                  >
                    <View
                      style={[
                        sheetStyles.statusDot,
                        {
                          backgroundColor: getStatusConfig(selectedJob.status)
                            .color,
                        },
                      ]}
                    />
                    <Text
                      style={[
                        sheetStyles.statusText,
                        {
                          color: getStatusConfig(selectedJob.status).color,
                        },
                      ]}
                    >
                      {getStatusConfig(selectedJob.status).label}
                    </Text>
                  </View>
                  <Text style={sheetStyles.dateText}>
                    Posted {formatDate(selectedJob.created_at)}
                  </Text>
                </View>

                {/* ── Divider ──────────────────────────── */}
                <View style={sheetStyles.divider} />

                {/* ── Description ──────────────────────── */}
                {selectedJob.description && (
                  <View style={sheetStyles.descSection}>
                    <Text style={sheetStyles.descLabel}>Description</Text>
                    <Text
                      style={sheetStyles.descText}
                      numberOfLines={4}
                    >
                      {selectedJob.description}
                    </Text>
                  </View>
                )}

                {/* ── Location Info ────────────────────── */}
                <View style={sheetStyles.locationRow}>
                  <Ionicons
                    name="location"
                    size={16}
                    color={COLORS.red}
                  />
                  <Text
                    style={sheetStyles.locationText}
                    numberOfLines={1}
                  >
                    {selectedJob.location ||
                      `${selectedJob.latitude.toFixed(4)}, ${selectedJob.longitude.toFixed(4)}`}
                  </Text>
                </View>

                {/* ── Action Buttons ───────────────────── */}
                <View style={sheetStyles.actionRow}>
                  {/* Navigation Button */}
                  <TouchableOpacity
                    style={sheetStyles.secondaryButton}
                    onPress={() => {
                      if (selectedJob) {
                        navigateToLocation({
                          latitude: selectedJob.latitude,
                          longitude: selectedJob.longitude,
                          title: selectedJob.title,
                          address: selectedJob.location || undefined,
                        });
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name="navigate"
                      size={18}
                      color={COLORS.primary}
                    />
                    <Text style={sheetStyles.secondaryButtonText}>
                      Navigate
                    </Text>
                  </TouchableOpacity>

                  {role === 'inspector' ? (
                    // ── Inspector: View Details Button ─────
                    <TouchableOpacity
                      style={sheetStyles.primaryButton}
                      onPress={handleViewDetails}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name="eye-outline"
                        size={20}
                        color="#FFF"
                      />
                      <Text style={sheetStyles.primaryButtonText}>
                        View Details
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    // ── Client/Agency: Edit & View Buttons ─
                    <View style={sheetStyles.dualButtonRow}>
                      <TouchableOpacity
                        style={sheetStyles.secondaryButton}
                        onPress={handleEditJob}
                        activeOpacity={0.8}
                      >
                        <Ionicons
                          name="create-outline"
                          size={18}
                          color={COLORS.primary}
                        />
                        <Text style={sheetStyles.secondaryButtonText}>
                          Edit Job
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={sheetStyles.primaryButton}
                        onPress={handleViewApplicants}
                        activeOpacity={0.85}
                      >
                        <Ionicons
                          name="people"
                          size={18}
                          color="#FFF"
                        />
                        <Text style={sheetStyles.primaryButtonText}>
                          View Applicants
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </>
            ) : (
              <View style={sheetStyles.emptySheet}>
                <Text style={sheetStyles.emptySheetText}>
                  Tap a marker to view job details
                </Text>
              </View>
            )}
          </BottomSheetView>
        </BottomSheet>
      </View>
    </GestureHandlerRootView>
  );
}

// ════════════════════════════════════════════════════════════
// MAIN STYLES
// ════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
});

// ── Bottom Sheet Styles ─────────────────────────────────────
const sheetStyles = StyleSheet.create({
  sheet: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 24,
  },
  background: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: COLORS.borderLight,
  },
  handleIndicator: {
    backgroundColor: COLORS.borderLight,
    width: 40,
    height: 4,
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },

  // Job Header
  jobHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
    marginBottom: 12,
  },
  jobTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: -0.3,
    lineHeight: 26,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.2)',
  },
  typeText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  budgetBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: 'center',
  },
  budgetText: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },

  // Status
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.3,
  },
  dateText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginBottom: 16,
  },

  // Description
  descSection: {
    marginBottom: 16,
  },
  descLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  descText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 22,
    fontWeight: '500',
  },

  // Location
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
    backgroundColor: 'rgba(239, 68, 68, 0.06)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.12)',
  },
  locationText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '500',
    flex: 1,
  },

  // Actions
  actionRow: {
    marginTop: 4,
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.green,
    paddingVertical: 16,
    borderRadius: 14,
    shadowColor: COLORS.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  disabledButton: {
    backgroundColor: COLORS.surfaceLight,
    shadowOpacity: 0,
    elevation: 0,
  },
  dualButtonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.25)',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
  },

  // Empty
  emptySheet: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  emptySheetText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
});