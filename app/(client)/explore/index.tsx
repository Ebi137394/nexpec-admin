import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  RefreshControl,
  Animated,
  Platform,
  Dimensions,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Search,
  Filter,
  MapPin,
  Star,
  CheckCircle2,
  Clock,
  Briefcase,
  ChevronRight,
  X,
  SlidersHorizontal,
  User,
  Shield,
  Zap,
  Award,
  TrendingUp,
  DollarSign,
  ChevronDown,
  Check,
  Circle,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { showAlert } from '@/lib/alert';

// ============================================================================
// TYPES
// ============================================================================

interface Inspector {
  id: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  is_verified: boolean;
  is_available: boolean;
  hourly_rate: number | null;
  years_experience: number;
  skills: string[];
  ndt_methods: string[];
  certifications: string[];
  location_display: string;
  rating_average: number;
  rating_count: number;
  completed_jobs_count: number;
  response_time_hours: number;
  is_featured: boolean;
  availability_status: 'online' | 'recently_active' | 'offline';
  relevance_score: number;
}

interface FilterState {
  ndtMethods: Set<string>;
  location: string | null;
  minRating: number | null;
  isVerified: boolean | null;
  isAvailable: boolean | null;
  sortBy: SortOption;
}

type SortOption = 'rating' | 'reviews' | 'experience' | 'jobs' | 'price_low' | 'price_high' | 'relevance';

// ============================================================================
// CONSTANTS
// ============================================================================

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const NDT_METHODS = [
  { id: 'UT', label: 'Ultrasonic', fullName: 'Ultrasonic Testing', color: '#3B82F6' },
  { id: 'RT', label: 'Radiographic', fullName: 'Radiographic Testing', color: '#8B5CF6' },
  { id: 'MT', label: 'Magnetic', fullName: 'Magnetic Particle', color: '#EF4444' },
  { id: 'PT', label: 'Penetrant', fullName: 'Liquid Penetrant', color: '#F59E0B' },
  { id: 'VT', label: 'Visual', fullName: 'Visual Testing', color: '#22C55E' },
  { id: 'CWI', label: 'CWI', fullName: 'Certified Welding Inspector', color: '#06B6D4' },
];

const LOCATIONS = [
  { id: 'montreal', label: 'Montreal', state: 'QC' },
  { id: 'toronto', label: 'Toronto', state: 'ON' },
  { id: 'calgary', label: 'Calgary', state: 'AB' },
  { id: 'vancouver', label: 'Vancouver', state: 'BC' },
  { id: 'edmonton', label: 'Edmonton', state: 'AB' },
  { id: 'ottawa', label: 'Ottawa', state: 'ON' },
];

const SORT_OPTIONS: { id: SortOption; label: string; icon: any }[] = [
  { id: 'rating', label: 'Highest Rated', icon: Star },
  { id: 'reviews', label: 'Most Reviews', icon: TrendingUp },
  { id: 'experience', label: 'Most Experienced', icon: Award },
  { id: 'jobs', label: 'Most Jobs Done', icon: Briefcase },
  { id: 'price_low', label: 'Price: Low to High', icon: DollarSign },
  { id: 'price_high', label: 'Price: High to Low', icon: DollarSign },
];

const INITIAL_FILTERS: FilterState = {
  ndtMethods: new Set(),
  location: null,
  minRating: null,
  isVerified: null,
  isAvailable: null,
  sortBy: 'rating',
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const formatRating = (rating: number): string => {
  return rating?.toFixed(1) || '0.0';
};

const formatHourlyRate = (rate: number | null): string => {
  if (!rate) return 'Rate TBD';
  return `$${rate}/hr`;
};

const getAvailabilityColor = (status: string): string => {
  switch (status) {
    case 'online': return '#22C55E';
    case 'recently_active': return '#F59E0B';
    default: return '#94A3B8';
  }
};

const getAvailabilityLabel = (status: string): string => {
  switch (status) {
    case 'online': return 'Online Now';
    case 'recently_active': return 'Recently Active';
    default: return 'Offline';
  }
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// Search Header Component
interface SearchHeaderProps {
  searchQuery: string;
  onSearchChange: (text: string) => void;
  onFilterPress: () => void;
  activeFiltersCount: number;
}

const SearchHeader: React.FC<SearchHeaderProps> = ({
  searchQuery,
  onSearchChange,
  onFilterPress,
  activeFiltersCount,
}) => (
  <View style={styles.searchHeader}>
    <View style={styles.searchContainer}>
      <Search size={20} color="#64748B" style={styles.searchIcon} />
      <TextInput
        style={styles.searchInput}
        placeholder="Search inspectors, skills, certifications..."
        placeholderTextColor="#94A3B8"
        value={searchQuery}
        onChangeText={onSearchChange}
        returnKeyType="search"
      />
      {searchQuery.length > 0 && (
        <TouchableOpacity
          onPress={() => onSearchChange('')}
          style={styles.clearButton}
          activeOpacity={0.7}
        >
          <X size={18} color="#94A3B8" />
        </TouchableOpacity>
      )}
    </View>
    
    <TouchableOpacity
      style={[styles.filterButton, activeFiltersCount > 0 && styles.filterButtonActive]}
      onPress={onFilterPress}
      activeOpacity={0.8}
    >
      <SlidersHorizontal size={20} color={activeFiltersCount > 0 ? '#FFFFFF' : '#64748B'} />
      {activeFiltersCount > 0 && (
        <View style={styles.filterBadge}>
          <Text style={styles.filterBadgeText}>{activeFiltersCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  </View>
);

// NDT Method Filter Chips
interface NDTFilterChipsProps {
  selectedMethods: Set<string>;
  onToggle: (method: string) => void;
}

const NDTFilterChips: React.FC<NDTFilterChipsProps> = ({ selectedMethods, onToggle }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.ndtChipsContainer}
  >
    {NDT_METHODS.map((method) => {
      const isSelected = selectedMethods.has(method.id);
      return (
        <TouchableOpacity
          key={method.id}
          style={[
            styles.ndtChip,
            isSelected && { backgroundColor: method.color + '20', borderColor: method.color },
          ]}
          onPress={() => onToggle(method.id)}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.ndtChipDot,
              { backgroundColor: isSelected ? method.color : '#CBD5E1' },
            ]}
          />
          <Text
            style={[
              styles.ndtChipText,
              isSelected && { color: method.color, fontWeight: '600' },
            ]}
          >
            {method.label}
          </Text>
          {isSelected && (
            <X size={14} color={method.color} style={{ marginLeft: 4 }} />
          )}
        </TouchableOpacity>
      );
    })}
  </ScrollView>
);

// Location Filter Chips
interface LocationFilterChipsProps {
  selectedLocation: string | null;
  onSelect: (location: string | null) => void;
}

const LocationFilterChips: React.FC<LocationFilterChipsProps> = ({
  selectedLocation,
  onSelect,
}) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.locationChipsContainer}
  >
    <TouchableOpacity
      style={[styles.locationChip, !selectedLocation && styles.locationChipActive]}
      onPress={() => onSelect(null)}
      activeOpacity={0.7}
    >
      <MapPin size={14} color={!selectedLocation ? '#FFFFFF' : '#64748B'} />
      <Text style={[styles.locationChipText, !selectedLocation && styles.locationChipTextActive]}>
        All Locations
      </Text>
    </TouchableOpacity>
    
    {LOCATIONS.map((loc) => {
      const isSelected = selectedLocation === loc.label;
      return (
        <TouchableOpacity
          key={loc.id}
          style={[styles.locationChip, isSelected && styles.locationChipActive]}
          onPress={() => onSelect(isSelected ? null : loc.label)}
          activeOpacity={0.7}
        >
          <Text style={[styles.locationChipText, isSelected && styles.locationChipTextActive]}>
            {loc.label}
          </Text>
        </TouchableOpacity>
      );
    })}
  </ScrollView>
);

// Sort Selector Component
interface SortSelectorProps {
  currentSort: SortOption;
  onSortChange: (sort: SortOption) => void;
  resultCount: number;
}

const SortSelector: React.FC<SortSelectorProps> = ({ currentSort, onSortChange, resultCount }) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const currentOption = SORT_OPTIONS.find((opt) => opt.id === currentSort);

  return (
    <View style={styles.sortContainer}>
      <Text style={styles.resultCount}>
        {resultCount} inspector{resultCount !== 1 ? 's' : ''} found
      </Text>
      
      <TouchableOpacity
        style={styles.sortButton}
        onPress={() => setShowDropdown(true)}
        activeOpacity={0.7}
      >
        <Text style={styles.sortButtonText}>{currentOption?.label}</Text>
        <ChevronDown size={16} color="#64748B" />
      </TouchableOpacity>

      <Modal visible={showDropdown} transparent animationType="fade">
        <TouchableOpacity
          style={styles.sortModalOverlay}
          onPress={() => setShowDropdown(false)}
          activeOpacity={1}
        >
          <View style={styles.sortDropdown}>
            <Text style={styles.sortDropdownTitle}>Sort By</Text>
            {SORT_OPTIONS.map((option) => {
              const IconComponent = option.icon;
              const isSelected = option.id === currentSort;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[styles.sortOption, isSelected && styles.sortOptionSelected]}
                  onPress={() => {
                    onSortChange(option.id);
                    setShowDropdown(false);
                  }}
                  activeOpacity={0.7}
                >
                  <IconComponent
                    size={18}
                    color={isSelected ? '#3B82F6' : '#64748B'}
                  />
                  <Text
                    style={[styles.sortOptionText, isSelected && styles.sortOptionTextSelected]}
                  >
                    {option.label}
                  </Text>
                  {isSelected && <Check size={18} color="#3B82F6" />}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

// Inspector Card Component
interface InspectorCardProps {
  inspector: Inspector;
  onPress: (inspector: Inspector) => void;
}

const InspectorCard: React.FC<InspectorCardProps> = ({ inspector, onPress }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      useNativeDriver: true,
    }).start();
  };

  const availabilityColor = getAvailabilityColor(inspector.availability_status);

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={() => onPress(inspector)}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View
        style={[styles.inspectorCard, { transform: [{ scale: scaleAnim }] }]}
      >
        {/* Featured Badge */}
        {inspector.is_featured && (
          <View style={styles.featuredBadge}>
            <Zap size={12} color="#FFFFFF" />
            <Text style={styles.featuredBadgeText}>Featured</Text>
          </View>
        )}

        {/* Header */}
        <View style={styles.cardHeader}>
          {/* Avatar */}
          <View style={styles.avatarContainer}>
            {inspector.avatar_url ? (
              <Image source={{ uri: inspector.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <User size={28} color="#64748B" />
              </View>
            )}
            
            {/* Online Indicator */}
            <View style={[styles.onlineIndicator, { backgroundColor: availabilityColor }]} />
            
            {/* Verified Badge */}
            {inspector.is_verified && (
              <View style={styles.verifiedBadge}>
                <CheckCircle2 size={18} color="#3B82F6" fill="#FFFFFF" />
              </View>
            )}
          </View>

          {/* Info */}
          <View style={styles.cardInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.inspectorName} numberOfLines={1}>
                {inspector.full_name}
              </Text>
              {inspector.is_verified && (
                <Shield size={14} color="#3B82F6" style={{ marginLeft: 4 }} />
              )}
            </View>

            {/* Rating */}
            <View style={styles.ratingRow}>
              <Star size={14} color="#FBBF24" fill="#FBBF24" />
              <Text style={styles.ratingValue}>{formatRating(inspector.rating_average)}</Text>
              <Text style={styles.ratingCount}>({inspector.rating_count} reviews)</Text>
            </View>

            {/* Location */}
            <View style={styles.locationRow}>
              <MapPin size={12} color="#64748B" />
              <Text style={styles.locationText} numberOfLines={1}>
                {inspector.location_display || 'Location not set'}
              </Text>
            </View>
          </View>

          {/* Rate */}
          <View style={styles.rateContainer}>
            <Text style={styles.rateValue}>
              {inspector.hourly_rate ? `$${inspector.hourly_rate}` : '-'}
            </Text>
            <Text style={styles.rateLabel}>/hr</Text>
          </View>
        </View>

        {/* NDT Methods */}
        {inspector.ndt_methods && inspector.ndt_methods.length > 0 && (
          <View style={styles.methodsContainer}>
            {inspector.ndt_methods.slice(0, 4).map((method) => {
              const methodConfig = NDT_METHODS.find((m) => m.id === method);
              return (
                <View
                  key={method}
                  style={[
                    styles.methodTag,
                    { backgroundColor: (methodConfig?.color || '#64748B') + '15' },
                  ]}
                >
                  <Text
                    style={[styles.methodTagText, { color: methodConfig?.color || '#64748B' }]}
                  >
                    {method}
                  </Text>
                </View>
              );
            })}
            {inspector.ndt_methods.length > 4 && (
              <View style={styles.methodTagMore}>
                <Text style={styles.methodTagMoreText}>
                  +{inspector.ndt_methods.length - 4}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Skills Preview */}
        {inspector.skills && inspector.skills.length > 0 && (
          <Text style={styles.skillsPreview} numberOfLines={1}>
            {inspector.skills.slice(0, 3).join(' • ')}
          </Text>
        )}

        {/* Stats Footer */}
        <View style={styles.cardFooter}>
          <View style={styles.statItem}>
            <Briefcase size={14} color="#64748B" />
            <Text style={styles.statText}>{inspector.completed_jobs_count} jobs</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Award size={14} color="#64748B" />
            <Text style={styles.statText}>{inspector.years_experience} yrs exp</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Clock size={14} color="#64748B" />
            <Text style={styles.statText}>
              {inspector.response_time_hours}h response
            </Text>
          </View>
        </View>

        {/* View Profile Arrow */}
        <View style={styles.viewProfileArrow}>
          <ChevronRight size={20} color="#CBD5E1" />
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
};

// Filter Modal Component
interface FilterModalProps {
  visible: boolean;
  filters: FilterState;
  onClose: () => void;
  onApply: (filters: FilterState) => void;
  onReset: () => void;
}

const FilterModal: React.FC<FilterModalProps> = ({
  visible,
  filters,
  onClose,
  onApply,
  onReset,
}) => {
  const [localFilters, setLocalFilters] = useState<FilterState>(filters);

  useEffect(() => {
    setLocalFilters(filters);
  }, [filters, visible]);

  const toggleNdtMethod = (method: string) => {
    const newMethods = new Set(localFilters.ndtMethods);
    if (newMethods.has(method)) {
      newMethods.delete(method);
    } else {
      newMethods.add(method);
    }
    setLocalFilters({ ...localFilters, ndtMethods: newMethods });
  };

  const handleApply = () => {
    onApply(localFilters);
    onClose();
  };

  const handleReset = () => {
    setLocalFilters(INITIAL_FILTERS);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.filterModalContainer}>
        {/* Header */}
        <View style={styles.filterModalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.filterModalClose}>
            <X size={24} color="#0F172A" />
          </TouchableOpacity>
          <Text style={styles.filterModalTitle}>Filters</Text>
          <TouchableOpacity onPress={handleReset}>
            <Text style={styles.filterModalReset}>Reset</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.filterModalContent}>
          {/* NDT Methods */}
          <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle}>NDT Methods</Text>
            <View style={styles.filterGrid}>
              {NDT_METHODS.map((method) => {
                const isSelected = localFilters.ndtMethods.has(method.id);
                return (
                  <TouchableOpacity
                    key={method.id}
                    style={[
                      styles.filterGridItem,
                      isSelected && { backgroundColor: method.color + '20', borderColor: method.color },
                    ]}
                    onPress={() => toggleNdtMethod(method.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.filterCheckbox, isSelected && { borderColor: method.color }]}>
                      {isSelected && <Check size={14} color={method.color} />}
                    </View>
                    <Text style={[styles.filterGridText, isSelected && { color: method.color }]}>
                      {method.fullName}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Location */}
          <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle}>Location</Text>
            <View style={styles.filterGrid}>
              {LOCATIONS.map((loc) => {
                const isSelected = localFilters.location === loc.label;
                return (
                  <TouchableOpacity
                    key={loc.id}
                    style={[styles.filterGridItem, isSelected && styles.filterGridItemActive]}
                    onPress={() =>
                      setLocalFilters({
                        ...localFilters,
                        location: isSelected ? null : loc.label,
                      })
                    }
                    activeOpacity={0.7}
                  >
                    <View style={[styles.filterCheckbox, isSelected && styles.filterCheckboxActive]}>
                      {isSelected && <Check size={14} color="#3B82F6" />}
                    </View>
                    <Text style={[styles.filterGridText, isSelected && styles.filterGridTextActive]}>
                      {loc.label}, {loc.state}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Minimum Rating */}
          <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle}>Minimum Rating</Text>
            <View style={styles.ratingFilterRow}>
              {[null, 4, 4.5, 4.8].map((rating) => {
                const isSelected = localFilters.minRating === rating;
                return (
                  <TouchableOpacity
                    key={rating?.toString() || 'any'}
                    style={[styles.ratingFilterBtn, isSelected && styles.ratingFilterBtnActive]}
                    onPress={() => setLocalFilters({ ...localFilters, minRating: rating })}
                    activeOpacity={0.7}
                  >
                    {rating ? (
                      <View style={styles.ratingFilterContent}>
                        <Star size={14} color={isSelected ? '#FFFFFF' : '#FBBF24'} fill={isSelected ? '#FFFFFF' : '#FBBF24'} />
                        <Text style={[styles.ratingFilterText, isSelected && styles.ratingFilterTextActive]}>
                          {rating}+
                        </Text>
                      </View>
                    ) : (
                      <Text style={[styles.ratingFilterText, isSelected && styles.ratingFilterTextActive]}>
                        Any
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Verification & Availability */}
          <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle}>Other Filters</Text>
            
            <TouchableOpacity
              style={styles.toggleFilter}
              onPress={() =>
                setLocalFilters({
                  ...localFilters,
                  isVerified: localFilters.isVerified ? null : true,
                })
              }
              activeOpacity={0.7}
            >
              <View style={styles.toggleFilterLeft}>
                <Shield size={20} color="#3B82F6" />
                <View>
                  <Text style={styles.toggleFilterTitle}>Verified Only</Text>
                  <Text style={styles.toggleFilterSubtitle}>
                    Show only verified inspectors
                  </Text>
                </View>
              </View>
              <View
                style={[
                  styles.toggleSwitch,
                  localFilters.isVerified && styles.toggleSwitchActive,
                ]}
              >
                <View
                  style={[
                    styles.toggleKnob,
                    localFilters.isVerified && styles.toggleKnobActive,
                  ]}
                />
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toggleFilter}
              onPress={() =>
                setLocalFilters({
                  ...localFilters,
                  isAvailable: localFilters.isAvailable ? null : true,
                })
              }
              activeOpacity={0.7}
            >
              <View style={styles.toggleFilterLeft}>
                <Circle size={20} color="#22C55E" fill="#22C55E" />
                <View>
                  <Text style={styles.toggleFilterTitle}>Available Now</Text>
                  <Text style={styles.toggleFilterSubtitle}>
                    Show only available inspectors
                  </Text>
                </View>
              </View>
              <View
                style={[
                  styles.toggleSwitch,
                  localFilters.isAvailable && styles.toggleSwitchActive,
                ]}
              >
                <View
                  style={[
                    styles.toggleKnob,
                    localFilters.isAvailable && styles.toggleKnobActive,
                  ]}
                />
              </View>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.filterModalFooter}>
          <TouchableOpacity
            style={styles.applyFilterBtn}
            onPress={handleApply}
            activeOpacity={0.8}
          >
            <Filter size={20} color="#FFFFFF" />
            <Text style={styles.applyFilterText}>Apply Filters</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

// Empty State Component
interface EmptyStateProps {
  hasFilters: boolean;
  onClearFilters: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ hasFilters, onClearFilters }) => (
  <View style={styles.emptyState}>
    <View style={styles.emptyStateIcon}>
      <Search size={48} color="#CBD5E1" />
    </View>
    <Text style={styles.emptyStateTitle}>
      {hasFilters ? 'No inspectors found' : 'Discover Inspectors'}
    </Text>
    <Text style={styles.emptyStateText}>
      {hasFilters
        ? 'Try adjusting your filters or search terms'
        : 'Search for qualified inspectors in your area'}
    </Text>
    {hasFilters && (
      <TouchableOpacity
        style={styles.emptyStateClearBtn}
        onPress={onClearFilters}
        activeOpacity={0.8}
      >
        <Text style={styles.emptyStateClearText}>Clear Filters</Text>
      </TouchableOpacity>
    )}
  </View>
);

// Loading State
const LoadingState: React.FC = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#3B82F6" />
    <Text style={styles.loadingText}>Finding inspectors...</Text>
  </View>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ExploreScreen() {
  const router = useRouter();

  // State
  const [inspectors, setInspectors] = useState<Inspector[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  // Debounced search
  const searchTimeoutRef = useRef<NodeJS.Timeout>();

  // Calculate active filters count
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filters.ndtMethods.size > 0) count++;
    if (filters.location) count++;
    if (filters.minRating) count++;
    if (filters.isVerified) count++;
    if (filters.isAvailable) count++;
    return count;
  }, [filters]);

  // ========================================
  // DATA FETCHING
  // ========================================

  const fetchInspectors = useCallback(
    async (pageNum: number = 0, isRefresh: boolean = false) => {
      if (pageNum === 0) {
        setLoading(true);
      }

      try {
        // Try RPC function first, fallback to direct query
        let query = supabase
          .from('profiles')
          .select(`
            id,
            first_name,
            last_name,
            avatar_url,
            bio,
            is_verified,
            is_available,
            hourly_rate,
            years_experience,
            skills,
            ndt_methods,
            certifications,
            location_city,
            location_province,
            rating_average,
            rating_count,
            completed_jobs_count,
            response_time_hours,
            is_featured,
            availability_status
          `)
          .eq('role', 'inspector')
          .eq('is_active', true);

        // Apply filters
        if (filters.isVerified) {
          query = query.eq('is_verified', true);
        }
        if (filters.isAvailable) {
          query = query.eq('is_available', true);
        }
        if (filters.location) {
          query = query.ilike('location_city', `%${filters.location}%`);
        }
        if (filters.minRating) {
          query = query.gte('rating_average', filters.minRating);
        }

        // Apply NDT methods filter
        if (filters.ndtMethods.size > 0) {
          query = query.contains('ndt_methods', Array.from(filters.ndtMethods));
        }

        // Apply search
        if (searchQuery) {
          query = query.or(`first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%,bio.ilike.%${searchQuery}%,skills.cs.{${searchQuery}}`);
        }

        // Apply sorting
        let orderBy = 'rating_average';
        let ascending = false;
        switch (filters.sortBy) {
          case 'rating':
            orderBy = 'rating_average';
            ascending = false;
            break;
          case 'reviews':
            orderBy = 'rating_count';
            ascending = false;
            break;
          case 'experience':
            orderBy = 'years_experience';
            ascending = false;
            break;
          case 'jobs':
            orderBy = 'completed_jobs_count';
            ascending = false;
            break;
          case 'price_low':
            orderBy = 'hourly_rate';
            ascending = true;
            break;
          case 'price_high':
            orderBy = 'hourly_rate';
            ascending = false;
            break;
        }

        query = query.order(orderBy, { ascending });

        // Pagination
        const limit = 20;
        query = query.range(pageNum * limit, (pageNum + 1) * limit - 1);

        const { data, error } = await query;

        if (error) throw error;

        const results = (data || []).map((profile: any) => ({
          id: profile.id,
          full_name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
          avatar_url: profile.avatar_url,
          bio: profile.bio,
          is_verified: profile.is_verified || false,
          is_available: profile.is_available || false,
          hourly_rate: profile.hourly_rate,
          years_experience: profile.years_experience || 0,
          skills: profile.skills || [],
          ndt_methods: profile.ndt_methods || [],
          certifications: profile.certifications || [],
          location_display: profile.location_city
            ? `${profile.location_city}${profile.location_province ? `, ${profile.location_province}` : ''}`
            : '',
          rating_average: profile.rating_average || 0,
          rating_count: profile.rating_count || 0,
          completed_jobs_count: profile.completed_jobs_count || 0,
          response_time_hours: profile.response_time_hours || 24,
          is_featured: profile.is_featured || false,
          availability_status: profile.availability_status || 'offline',
          relevance_score: 0,
        })) as Inspector[];

        if (pageNum === 0 || isRefresh) {
          setInspectors(results);
        } else {
          setInspectors((prev) => [...prev, ...results]);
        }

        setHasMore(results.length === 20);
        setPage(pageNum);
      } catch (error) {
        console.error('Fetch inspectors error:', error);
        showAlert('Error', 'Failed to load inspectors. Please try again.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [searchQuery, filters]
  );

  // Initial load and filter changes
  useEffect(() => {
    fetchInspectors(0);
  }, [fetchInspectors]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      fetchInspectors(0);
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  // ========================================
  // HANDLERS
  // ========================================

  const handleRefresh = () => {
    setRefreshing(true);
    fetchInspectors(0, true);
  };

  const handleLoadMore = () => {
    if (!loading && hasMore) {
      fetchInspectors(page + 1);
    }
  };

  const handleNdtMethodToggle = (method: string) => {
    const newMethods = new Set(filters.ndtMethods);
    if (newMethods.has(method)) {
      newMethods.delete(method);
    } else {
      newMethods.add(method);
    }
    setFilters({ ...filters, ndtMethods: newMethods });
  };

  const handleLocationSelect = (location: string | null) => {
    setFilters({ ...filters, location });
  };

  const handleSortChange = (sortBy: SortOption) => {
    setFilters({ ...filters, sortBy });
  };

  const handleApplyFilters = (newFilters: FilterState) => {
    setFilters(newFilters);
  };

  const handleClearFilters = () => {
    setFilters(INITIAL_FILTERS);
    setSearchQuery('');
  };

  const handleInspectorPress = async (inspector: Inspector) => {
    // Try to increment profile view (if RPC exists)
    try {
      await supabase.rpc('increment_profile_views', { p_inspector_id: inspector.id });
    } catch (error) {
      // RPC might not exist, that's okay
      console.log('Profile views increment not available');
    }
    
    // Navigate to inspector profile
    router.push(`/(client)/inspector/${inspector.id}`);
  };

  // ========================================
  // RENDER
  // ========================================

  const renderInspector = ({ item }: { item: Inspector }) => (
    <InspectorCard inspector={item} onPress={handleInspectorPress} />
  );

  const renderFooter = () => {
    if (!hasMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color="#3B82F6" />
      </View>
    );
  };

  const hasActiveFilters = activeFiltersCount > 0 || searchQuery.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.headerSection}>
        <Text style={styles.pageTitle}>Find Inspectors</Text>
        <Text style={styles.pageSubtitle}>
          Discover qualified NDT professionals
        </Text>
      </View>

      {/* Search */}
      <SearchHeader
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onFilterPress={() => setShowFilterModal(true)}
        activeFiltersCount={activeFiltersCount}
      />

      {/* NDT Method Chips */}
      <NDTFilterChips
        selectedMethods={filters.ndtMethods}
        onToggle={handleNdtMethodToggle}
      />

      {/* Location Chips */}
      <LocationFilterChips
        selectedLocation={filters.location}
        onSelect={handleLocationSelect}
      />

      {/* Sort Selector */}
      {!loading && inspectors.length > 0 && (
        <SortSelector
          currentSort={filters.sortBy}
          onSortChange={handleSortChange}
          resultCount={inspectors.length}
        />
      )}

      {/* Results */}
      {loading && inspectors.length === 0 ? (
        <LoadingState />
      ) : inspectors.length === 0 ? (
        <EmptyState hasFilters={hasActiveFilters} onClearFilters={handleClearFilters} />
      ) : (
        <FlatList
          data={inspectors}
          keyExtractor={(item) => item.id}
          renderItem={renderInspector}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#3B82F6"
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={renderFooter}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        />
      )}

      {/* Filter Modal */}
      <FilterModal
        visible={showFilterModal}
        filters={filters}
        onClose={() => setShowFilterModal(false)}
        onApply={handleApplyFilters}
        onReset={handleClearFilters}
      />
    </SafeAreaView>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },

  // Header Section
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  pageTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    fontSize: 15,
    color: '#64748B',
    marginTop: 4,
  },

  // Search Header
  searchHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 12,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 52,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#0F172A',
  },
  clearButton: {
    padding: 4,
  },
  filterButton: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterButtonActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#EF4444',
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // NDT Chips
  ndtChipsContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  ndtChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 8,
  },
  ndtChipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  ndtChipText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },

  // Location Chips
  locationChipsContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 8,
    gap: 6,
  },
  locationChipActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  locationChipText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  locationChipTextActive: {
    color: '#FFFFFF',
  },

  // Sort Container
  sortContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  resultCount: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sortButtonText: {
    fontSize: 14,
    color: '#3B82F6',
    fontWeight: '600',
  },

  // Sort Modal
  sortModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sortDropdown: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  sortDropdownTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 16,
    textAlign: 'center',
  },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 12,
  },
  sortOptionSelected: {
    backgroundColor: '#EFF6FF',
  },
  sortOptionText: {
    flex: 1,
    fontSize: 16,
    color: '#475569',
  },
  sortOptionTextSelected: {
    color: '#3B82F6',
    fontWeight: '600',
  },

  // List
  listContent: {
    padding: 16,
    paddingTop: 4,
  },
  footerLoader: {
    paddingVertical: 20,
  },

  // Inspector Card
  inspectorCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  featuredBadge: {
    position: 'absolute',
    top: 0,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    backgroundColor: '#F59E0B',
    gap: 4,
  },
  featuredBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    borderColor: '#F1F5F9',
  },
  avatarPlaceholder: {
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  verifiedBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 1,
  },
  cardInfo: {
    flex: 1,
    marginLeft: 14,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  inspectorName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  ratingValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  ratingCount: {
    fontSize: 13,
    color: '#64748B',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {
    fontSize: 13,
    color: '#64748B',
    flex: 1,
  },
  rateContainer: {
    alignItems: 'flex-end',
  },
  rateValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#22C55E',
  },
  rateLabel: {
    fontSize: 12,
    color: '#64748B',
  },

  // Methods
  methodsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  methodTag: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  methodTagText: {
    fontSize: 12,
    fontWeight: '600',
  },
  methodTagMore: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  methodTagMoreText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },

  // Skills
  skillsPreview: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 10,
  },

  // Footer Stats
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  statDivider: {
    width: 1,
    height: 12,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 12,
  },
  viewProfileArrow: {
    position: 'absolute',
    right: 16,
    top: '50%',
    marginTop: -10,
  },

  // Filter Modal
  filterModalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  filterModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  filterModalClose: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -8,
  },
  filterModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  filterModalReset: {
    fontSize: 15,
    fontWeight: '600',
    color: '#EF4444',
  },
  filterModalContent: {
    flex: 1,
    padding: 20,
  },
  filterSection: {
    marginBottom: 28,
  },
  filterSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 14,
  },
  filterGrid: {
    gap: 10,
  },
  filterGridItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    gap: 12,
  },
  filterGridItemActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
  },
  filterCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterCheckboxActive: {
    borderColor: '#3B82F6',
    backgroundColor: '#EFF6FF',
  },
  filterGridText: {
    fontSize: 15,
    color: '#475569',
    fontWeight: '500',
  },
  filterGridTextActive: {
    color: '#3B82F6',
    fontWeight: '600',
  },

  // Rating Filter
  ratingFilterRow: {
    flexDirection: 'row',
    gap: 10,
  },
  ratingFilterBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingFilterBtnActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  ratingFilterContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingFilterText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  ratingFilterTextActive: {
    color: '#FFFFFF',
  },

  // Toggle Filters
  toggleFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 16,
    marginBottom: 12,
  },
  toggleFilterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  toggleFilterTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
  },
  toggleFilterSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  toggleSwitch: {
    width: 52,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E2E8F0',
    padding: 3,
  },
  toggleSwitchActive: {
    backgroundColor: '#3B82F6',
  },
  toggleKnob: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  toggleKnobActive: {
    marginLeft: 20,
  },

  // Filter Modal Footer
  filterModalFooter: {
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 8 : 20,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  applyFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3B82F6',
    paddingVertical: 18,
    borderRadius: 16,
    gap: 10,
  },
  applyFilterText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Empty State
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyStateIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  emptyStateClearBtn: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  emptyStateClearText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // Loading
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#64748B',
    fontWeight: '500',
  },
});

