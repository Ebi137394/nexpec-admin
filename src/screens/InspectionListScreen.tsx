import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  TextInput,
  ScrollView,
  Dimensions,
  LayoutAnimation,
  Platform,
  UIManager,
  Animated,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Search,
  X,
  MapPin,
  Calendar,
  Clock,
  ChevronRight,
  Filter,
  AlertTriangle,
  CheckCircle,
  PlayCircle,
  PauseCircle,
  FileSearch,
  ClipboardList,
  SlidersHorizontal,
  ArrowUpDown,
  Sparkles,
  LucideIcon,
} from 'lucide-react-native';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ============================================
// THEME COLORS
// ============================================
const COLORS = {
  background: '#0A0E17',
  surface: '#141B2D',
  surfaceLight: '#1E2A45',
  surfaceDark: '#0D1321',
  primary: '#00F5FF',
  primaryDark: '#00C8D4',
  secondary: '#7B61FF',
  accent: '#FF6B6B',
  success: '#00D68F',
  successDark: '#00A86B',
  warning: '#FFB800',
  error: '#FF4757',
  errorDark: '#CC3A47',
  info: '#3B82F6',
  textPrimary: '#FFFFFF',
  textSecondary: '#A0AEC0',
  textMuted: '#64748B',
  border: 'rgba(0, 245, 255, 0.2)',
  borderLight: 'rgba(255, 255, 255, 0.08)',
  glassBg: 'rgba(20, 27, 45, 0.85)',
  glassGlow: 'rgba(0, 245, 255, 0.15)',
  overlay: 'rgba(0, 0, 0, 0.5)',
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ============================================
// TYPE DEFINITIONS
// ============================================
type RootStackParamList = {
  InspectionDetail: { inspectionId: string };
  InspectionList: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type InspectionStatus = 'pending' | 'in_progress' | 'completed' | 'issues';

interface Inspection {
  id: string;
  title: string;
  location: string;
  address: string;
  date: string;
  time: string;
  status: InspectionStatus;
  priority: 'low' | 'medium' | 'high';
  assignee: string;
  progress?: number;
  issuesCount?: number;
}

interface FilterChip {
  id: string;
  label: string;
  value: InspectionStatus | 'all';
  icon?: LucideIcon | React.ComponentType<{ size: number; color: string }>;
  count?: number;
}

// ============================================
// MOCK DATA
// ============================================
const MOCK_INSPECTIONS: Inspection[] = [
  {
    id: 'INS-001',
    title: 'Pipeline Integrity Check',
    location: 'Sector 7 - North Wing',
    address: '1234 Industrial Park, Building A',
    date: 'Dec 28, 2024',
    time: '09:00 AM',
    status: 'in_progress',
    priority: 'high',
    assignee: 'John Doe',
    progress: 35,
  },
  {
    id: 'INS-002',
    title: 'Safety Valve Assessment',
    location: 'Refinery Unit 3',
    address: '567 Refinery Complex',
    date: 'Dec 28, 2024',
    time: '02:00 PM',
    status: 'pending',
    priority: 'medium',
    assignee: 'Sarah Smith',
  },
  {
    id: 'INS-003',
    title: 'Corrosion Inspection',
    location: 'Storage Tank Farm',
    address: '890 Tank Farm Road',
    date: 'Dec 27, 2024',
    time: '10:30 AM',
    status: 'completed',
    priority: 'low',
    assignee: 'Mike Johnson',
    progress: 100,
  },
  {
    id: 'INS-004',
    title: 'Weld Quality Check',
    location: 'Fabrication Shop B',
    address: '2345 Workshop Lane',
    date: 'Dec 27, 2024',
    time: '03:00 PM',
    status: 'issues',
    priority: 'high',
    assignee: 'Emily Davis',
    issuesCount: 3,
  },
  {
    id: 'INS-005',
    title: 'Pressure Vessel Exam',
    location: 'Processing Plant A',
    address: '678 Process Avenue',
    date: 'Dec 26, 2024',
    time: '08:00 AM',
    status: 'completed',
    priority: 'high',
    assignee: 'Chris Wilson',
    progress: 100,
  },
  {
    id: 'INS-006',
    title: 'Electrical Systems Audit',
    location: 'Control Room 2',
    address: '910 Control Center',
    date: 'Dec 29, 2024',
    time: '11:00 AM',
    status: 'pending',
    priority: 'medium',
    assignee: 'Lisa Brown',
  },
  {
    id: 'INS-007',
    title: 'Fire Suppression Test',
    location: 'Warehouse Complex',
    address: '1122 Storage Drive',
    date: 'Dec 29, 2024',
    time: '04:00 PM',
    status: 'pending',
    priority: 'high',
    assignee: 'Tom Anderson',
  },
  {
    id: 'INS-008',
    title: 'HVAC System Review',
    location: 'Office Building C',
    address: '3344 Corporate Blvd',
    date: 'Dec 25, 2024',
    time: '09:30 AM',
    status: 'issues',
    priority: 'medium',
    assignee: 'Amy Martinez',
    issuesCount: 1,
  },
  {
    id: 'INS-009',
    title: 'Crane Safety Inspection',
    location: 'Loading Dock 5',
    address: '5566 Shipping Port',
    date: 'Dec 24, 2024',
    time: '07:00 AM',
    status: 'completed',
    priority: 'high',
    assignee: 'Robert Taylor',
    progress: 100,
  },
  {
    id: 'INS-010',
    title: 'Tank Level Calibration',
    location: 'Measurement Station',
    address: '7788 Calibration Rd',
    date: 'Dec 30, 2024',
    time: '01:00 PM',
    status: 'in_progress',
    priority: 'low',
    assignee: 'Jennifer Lee',
    progress: 68,
  },
];

// ============================================
// STATUS CONFIGURATION
// ============================================
const getStatusConfig = (status: InspectionStatus) => {
  const configs = {
    pending: {
      label: 'Pending',
      color: COLORS.warning,
      bgColor: 'rgba(255, 184, 0, 0.15)',
      icon: Clock,
    },
    in_progress: {
      label: 'In Progress',
      color: COLORS.info,
      bgColor: 'rgba(59, 130, 246, 0.15)',
      icon: PlayCircle,
    },
    completed: {
      label: 'Completed',
      color: COLORS.success,
      bgColor: 'rgba(0, 214, 143, 0.15)',
      icon: CheckCircle,
    },
    issues: {
      label: 'Issues Found',
      color: COLORS.error,
      bgColor: 'rgba(255, 71, 87, 0.15)',
      icon: AlertTriangle,
    },
  };
  return configs[status];
};

const getPriorityConfig = (priority: Inspection['priority']) => {
  const configs = {
    low: { label: 'Low', color: COLORS.textMuted },
    medium: { label: 'Medium', color: COLORS.warning },
    high: { label: 'High', color: COLORS.error },
  };
  return configs[priority];
};

// ============================================
// FILTER CHIPS DATA
// ============================================
const FILTER_CHIPS: FilterChip[] = [
  { id: 'all', label: 'All', value: 'all' },
  { id: 'pending', label: 'Pending', value: 'pending', icon: Clock },
  { id: 'in_progress', label: 'In Progress', value: 'in_progress', icon: PlayCircle },
  { id: 'completed', label: 'Completed', value: 'completed', icon: CheckCircle },
  { id: 'issues', label: 'Issues', value: 'issues', icon: AlertTriangle },
];

// ============================================
// SUB-COMPONENTS
// ============================================

// Header Component
interface HeaderProps {
  title: string;
  inspectionCount: number;
}

const Header: React.FC<HeaderProps> = ({ title, inspectionCount }) => (
  <View style={styles.header}>
    <View style={styles.headerLeft}>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerBadge}>
        <Text style={styles.headerBadgeText}>{inspectionCount} total</Text>
      </View>
    </View>
    <TouchableOpacity style={styles.headerButton} activeOpacity={0.7}>
      <SlidersHorizontal size={20} color={COLORS.textPrimary} />
    </TouchableOpacity>
  </View>
);

// Search Bar Component
interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
}

const SearchBar: React.FC<SearchBarProps> = ({ value, onChangeText, onClear }) => {
  const [isFocused, setIsFocused] = useState(false);
  const animatedBorder = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animatedBorder, {
      toValue: isFocused ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [isFocused, animatedBorder]);

  const borderColor = animatedBorder.interpolate({
    inputRange: [0, 1],
    outputRange: [COLORS.borderLight, COLORS.primary],
  });

  return (
    <Animated.View
      style={[
        styles.searchContainer,
        { borderColor },
      ]}
    >
      <Search size={20} color={isFocused ? COLORS.primary : COLORS.textMuted} />
      <TextInput
        style={styles.searchInput}
        placeholder="Search inspections..."
        placeholderTextColor={COLORS.textMuted}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {value.length > 0 && (
        <TouchableOpacity
          style={styles.searchClearButton}
          onPress={onClear}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <X size={18} color={COLORS.textMuted} />
        </TouchableOpacity>
      )}
    </Animated.View>
  );
};

// Filter Chip Component
interface FilterChipComponentProps {
  chip: FilterChip;
  isActive: boolean;
  count: number;
  onPress: () => void;
}

const FilterChipComponent: React.FC<FilterChipComponentProps> = ({
  chip,
  isActive,
  count,
  onPress,
}) => {
  const Icon = chip.icon;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      friction: 5,
      tension: 200,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 5,
      tension: 200,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[
          styles.filterChip,
          isActive && styles.filterChipActive,
        ]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.8}
      >
        {isActive && (
          <View style={styles.filterChipGlow} />
        )}
        {Icon && (
          <Icon
            size={14}
            color={isActive ? COLORS.surfaceDark : COLORS.textMuted}
          />
        )}
        <Text
          style={[
            styles.filterChipText,
            isActive && styles.filterChipTextActive,
          ]}
        >
          {chip.label}
        </Text>
        {count > 0 && (
          <View
            style={[
              styles.filterChipCount,
              isActive && styles.filterChipCountActive,
            ]}
          >
            <Text
              style={[
                styles.filterChipCountText,
                isActive && styles.filterChipCountTextActive,
              ]}
            >
              {count}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

// Filter Chips Row
interface FilterChipsRowProps {
  chips: FilterChip[];
  activeFilter: InspectionStatus | 'all';
  onFilterChange: (filter: InspectionStatus | 'all') => void;
  inspections: Inspection[];
}

const FilterChipsRow: React.FC<FilterChipsRowProps> = ({
  chips,
  activeFilter,
  onFilterChange,
  inspections,
}) => {
  const getCount = (value: InspectionStatus | 'all') => {
    if (value === 'all') return inspections.length;
    return inspections.filter((i) => i.status === value).length;
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterChipsContainer}
    >
      {chips.map((chip) => (
        <FilterChipComponent
          key={chip.id}
          chip={chip}
          isActive={activeFilter === chip.value}
          count={getCount(chip.value)}
          onPress={() => onFilterChange(chip.value)}
        />
      ))}
    </ScrollView>
  );
};

// Inspection Card Component
interface InspectionCardProps {
  inspection: Inspection;
  onPress: () => void;
  index: number;
}

const InspectionCard: React.FC<InspectionCardProps> = ({ inspection, onPress, index }) => {
  const statusConfig = getStatusConfig(inspection.status);
  const priorityConfig = getPriorityConfig(inspection.priority);
  const StatusIcon = statusConfig.icon;

  const animatedValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: 1,
      duration: 400,
      delay: index * 50,
      useNativeDriver: true,
    }).start();
  }, [animatedValue, index]);

  const translateY = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [30, 0],
  });

  return (
    <Animated.View
      style={{
        opacity: animatedValue,
        transform: [{ translateY }],
      }}
    >
      <TouchableOpacity
        style={styles.inspectionCard}
        onPress={onPress}
        activeOpacity={0.85}
      >
        {/* Left Accent Bar */}
        <View
          style={[styles.cardAccent, { backgroundColor: statusConfig.color }]}
        />

        {/* Card Content */}
        <View style={styles.cardContent}>
          {/* Header Row */}
          <View style={styles.cardHeader}>
            <View style={styles.cardIdContainer}>
              <Text style={styles.cardId}>#{inspection.id}</Text>
              {inspection.priority === 'high' && (
                <View style={styles.priorityBadge}>
                  <AlertTriangle size={10} color={COLORS.error} />
                  <Text style={styles.priorityText}>High Priority</Text>
                </View>
              )}
            </View>
            <View
              style={[styles.statusBadge, { backgroundColor: statusConfig.bgColor }]}
            >
              <StatusIcon size={12} color={statusConfig.color} />
              <Text style={[styles.statusText, { color: statusConfig.color }]}>
                {statusConfig.label}
              </Text>
            </View>
          </View>

          {/* Title */}
          <Text style={styles.cardTitle} numberOfLines={1}>
            {inspection.title}
          </Text>

          {/* Info Row */}
          <View style={styles.cardInfoRow}>
            <View style={styles.cardInfoItem}>
              <MapPin size={14} color={COLORS.textMuted} />
              <Text style={styles.cardInfoText} numberOfLines={1}>
                {inspection.location}
              </Text>
            </View>
          </View>

          {/* Bottom Row */}
          <View style={styles.cardBottomRow}>
            <View style={styles.cardDateContainer}>
              <Calendar size={14} color={COLORS.primary} />
              <Text style={styles.cardDateText}>{inspection.date}</Text>
              <View style={styles.cardTimeDivider} />
              <Clock size={14} color={COLORS.secondary} />
              <Text style={styles.cardTimeText}>{inspection.time}</Text>
            </View>

            {/* Progress or Issues Count */}
            {inspection.status === 'in_progress' && inspection.progress !== undefined && (
              <View style={styles.progressContainer}>
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${inspection.progress}%` },
                    ]}
                  />
                </View>
                <Text style={styles.progressText}>{inspection.progress}%</Text>
              </View>
            )}
            {inspection.status === 'issues' && inspection.issuesCount && (
              <View style={styles.issuesContainer}>
                <AlertTriangle size={14} color={COLORS.error} />
                <Text style={styles.issuesText}>
                  {inspection.issuesCount} issue{inspection.issuesCount > 1 ? 's' : ''}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Chevron */}
        <View style={styles.cardChevron}>
          <ChevronRight size={20} color={COLORS.textMuted} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Empty State Component
interface EmptyStateProps {
  type: 'no_results' | 'no_data';
  searchQuery?: string;
  onClearSearch?: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ type, searchQuery, onClearSearch }) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  if (type === 'no_results') {
    return (
      <View style={styles.emptyStateContainer}>
        <Animated.View
          style={[
            styles.emptyStateIconContainer,
            { transform: [{ scale: pulseAnim }] },
          ]}
        >
          <LinearGradient
            colors={['rgba(0, 245, 255, 0.1)', 'rgba(123, 97, 255, 0.1)']}
            style={styles.emptyStateGradient}
          >
            <FileSearch size={56} color={COLORS.primary} />
          </LinearGradient>
        </Animated.View>
        <Text style={styles.emptyStateTitle}>No Results Found</Text>
        <Text style={styles.emptyStateSubtitle}>
          We couldn't find any inspections matching{'\n'}
          <Text style={styles.emptyStateQuery}>"{searchQuery}"</Text>
        </Text>
        <TouchableOpacity
          style={styles.emptyStateClearButton}
          onPress={onClearSearch}
          activeOpacity={0.8}
        >
          <X size={16} color={COLORS.primary} />
          <Text style={styles.emptyStateClearText}>Clear Search</Text>
        </TouchableOpacity>

        {/* Suggestions */}
        <View style={styles.suggestionsContainer}>
          <Text style={styles.suggestionsTitle}>Suggestions:</Text>
          <View style={styles.suggestionsList}>
            <View style={styles.suggestionItem}>
              <Sparkles size={14} color={COLORS.textMuted} />
              <Text style={styles.suggestionText}>Check your spelling</Text>
            </View>
            <View style={styles.suggestionItem}>
              <Sparkles size={14} color={COLORS.textMuted} />
              <Text style={styles.suggestionText}>Try different keywords</Text>
            </View>
            <View style={styles.suggestionItem}>
              <Sparkles size={14} color={COLORS.textMuted} />
              <Text style={styles.suggestionText}>Search by inspection ID</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.emptyStateContainer}>
      <Animated.View
        style={[
          styles.emptyStateIconContainer,
          { transform: [{ scale: pulseAnim }] },
        ]}
      >
        <LinearGradient
          colors={['rgba(0, 245, 255, 0.1)', 'rgba(123, 97, 255, 0.1)']}
          style={styles.emptyStateGradient}
        >
          <ClipboardList size={56} color={COLORS.primary} />
        </LinearGradient>
      </Animated.View>
      <Text style={styles.emptyStateTitle}>No Inspections</Text>
      <Text style={styles.emptyStateSubtitle}>
        There are no inspections in this category yet.
      </Text>
    </View>
  );
};

// Sort Button Component
interface SortButtonProps {
  onPress: () => void;
}

const SortButton: React.FC<SortButtonProps> = ({ onPress }) => (
  <TouchableOpacity style={styles.sortButton} onPress={onPress} activeOpacity={0.7}>
    <ArrowUpDown size={16} color={COLORS.textSecondary} />
    <Text style={styles.sortButtonText}>Sort by Date</Text>
  </TouchableOpacity>
);

// Results Count Component
interface ResultsCountProps {
  count: number;
  filterLabel: string;
}

const ResultsCount: React.FC<ResultsCountProps> = ({ count, filterLabel }) => (
  <View style={styles.resultsContainer}>
    <Text style={styles.resultsText}>
      Showing <Text style={styles.resultsCount}>{count}</Text> {filterLabel} inspection{count !== 1 ? 's' : ''}
    </Text>
    <SortButton onPress={() => console.log('Sort pressed')} />
  </View>
);

// ============================================
// MAIN SCREEN COMPONENT
// ============================================
const InspectionListScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  
  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<InspectionStatus | 'all'>('all');
  const [refreshing, setRefreshing] = useState(false);

  // Filtered inspections
  const filteredInspections = useMemo(() => {
    let result = [...MOCK_INSPECTIONS];

    // Apply status filter
    if (activeFilter !== 'all') {
      result = result.filter((inspection) => inspection.status === activeFilter);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(
        (inspection) =>
          inspection.id.toLowerCase().includes(query) ||
          inspection.title.toLowerCase().includes(query) ||
          inspection.location.toLowerCase().includes(query) ||
          inspection.assignee.toLowerCase().includes(query)
      );
    }

    return result;
  }, [activeFilter, searchQuery]);

  // Get filter label for results count
  const getFilterLabel = useCallback(() => {
    if (activeFilter === 'all') return '';
    const chip = FILTER_CHIPS.find((c) => c.value === activeFilter);
    return chip?.label.toLowerCase() || '';
  }, [activeFilter]);

  // Handlers
  const handleSearchChange = useCallback((text: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSearchQuery(text);
  }, []);

  const handleSearchClear = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSearchQuery('');
  }, []);

  const handleFilterChange = useCallback((filter: InspectionStatus | 'all') => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveFilter(filter);
  }, []);

  const handleInspectionPress = useCallback(
    (inspectionId: string) => {
      navigation.navigate('InspectionDetail', { inspectionId });
    },
    [navigation]
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setRefreshing(false);
  }, []);

  // Render item
  const renderInspectionCard = useCallback(
    ({ item, index }: { item: Inspection; index: number }) => (
      <InspectionCard
        inspection={item}
        onPress={() => handleInspectionPress(item.id)}
        index={index}
      />
    ),
    [handleInspectionPress]
  );

  // Key extractor
  const keyExtractor = useCallback((item: Inspection) => item.id, []);

  // List header
  const ListHeader = useMemo(
    () => (
      <ResultsCount count={filteredInspections.length} filterLabel={getFilterLabel()} />
    ),
    [filteredInspections.length, getFilterLabel]
  );

  // Empty component
  const ListEmpty = useMemo(() => {
    if (searchQuery.trim()) {
      return (
        <EmptyState
          type="no_results"
          searchQuery={searchQuery}
          onClearSearch={handleSearchClear}
        />
      );
    }
    return <EmptyState type="no_data" />;
  }, [searchQuery, handleSearchClear]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />

      {/* Header */}
      <Header title="All Inspections" inspectionCount={MOCK_INSPECTIONS.length} />

      {/* Search Bar */}
      <View style={styles.searchSection}>
        <SearchBar
          value={searchQuery}
          onChangeText={handleSearchChange}
          onClear={handleSearchClear}
        />
      </View>

      {/* Filter Chips */}
      <FilterChipsRow
        chips={FILTER_CHIPS}
        activeFilter={activeFilter}
        onFilterChange={handleFilterChange}
        inspections={MOCK_INSPECTIONS}
      />

      {/* Inspections List */}
      <FlatList
        data={filteredInspections}
        renderItem={renderInspectionCard}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.listContent,
          filteredInspections.length === 0 && styles.listContentEmpty,
        ]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={filteredInspections.length > 0 ? ListHeader : null}
        ListEmptyComponent={ListEmpty}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
            progressBackgroundColor={COLORS.surface}
          />
        }
        ItemSeparatorComponent={() => <View style={styles.listSeparator} />}
      />
    </SafeAreaView>
  );
};

// ============================================
// STYLES
// ============================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  // Header Styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  headerBadge: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  headerBadgeText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },

  // Search Section
  searchSection: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 52,
    borderWidth: 1.5,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: COLORS.textPrimary,
    marginLeft: 12,
    marginRight: 8,
  },
  searchClearButton: {
    padding: 4,
  },

  // Filter Chips
  filterChipsContainer: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 10,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    gap: 6,
    position: 'relative',
    overflow: 'hidden',
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterChipGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.primary,
    opacity: 0.2,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  filterChipTextActive: {
    color: COLORS.surfaceDark,
  },
  filterChipCount: {
    backgroundColor: COLORS.surfaceLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 2,
  },
  filterChipCountActive: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  filterChipCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  filterChipCountTextActive: {
    color: COLORS.surfaceDark,
  },

  // Results Container
  resultsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  resultsText: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  resultsCount: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  sortButtonText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },

  // List
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 120,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  listSeparator: {
    height: 12,
  },

  // Inspection Card
  inspectionCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  cardAccent: {
    width: 4,
  },
  cardContent: {
    flex: 1,
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  cardIdContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardId: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: 0.5,
  },
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 71, 87, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 4,
  },
  priorityText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.error,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 5,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 10,
  },
  cardInfoRow: {
    marginBottom: 12,
  },
  cardInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardInfoText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    flex: 1,
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardDateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardDateText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  cardTimeDivider: {
    width: 1,
    height: 12,
    backgroundColor: COLORS.borderLight,
    marginHorizontal: 4,
  },
  cardTimeText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressBar: {
    width: 60,
    height: 6,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.info,
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.info,
  },
  issuesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 71, 87, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  issuesText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.error,
  },
  cardChevron: {
    justifyContent: 'center',
    paddingRight: 12,
  },

  // Empty State
  emptyStateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 60,
  },
  emptyStateIconContainer: {
    marginBottom: 24,
  },
  emptyStateGradient: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  emptyStateTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyStateSubtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  emptyStateQuery: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  emptyStateClearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 32,
  },
  emptyStateClearText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  suggestionsContainer: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  suggestionsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  suggestionsList: {
    gap: 10,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  suggestionText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
});

export default InspectionListScreen;
