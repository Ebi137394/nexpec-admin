import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  TextInput,
  Animated,
  Dimensions,
  LayoutAnimation,
  Platform,
  UIManager,
  Alert,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  X,
  Check,
  XCircle,
  Minus,
  ChevronDown,
  ChevronRight,
  Camera,
  Image as ImageIcon,
  AlertTriangle,
  Shield,
  Wrench,
  Gauge,
  Zap,
  Trash2,
  Send,
  CheckCircle2,
  CircleDot,
  FileText,
  LucideIcon,
} from 'lucide-react-native';

// Import navigation types
import { RootStackParamList } from '../navigation/types';

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
  passGlow: 'rgba(0, 214, 143, 0.3)',
  failGlow: 'rgba(255, 71, 87, 0.3)',
  naGlow: 'rgba(100, 116, 139, 0.3)',
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ============================================
// TYPE DEFINITIONS
// ============================================
type ItemStatus = 'pending' | 'pass' | 'fail' | 'na';

interface Photo {
  id: string;
  uri: string;
  timestamp: string;
}

interface ChecklistItem {
  id: string;
  title: string;
  description?: string;
  required: boolean;
}

interface ChecklistItemState {
  status: ItemStatus;
  defectNotes: string;
  photos: Photo[];
}

interface Category {
  id: string;
  title: string;
  icon: LucideIcon | React.ComponentType<{ size: number; color: string }>;
  items: ChecklistItem[];
}

interface CategoryState {
  isExpanded: boolean;
}

// ============================================
// MOCK DATA
// ============================================
const INSPECTION_CATEGORIES: Category[] = [
  {
    id: 'cat-1',
    title: 'Safety Check',
    icon: Shield,
    items: [
      { id: 'item-1-1', title: 'Emergency shutoff valves accessible', description: 'Verify all emergency shutoff valves are clearly marked and accessible', required: true },
      { id: 'item-1-2', title: 'Safety signage in place', description: 'Check all required safety signs are visible', required: true },
      { id: 'item-1-3', title: 'Fire extinguishers inspected', description: 'Verify inspection tags are current', required: true },
      { id: 'item-1-4', title: 'PPE storage accessible', description: 'Personal protective equipment properly stored', required: false },
    ],
  },
  {
    id: 'cat-2',
    title: 'Structural Integrity',
    icon: Wrench,
    items: [
      { id: 'item-2-1', title: 'No visible cracks or damage', description: 'Inspect all structural components for damage', required: true },
      { id: 'item-2-2', title: 'Support brackets secure', description: 'Check all mounting brackets and supports', required: true },
      { id: 'item-2-3', title: 'Foundation stable', description: 'Verify foundation shows no signs of settling', required: true },
    ],
  },
  {
    id: 'cat-3',
    title: 'Pressure Systems',
    icon: Gauge,
    items: [
      { id: 'item-3-1', title: 'Pressure gauge readings normal', description: 'All gauges within acceptable range', required: true },
      { id: 'item-3-2', title: 'Relief valves functional', description: 'Test pressure relief mechanisms', required: true },
      { id: 'item-3-3', title: 'No visible leaks', description: 'Inspect all joints and connections', required: true },
      { id: 'item-3-4', title: 'Pressure test documentation', description: 'Verify recent pressure test records', required: false },
    ],
  },
  {
    id: 'cat-4',
    title: 'Electrical Systems',
    icon: Zap,
    items: [
      { id: 'item-4-1', title: 'Wiring insulation intact', description: 'Check for damaged or exposed wiring', required: true },
      { id: 'item-4-2', title: 'Grounding verified', description: 'Confirm proper electrical grounding', required: true },
      { id: 'item-4-3', title: 'Control panels functional', description: 'Test all control panel indicators', required: true },
    ],
  },
];

// ============================================
// UTILITY FUNCTIONS
// ============================================
const generatePhotoId = () => `photo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const getInitialItemStates = (): Record<string, ChecklistItemState> => {
  const states: Record<string, ChecklistItemState> = {};
  INSPECTION_CATEGORIES.forEach(category => {
    category.items.forEach(item => {
      states[item.id] = {
        status: 'pending',
        defectNotes: '',
        photos: [],
      };
    });
  });
  return states;
};

const getInitialCategoryStates = (): Record<string, CategoryState> => {
  const states: Record<string, CategoryState> = {};
  INSPECTION_CATEGORIES.forEach((category, index) => {
    states[category.id] = {
      isExpanded: index === 0, // First category expanded by default
    };
  });
  return states;
};

// ============================================
// SUB-COMPONENTS
// ============================================

// Header Component
interface HeaderProps {
  onClose: () => void;
  onSubmit: () => void;
  canSubmit: boolean;
}

const Header: React.FC<HeaderProps> = ({ onClose, onSubmit, canSubmit }) => (
  <View style={styles.header}>
    <TouchableOpacity
      style={styles.headerButton}
      onPress={onClose}
      activeOpacity={0.7}
    >
      <X size={24} color={COLORS.textPrimary} />
    </TouchableOpacity>
    
    <View style={styles.headerTitleContainer}>
      <Text style={styles.headerTitle}>Inspection</Text>
      <Text style={styles.headerSubtitle}>INS-2024-001</Text>
    </View>
    
    <TouchableOpacity
      style={[
        styles.submitButton,
        !canSubmit && styles.submitButtonDisabled,
      ]}
      onPress={onSubmit}
      activeOpacity={0.7}
      disabled={!canSubmit}
    >
      <Send size={18} color={canSubmit ? COLORS.surfaceDark : COLORS.textMuted} />
      <Text style={[
        styles.submitButtonText,
        !canSubmit && styles.submitButtonTextDisabled,
      ]}>
        Submit
      </Text>
    </TouchableOpacity>
  </View>
);

// Progress Bar Component
interface ProgressBarProps {
  completed: number;
  total: number;
  passCount: number;
  failCount: number;
  naCount: number;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  completed,
  total,
  passCount,
  failCount,
  naCount,
}) => {
  const percentage = total > 0 ? (completed / total) * 100 : 0;
  const isComplete = completed === total;

  return (
    <View style={styles.progressContainer}>
      <View style={styles.progressHeader}>
        <View style={styles.progressTitleRow}>
          <Text style={styles.progressTitle}>Progress</Text>
          <Text style={[
            styles.progressPercentage,
            isComplete && styles.progressComplete,
          ]}>
            {completed}/{total} items
          </Text>
        </View>
        <View style={styles.progressStats}>
          <View style={styles.progressStat}>
            <View style={[styles.progressStatDot, { backgroundColor: COLORS.success }]} />
            <Text style={styles.progressStatText}>{passCount} Pass</Text>
          </View>
          <View style={styles.progressStat}>
            <View style={[styles.progressStatDot, { backgroundColor: COLORS.error }]} />
            <Text style={styles.progressStatText}>{failCount} Fail</Text>
          </View>
          <View style={styles.progressStat}>
            <View style={[styles.progressStatDot, { backgroundColor: COLORS.textMuted }]} />
            <Text style={styles.progressStatText}>{naCount} N/A</Text>
          </View>
        </View>
      </View>
      <View style={styles.progressBarContainer}>
        <View style={styles.progressBarBackground}>
          <Animated.View
            style={[
              styles.progressBarFill,
              {
                width: `${percentage}%`,
                backgroundColor: isComplete ? COLORS.success : COLORS.primary,
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
};

// Status Button Component
interface StatusButtonProps {
  type: 'pass' | 'fail' | 'na';
  isActive: boolean;
  onPress: () => void;
}

const StatusButton: React.FC<StatusButtonProps> = ({ type, isActive, onPress }) => {
  const config = {
    pass: {
      icon: Check,
      label: 'Pass',
      color: COLORS.success,
      glowColor: COLORS.passGlow,
      bgColor: 'rgba(0, 214, 143, 0.15)',
    },
    fail: {
      icon: XCircle,
      label: 'Fail',
      color: COLORS.error,
      glowColor: COLORS.failGlow,
      bgColor: 'rgba(255, 71, 87, 0.15)',
    },
    na: {
      icon: Minus,
      label: 'N/A',
      color: COLORS.textMuted,
      glowColor: COLORS.naGlow,
      bgColor: 'rgba(100, 116, 139, 0.15)',
    },
  };

  const { icon: Icon, label, color, glowColor, bgColor } = config[type];

  return (
    <TouchableOpacity
      style={[
        styles.statusButton,
        { backgroundColor: isActive ? bgColor : 'transparent' },
        isActive && {
          borderColor: color,
          shadowColor: color,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.5,
          shadowRadius: 8,
          elevation: 4,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Icon
        size={18}
        color={isActive ? color : COLORS.textMuted}
      />
      <Text style={[
        styles.statusButtonText,
        { color: isActive ? color : COLORS.textMuted },
      ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

// Photo Thumbnail Component
interface PhotoThumbnailProps {
  photo: Photo;
  onRemove: () => void;
}

const PhotoThumbnail: React.FC<PhotoThumbnailProps> = ({ photo, onRemove }) => (
  <View style={styles.photoThumbnail}>
    <View style={styles.photoPlaceholder}>
      <ImageIcon size={24} color={COLORS.primary} />
      <Text style={styles.photoPlaceholderText}>Image</Text>
    </View>
    <TouchableOpacity
      style={styles.photoRemoveButton}
      onPress={onRemove}
      activeOpacity={0.7}
    >
      <Trash2 size={14} color={COLORS.error} />
    </TouchableOpacity>
  </View>
);

// Add Photo Button Component
interface AddPhotoButtonProps {
  onPress: () => void;
}

const AddPhotoButton: React.FC<AddPhotoButtonProps> = ({ onPress }) => (
  <TouchableOpacity
    style={styles.addPhotoButton}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <Camera size={22} color={COLORS.primary} />
    <Text style={styles.addPhotoText}>Add Photo</Text>
  </TouchableOpacity>
);

// Defect Details Component (shown when Fail is selected)
interface DefectDetailsProps {
  notes: string;
  photos: Photo[];
  onNotesChange: (text: string) => void;
  onAddPhoto: () => void;
  onRemovePhoto: (photoId: string) => void;
}

const DefectDetails: React.FC<DefectDetailsProps> = ({
  notes,
  photos,
  onNotesChange,
  onAddPhoto,
  onRemovePhoto,
}) => (
  <Animated.View style={styles.defectContainer}>
    <View style={styles.defectHeader}>
      <AlertTriangle size={16} color={COLORS.warning} />
      <Text style={styles.defectTitle}>Defect Details</Text>
    </View>
    
    <TextInput
      style={styles.defectInput}
      placeholder="Describe the issue found..."
      placeholderTextColor={COLORS.textMuted}
      value={notes}
      onChangeText={onNotesChange}
      multiline
      numberOfLines={3}
      textAlignVertical="top"
    />
    
    <View style={styles.photosSection}>
      <Text style={styles.photosSectionTitle}>Evidence Photos</Text>
      <View style={styles.photosRow}>
        {photos.map(photo => (
          <PhotoThumbnail
            key={photo.id}
            photo={photo}
            onRemove={() => onRemovePhoto(photo.id)}
          />
        ))}
        {photos.length < 4 && (
          <AddPhotoButton onPress={onAddPhoto} />
        )}
      </View>
    </View>
  </Animated.View>
);

// Checklist Item Component
interface ChecklistItemComponentProps {
  item: ChecklistItem;
  state: ChecklistItemState;
  onStatusChange: (status: ItemStatus) => void;
  onNotesChange: (notes: string) => void;
  onAddPhoto: () => void;
  onRemovePhoto: (photoId: string) => void;
}

const ChecklistItemComponent: React.FC<ChecklistItemComponentProps> = ({
  item,
  state,
  onStatusChange,
  onNotesChange,
  onAddPhoto,
  onRemovePhoto,
}) => {
  const handleStatusPress = (newStatus: ItemStatus) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onStatusChange(newStatus === state.status ? 'pending' : newStatus);
  };

  const getStatusIndicator = () => {
    switch (state.status) {
      case 'pass':
        return <CheckCircle2 size={20} color={COLORS.success} />;
      case 'fail':
        return <XCircle size={20} color={COLORS.error} />;
      case 'na':
        return <Minus size={20} color={COLORS.textMuted} />;
      default:
        return <CircleDot size={20} color={COLORS.textMuted} />;
    }
  };

  return (
    <View style={[
      styles.checklistItem,
      state.status !== 'pending' && styles.checklistItemCompleted,
      state.status === 'fail' && styles.checklistItemFailed,
    ]}>
      <View style={styles.checklistItemHeader}>
        <View style={styles.checklistItemTitleRow}>
          {getStatusIndicator()}
          <View style={styles.checklistItemTitleContainer}>
            <View style={styles.checklistItemTitleWrapper}>
              <Text style={[
                styles.checklistItemTitle,
                state.status !== 'pending' && styles.checklistItemTitleCompleted,
              ]}>
                {item.title}
              </Text>
              {item.required && (
                <View style={styles.requiredBadge}>
                  <Text style={styles.requiredText}>Required</Text>
                </View>
              )}
            </View>
            {item.description && (
              <Text style={styles.checklistItemDescription}>
                {item.description}
              </Text>
            )}
          </View>
        </View>
      </View>
      
      <View style={styles.statusButtonsRow}>
        <StatusButton
          type="pass"
          isActive={state.status === 'pass'}
          onPress={() => handleStatusPress('pass')}
        />
        <StatusButton
          type="fail"
          isActive={state.status === 'fail'}
          onPress={() => handleStatusPress('fail')}
        />
        <StatusButton
          type="na"
          isActive={state.status === 'na'}
          onPress={() => handleStatusPress('na')}
        />
      </View>
      
      {state.status === 'fail' && (
        <DefectDetails
          notes={state.defectNotes}
          photos={state.photos}
          onNotesChange={onNotesChange}
          onAddPhoto={onAddPhoto}
          onRemovePhoto={onRemovePhoto}
        />
      )}
    </View>
  );
};

// Category Accordion Component
interface CategoryAccordionProps {
  category: Category;
  isExpanded: boolean;
  onToggle: () => void;
  itemStates: Record<string, ChecklistItemState>;
  onItemStatusChange: (itemId: string, status: ItemStatus) => void;
  onItemNotesChange: (itemId: string, notes: string) => void;
  onItemAddPhoto: (itemId: string) => void;
  onItemRemovePhoto: (itemId: string, photoId: string) => void;
}

const CategoryAccordion: React.FC<CategoryAccordionProps> = ({
  category,
  isExpanded,
  onToggle,
  itemStates,
  onItemStatusChange,
  onItemNotesChange,
  onItemAddPhoto,
  onItemRemovePhoto,
}) => {
  const Icon = category.icon;
  
  const completedCount = category.items.filter(
    item => itemStates[item.id]?.status !== 'pending'
  ).length;
  
  const hasFailures = category.items.some(
    item => itemStates[item.id]?.status === 'fail'
  );
  
  const allComplete = completedCount === category.items.length;

  const handleToggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle();
  };

  return (
    <View style={styles.categoryContainer}>
      <TouchableOpacity
        style={[
          styles.categoryHeader,
          isExpanded && styles.categoryHeaderExpanded,
          hasFailures && styles.categoryHeaderWithFailure,
          allComplete && !hasFailures && styles.categoryHeaderComplete,
        ]}
        onPress={handleToggle}
        activeOpacity={0.7}
      >
        <View style={styles.categoryHeaderLeft}>
          <View style={[
            styles.categoryIconContainer,
            hasFailures && styles.categoryIconContainerFailure,
            allComplete && !hasFailures && styles.categoryIconContainerComplete,
          ]}>
            <Icon size={20} color={
              hasFailures ? COLORS.error :
              allComplete ? COLORS.success :
              COLORS.primary
            } />
          </View>
          <View style={styles.categoryTitleContainer}>
            <Text style={styles.categoryTitle}>{category.title}</Text>
            <Text style={styles.categoryProgress}>
              {completedCount} of {category.items.length} completed
            </Text>
          </View>
        </View>
        <View style={styles.categoryHeaderRight}>
          {allComplete && (
            <View style={[
              styles.categoryCompleteBadge,
              hasFailures && styles.categoryCompleteBadgeFailure,
            ]}>
              {hasFailures ? (
                <AlertTriangle size={14} color={COLORS.error} />
              ) : (
                <Check size={14} color={COLORS.success} />
              )}
            </View>
          )}
          {isExpanded ? (
            <ChevronDown size={24} color={COLORS.textSecondary} />
          ) : (
            <ChevronRight size={24} color={COLORS.textSecondary} />
          )}
        </View>
      </TouchableOpacity>
      
      {isExpanded && (
        <View style={styles.categoryContent}>
          {category.items.map((item, index) => (
            <View key={item.id}>
              <ChecklistItemComponent
                item={item}
                state={itemStates[item.id]}
                onStatusChange={(status) => onItemStatusChange(item.id, status)}
                onNotesChange={(notes) => onItemNotesChange(item.id, notes)}
                onAddPhoto={() => onItemAddPhoto(item.id)}
                onRemovePhoto={(photoId) => onItemRemovePhoto(item.id, photoId)}
              />
              {index < category.items.length - 1 && (
                <View style={styles.itemDivider} />
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

// ============================================
// MAIN SCREEN COMPONENT
// ============================================
const InspectionExecutionScreen: React.FC = () => {
  const navigation = useNavigation();
  
  // State
  const [itemStates, setItemStates] = useState<Record<string, ChecklistItemState>>(
    getInitialItemStates
  );
  const [categoryStates, setCategoryStates] = useState<Record<string, CategoryState>>(
    getInitialCategoryStates
  );

  // Calculate progress stats
  const progressStats = useMemo(() => {
    const allItems = Object.values(itemStates);
    const total = allItems.length;
    const completed = allItems.filter(item => item.status !== 'pending').length;
    const passCount = allItems.filter(item => item.status === 'pass').length;
    const failCount = allItems.filter(item => item.status === 'fail').length;
    const naCount = allItems.filter(item => item.status === 'na').length;
    
    return { total, completed, passCount, failCount, naCount };
  }, [itemStates]);

  const canSubmit = progressStats.completed === progressStats.total;

  // Handlers
  const handleClose = useCallback(() => {
    Alert.alert(
      'Exit Inspection',
      'Your progress will be saved. Are you sure you want to exit?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Exit', style: 'destructive', onPress: () => navigation.goBack() },
      ]
    );
  }, [navigation]);

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    
    Alert.alert(
      'Submit Inspection',
      `You have completed all ${progressStats.total} items.\n\n• ${progressStats.passCount} Passed\n• ${progressStats.failCount} Failed\n• ${progressStats.naCount} N/A\n\nSubmit this inspection report?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: () => {
            console.log('Submitting inspection:', itemStates);
            
            // 👇 Navigate to Success Screen
            navigation.navigate('InspectionSuccess' as never);
          },
        },
      ]
    );
  }, [canSubmit, progressStats, itemStates, navigation]);

  const handleCategoryToggle = useCallback((categoryId: string) => {
    setCategoryStates(prev => ({
      ...prev,
      [categoryId]: {
        ...prev[categoryId],
        isExpanded: !prev[categoryId].isExpanded,
      },
    }));
  }, []);

  const handleItemStatusChange = useCallback((itemId: string, status: ItemStatus) => {
    setItemStates(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        status,
        // Clear defect notes and photos if status is not fail
        defectNotes: status === 'fail' ? prev[itemId].defectNotes : '',
        photos: status === 'fail' ? prev[itemId].photos : [],
      },
    }));
  }, []);

  const handleItemNotesChange = useCallback((itemId: string, notes: string) => {
    setItemStates(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        defectNotes: notes,
      },
    }));
  }, []);

  const handleItemAddPhoto = useCallback((itemId: string) => {
    // Simulate adding a photo
    const newPhoto: Photo = {
      id: generatePhotoId(),
      uri: 'dummy-uri',
      timestamp: new Date().toISOString(),
    };
    
    setItemStates(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        photos: [...prev[itemId].photos, newPhoto],
      },
    }));
  }, []);

  const handleItemRemovePhoto = useCallback((itemId: string, photoId: string) => {
    setItemStates(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        photos: prev[itemId].photos.filter(p => p.id !== photoId),
      },
    }));
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      
      {/* Header */}
      <Header
        onClose={handleClose}
        onSubmit={handleSubmit}
        canSubmit={canSubmit}
      />
      
      {/* Sticky Progress Bar */}
      <ProgressBar
        completed={progressStats.completed}
        total={progressStats.total}
        passCount={progressStats.passCount}
        failCount={progressStats.failCount}
        naCount={progressStats.naCount}
      />
      
      {/* Scrollable Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Categories */}
        {INSPECTION_CATEGORIES.map((category, index) => (
          <CategoryAccordion
            key={category.id}
            category={category}
            isExpanded={categoryStates[category.id]?.isExpanded || false}
            onToggle={() => handleCategoryToggle(category.id)}
            itemStates={itemStates}
            onItemStatusChange={handleItemStatusChange}
            onItemNotesChange={handleItemNotesChange}
            onItemAddPhoto={handleItemAddPhoto}
            onItemRemovePhoto={handleItemRemovePhoto}
          />
        ))}
        
        {/* Bottom Summary */}
        <View style={styles.bottomSummary}>
          <View style={styles.summaryCard}>
            <FileText size={20} color={COLORS.primary} />
            <Text style={styles.summaryText}>
              Complete all items to submit the inspection report
            </Text>
          </View>
        </View>
      </ScrollView>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
    backgroundColor: COLORS.surface,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  headerTitleContainer: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    gap: 6,
  },
  submitButtonDisabled: {
    backgroundColor: COLORS.surfaceLight,
  },
  submitButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.surfaceDark,
  },
  submitButtonTextDisabled: {
    color: COLORS.textMuted,
  },
  
  // Progress Bar Styles
  progressContainer: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  progressHeader: {
    marginBottom: 10,
  },
  progressTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  progressPercentage: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
  },
  progressComplete: {
    color: COLORS.success,
  },
  progressStats: {
    flexDirection: 'row',
    gap: 16,
  },
  progressStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressStatDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  progressStatText: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  progressBarContainer: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarBackground: {
    flex: 1,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 4,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  
  // ScrollView
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  
  // Category Styles
  categoryContainer: {
    marginBottom: 16,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    overflow: 'hidden',
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  categoryHeaderExpanded: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  categoryHeaderWithFailure: {
    backgroundColor: 'rgba(255, 71, 87, 0.05)',
  },
  categoryHeaderComplete: {
    backgroundColor: 'rgba(0, 214, 143, 0.05)',
  },
  categoryHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  categoryIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 245, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryIconContainerFailure: {
    backgroundColor: 'rgba(255, 71, 87, 0.15)',
  },
  categoryIconContainerComplete: {
    backgroundColor: 'rgba(0, 214, 143, 0.15)',
  },
  categoryTitleContainer: {
    flex: 1,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  categoryProgress: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  categoryHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryCompleteBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 214, 143, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryCompleteBadgeFailure: {
    backgroundColor: 'rgba(255, 71, 87, 0.2)',
  },
  categoryContent: {
    padding: 12,
  },
  
  // Checklist Item Styles
  checklistItem: {
    backgroundColor: COLORS.surfaceDark,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  checklistItemCompleted: {
    borderColor: 'rgba(0, 245, 255, 0.2)',
  },
  checklistItemFailed: {
    borderColor: 'rgba(255, 71, 87, 0.3)',
    backgroundColor: 'rgba(255, 71, 87, 0.05)',
  },
  checklistItemHeader: {
    marginBottom: 12,
  },
  checklistItemTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checklistItemTitleContainer: {
    flex: 1,
  },
  checklistItemTitleWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  checklistItemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textPrimary,
    flex: 1,
  },
  checklistItemTitleCompleted: {
    // Keep same style, status indicator shows state
  },
  requiredBadge: {
    backgroundColor: 'rgba(255, 184, 0, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  requiredText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.warning,
    textTransform: 'uppercase',
  },
  checklistItemDescription: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 4,
    lineHeight: 18,
  },
  
  // Status Buttons
  statusButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statusButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    gap: 6,
  },
  statusButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  
  // Defect Details
  defectContainer: {
    marginTop: 14,
    padding: 14,
    backgroundColor: 'rgba(255, 184, 0, 0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 184, 0, 0.2)',
  },
  defectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  defectTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.warning,
  },
  defectInput: {
    backgroundColor: COLORS.surfaceDark,
    borderRadius: 10,
    padding: 12,
    minHeight: 80,
    color: COLORS.textPrimary,
    fontSize: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    marginBottom: 12,
  },
  photosSection: {
    gap: 8,
  },
  photosSectionTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  photosRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  
  // Photo Thumbnail
  photoThumbnail: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    position: 'relative',
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  photoPlaceholderText: {
    fontSize: 10,
    color: COLORS.primary,
    fontWeight: '500',
  },
  photoRemoveButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.surfaceDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  
  // Add Photo Button
  addPhotoButton: {
    width: 72,
    height: 72,
    borderRadius: 10,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 245, 255, 0.05)',
    gap: 4,
  },
  addPhotoText: {
    fontSize: 10,
    color: COLORS.primary,
    fontWeight: '600',
  },
  
  // Item Divider
  itemDivider: {
    height: 10,
  },
  
  // Bottom Summary
  bottomSummary: {
    marginTop: 8,
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    gap: 10,
  },
  summaryText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
});

export default InspectionExecutionScreen;
