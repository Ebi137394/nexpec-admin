import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  Animated,
  Dimensions,
  StatusBar,
  ScrollView,
  Alert,
  Platform,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ============================================================================
// THEME & CONSTANTS
// ============================================================================

const COLORS = {
  // Primary Theme
  background: '#0A0E17',
  surface: '#111827',
  surfaceLight: '#1F2937',
  surfaceHighlight: '#252F3F',
  
  // Accent Colors
  primary: '#7C3AED',
  primaryDark: '#6D28D9',
  primaryGlow: 'rgba(124, 58, 237, 0.2)',
  
  // Text Colors
  text: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  
  // Status Colors
  valid: '#10B981',
  validBg: 'rgba(16, 185, 129, 0.15)',
  validBorder: 'rgba(16, 185, 129, 0.4)',
  
  warning: '#F59E0B',
  warningBg: 'rgba(245, 158, 11, 0.15)',
  warningBorder: 'rgba(245, 158, 11, 0.6)',
  
  expired: '#EF4444',
  expiredBg: 'rgba(239, 68, 68, 0.15)',
  expiredBorder: 'rgba(239, 68, 68, 0.6)',
  
  // UI Elements
  border: '#374151',
  inputBg: '#1F2937',
  divider: '#2D3748',
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface Equipment {
  id: string;
  name: string;
  model: string;
  serialNumber: string;
  calibrationDate: Date;
  expiryDate: Date;
  certificateUrl?: string;
  category: string;
  manufacturer?: string;
  notes?: string;
  location?: string;
}

type CalibrationStatus = 'valid' | 'expiring' | 'expired';

interface FormData {
  name: string;
  model: string;
  serialNumber: string;
  calibrationDate: string;
  expiryDate: string;
  category: string;
  manufacturer: string;
  notes: string;
}

// ============================================================================
// MOCK DATA
// ============================================================================

const MOCK_EQUIPMENT: Equipment[] = [
  {
    id: '1',
    name: 'Ultrasonic Thickness Gauge',
    model: 'UTG-200X Pro',
    serialNumber: 'UTG-2024-001542',
    calibrationDate: new Date('2024-01-15'),
    expiryDate: new Date('2025-08-15'), // Valid - more than 30 days
    category: 'Measurement',
    manufacturer: 'Olympus NDT',
    notes: 'Primary gauge for pipeline inspection. Handle with care.',
    location: 'Tool Room A',
  },
  {
    id: '2',
    name: 'Portable Gas Detector',
    model: 'GasPro 5000',
    serialNumber: 'GP5K-2023-089763',
    calibrationDate: new Date('2024-06-01'),
    expiryDate: new Date(Date.now() + 18 * 24 * 60 * 60 * 1000), // Expiring - ~18 days
    category: 'Safety',
    manufacturer: 'MSA Safety',
    notes: 'Multi-gas detector for confined space entry. Check battery before use.',
    location: 'Safety Cabinet B',
  },
  {
    id: '3',
    name: 'Digital Pressure Gauge',
    model: 'DPG-4200',
    serialNumber: 'DPG-2023-045621',
    calibrationDate: new Date('2023-06-10'),
    expiryDate: new Date('2024-06-10'), // Expired
    category: 'Measurement',
    manufacturer: 'Fluke',
    notes: 'High-precision pressure measurement. Requires recalibration.',
    location: 'Tool Room A',
  },
  {
    id: '4',
    name: 'Thermal Imaging Camera',
    model: 'ThermalPro T640',
    serialNumber: 'TIC-2024-112890',
    calibrationDate: new Date('2024-03-20'),
    expiryDate: new Date('2025-03-20'), // Valid
    category: 'Inspection',
    manufacturer: 'FLIR Systems',
    notes: 'Used for electrical and mechanical inspections. Store in padded case.',
    location: 'Inspection Lab',
  },
];

const CATEGORIES = ['Measurement', 'Safety', 'Inspection', 'Testing', 'General'];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const getCalibrationStatus = (expiryDate: Date): CalibrationStatus => {
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  
  if (expiryDate < now) {
    return 'expired';
  } else if (expiryDate < thirtyDaysFromNow) {
    return 'expiring';
  }
  return 'valid';
};

const formatDate = (date: Date): string => {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const getDaysUntilExpiry = (expiryDate: Date): number => {
  const now = new Date();
  const diffTime = expiryDate.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const getStatusConfig = (status: CalibrationStatus) => {
  const configs = {
    valid: {
      label: 'Valid',
      color: COLORS.valid,
      bg: COLORS.validBg,
      border: COLORS.validBorder,
      icon: '✓',
    },
    expiring: {
      label: 'Expiring Soon',
      color: COLORS.warning,
      bg: COLORS.warningBg,
      border: COLORS.warningBorder,
      icon: '⚠',
    },
    expired: {
      label: 'Expired',
      color: COLORS.expired,
      bg: COLORS.expiredBg,
      border: COLORS.expiredBorder,
      icon: '✕',
    },
  };
  return configs[status];
};

const getCategoryIcon = (category: string): string => {
  const icons: Record<string, string> = {
    Measurement: '📏',
    Safety: '🛡️',
    Inspection: '🔍',
    Testing: '🧪',
    General: '🔧',
  };
  return icons[category] || '🔧';
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// Plus Icon Component
const PlusIcon: React.FC<{ size?: number; color?: string }> = ({ 
  size = 20, 
  color = COLORS.background 
}) => (
  <View style={[styles.plusIcon, { width: size, height: size }]}>
    <View style={[styles.plusHorizontal, { backgroundColor: color, width: size, height: 2 }]} />
    <View style={[styles.plusVertical, { backgroundColor: color, width: 2, height: size }]} />
  </View>
);

// Status Badge Component
const StatusBadge: React.FC<{ status: CalibrationStatus; large?: boolean }> = ({ 
  status, 
  large = false 
}) => {
  const config = getStatusConfig(status);
  
  return (
    <Animated.View 
      style={[
        styles.statusBadge, 
        { backgroundColor: config.bg },
        large && styles.statusBadgeLarge,
      ]}
    >
      <View style={[styles.statusDot, { backgroundColor: config.color }]} />
      <Text 
        style={[
          styles.statusText, 
          { color: config.color },
          large && styles.statusTextLarge,
        ]}
      >
        {config.label}
      </Text>
    </Animated.View>
  );
};

// Animated Equipment Card Component
const EquipmentCard: React.FC<{
  item: Equipment;
  onPress: () => void;
  index: number;
}> = ({ item, onPress, index }) => {
  const status = getCalibrationStatus(item.expiryDate);
  const statusConfig = getStatusConfig(status);
  const animatedValue = useRef(new Animated.Value(0)).current;
  const scaleValue = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: 1,
      duration: 500,
      delay: index * 120,
      useNativeDriver: true,
    }).start();
  }, []);

  const handlePressIn = () => {
    Animated.spring(scaleValue, {
      toValue: 0.98,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleValue, {
      toValue: 1,
      friction: 3,
      tension: 100,
      useNativeDriver: true,
    }).start();
  };

  const daysUntil = getDaysUntilExpiry(item.expiryDate);
  const categoryIcon = getCategoryIcon(item.category);

  return (
    <Animated.View
      style={[
        styles.cardContainer,
        {
          opacity: animatedValue,
          transform: [
            {
              translateY: animatedValue.interpolate({
                inputRange: [0, 1],
                outputRange: [40, 0],
              }),
            },
            { scale: scaleValue },
          ],
        },
      ]}
    >
      <Pressable
        style={[
          styles.card,
          { borderColor: status !== 'valid' ? statusConfig.border : COLORS.border },
          status !== 'valid' && { borderWidth: 1.5 },
        ]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        {/* Glow Effect for Warning/Expired */}
        {status !== 'valid' && (
          <View 
            style={[
              styles.cardGlow, 
              { backgroundColor: statusConfig.bg }
            ]} 
          />
        )}

        {/* Card Header */}
        <View style={styles.cardHeader}>
          <View style={[styles.cardIcon, { backgroundColor: COLORS.surfaceLight }]}>
            <Text style={styles.cardIconText}>{categoryIcon}</Text>
          </View>
          <View style={styles.cardTitleContainer}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.cardModel} numberOfLines={1}>
              {item.model}
            </Text>
          </View>
          <StatusBadge status={status} />
        </View>

        {/* Divider */}
        <View style={styles.cardDivider} />

        {/* Card Details */}
        <View style={styles.cardDetails}>
          <View style={styles.detailRow}>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Serial Number</Text>
              <Text style={styles.detailValue} numberOfLines={1}>
                {item.serialNumber}
              </Text>
            </View>
          </View>

          <View style={styles.detailRow}>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Calibrated</Text>
              <Text style={styles.detailValue}>
                {formatDate(item.calibrationDate)}
              </Text>
            </View>
            <View style={[styles.detailItem, styles.detailItemRight]}>
              <Text style={styles.detailLabel}>Expires</Text>
              <Text
                style={[
                  styles.detailValue,
                  status === 'expired' && { color: COLORS.expired },
                  status === 'expiring' && { color: COLORS.warning },
                ]}
              >
                {formatDate(item.expiryDate)}
              </Text>
            </View>
          </View>
        </View>

        {/* Card Footer */}
        <View style={styles.cardFooter}>
          <View style={styles.categoryContainer}>
            <Text style={styles.categoryTag}>{item.category}</Text>
            {item.location && (
              <Text style={styles.locationText}>📍 {item.location}</Text>
            )}
          </View>
          <View style={styles.expiryInfo}>
            <Text
              style={[
                styles.daysText,
                status === 'expired' && { color: COLORS.expired },
                status === 'expiring' && { color: COLORS.warning },
                status === 'valid' && { color: COLORS.valid },
              ]}
            >
              {status === 'expired' 
                ? `${Math.abs(daysUntil)} days overdue`
                : `${daysUntil} days left`
              }
            </Text>
          </View>
        </View>

        {/* Tap Indicator */}
        <View style={styles.tapIndicator}>
          <Text style={styles.tapIndicatorText}>→</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
};

// Stats Card Component
const StatsCard: React.FC<{
  count: number;
  label: string;
  color: string;
  bgColor: string;
}> = ({ count, label, color, bgColor }) => {
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View 
      style={[
        styles.statItem, 
        { backgroundColor: bgColor, transform: [{ scale: scaleAnim }] }
      ]}
    >
      <Text style={[styles.statNumber, { color }]}>{count}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Animated.View>
  );
};

// Input Field Component
const InputField: React.FC<{
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  required?: boolean;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric';
}> = ({ 
  label, 
  value, 
  onChangeText, 
  placeholder, 
  required = false,
  multiline = false,
  keyboardType = 'default',
}) => (
  <View style={styles.inputGroup}>
    <Text style={styles.inputLabel}>
      {label}
      {required && <Text style={styles.requiredAsterisk}> *</Text>}
    </Text>
    <TextInput
      style={[styles.input, multiline && styles.textArea]}
      placeholder={placeholder}
      placeholderTextColor={COLORS.textMuted}
      value={value}
      onChangeText={onChangeText}
      multiline={multiline}
      numberOfLines={multiline ? 3 : 1}
      keyboardType={keyboardType}
    />
  </View>
);

// ============================================================================
// MAIN SCREEN COMPONENT
// ============================================================================

const EquipmentScreen: React.FC = () => {
  // State
  const [equipment, setEquipment] = useState<Equipment[]>(MOCK_EQUIPMENT);
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isDetailsModalVisible, setIsDetailsModalVisible] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState<FormData>({
    name: '',
    model: '',
    serialNumber: '',
    calibrationDate: '',
    expiryDate: '',
    category: '',
    manufacturer: '',
    notes: '',
  });

  // Animation Refs
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const detailsSlideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const headerAnim = useRef(new Animated.Value(0)).current;

  // Initial header animation
  useEffect(() => {
    Animated.timing(headerAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, []);

  // Calculate Statistics
  const stats = useMemo(() => {
    return {
      total: equipment.length,
      valid: equipment.filter(e => getCalibrationStatus(e.expiryDate) === 'valid').length,
      expiring: equipment.filter(e => getCalibrationStatus(e.expiryDate) === 'expiring').length,
      expired: equipment.filter(e => getCalibrationStatus(e.expiryDate) === 'expired').length,
    };
  }, [equipment]);

  // Modal Control Functions
  const openAddEditModal = (editing: boolean = false, item?: Equipment) => {
    if (editing && item) {
      setFormData({
        name: item.name,
        model: item.model,
        serialNumber: item.serialNumber,
        calibrationDate: formatDate(item.calibrationDate),
        expiryDate: formatDate(item.expiryDate),
        category: item.category,
        manufacturer: item.manufacturer || '',
        notes: item.notes || '',
      });
      setSelectedEquipment(item);
      setIsEditing(true);
    } else {
      resetForm();
      setIsEditing(false);
    }
    
    setIsModalVisible(true);
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const closeAddEditModal = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setIsModalVisible(false);
      setSelectedEquipment(null);
      resetForm();
    });
  };

  const openDetailsModal = (item: Equipment) => {
    setSelectedEquipment(item);
    setIsDetailsModalVisible(true);
    Animated.spring(detailsSlideAnim, {
      toValue: 0,
      tension: 65,
      friction: 11,
      useNativeDriver: true,
    }).start();
  };

  const closeDetailsModal = () => {
    Animated.timing(detailsSlideAnim, {
      toValue: SCREEN_HEIGHT,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setIsDetailsModalVisible(false);
      setSelectedEquipment(null);
    });
  };

  const resetForm = () => {
    setFormData({
      name: '',
      model: '',
      serialNumber: '',
      calibrationDate: '',
      expiryDate: '',
      category: '',
      manufacturer: '',
      notes: '',
    });
    setUploadedFile(null);
  };

  // Action Handlers
  const handleUploadCertificate = () => {
    Alert.alert(
      '📄 Upload Certificate',
      'Select the type of file to upload',
      [
        {
          text: 'Take Photo',
          onPress: () => {
            setUploadedFile('certificate_photo.jpg');
            Alert.alert('Success', 'Photo captured successfully!');
          },
        },
        {
          text: 'Choose PDF',
          onPress: () => {
            setUploadedFile('calibration_cert.pdf');
            Alert.alert('Success', 'PDF selected successfully!');
          },
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ]
    );
  };

  const handleSave = () => {
    // Validation
    if (!formData.name.trim()) {
      Alert.alert('Validation Error', 'Equipment name is required');
      return;
    }
    if (!formData.serialNumber.trim()) {
      Alert.alert('Validation Error', 'Serial number is required');
      return;
    }

    const newEquipment: Equipment = {
      id: isEditing && selectedEquipment 
        ? selectedEquipment.id 
        : `eq_${Date.now()}`,
      name: formData.name.trim(),
      model: formData.model.trim() || 'N/A',
      serialNumber: formData.serialNumber.trim(),
      calibrationDate: new Date(),
      expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      category: formData.category || 'General',
      manufacturer: formData.manufacturer.trim() || undefined,
      notes: formData.notes.trim() || undefined,
      certificateUrl: uploadedFile || undefined,
    };

    if (isEditing) {
      setEquipment(prev =>
        prev.map(item => (item.id === newEquipment.id ? newEquipment : item))
      );
    } else {
      setEquipment(prev => [newEquipment, ...prev]);
    }

    closeAddEditModal();
    
    setTimeout(() => {
      Alert.alert(
        '✅ Success',
        isEditing ? 'Equipment updated successfully!' : 'Equipment added successfully!'
      );
    }, 300);
  };

  const handleDelete = (item: Equipment) => {
    Alert.alert(
      '🗑️ Delete Equipment',
      `Are you sure you want to delete "${item.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setEquipment(prev => prev.filter(e => e.id !== item.id));
            closeDetailsModal();
            Alert.alert('Deleted', 'Equipment removed successfully');
          },
        },
      ]
    );
  };

  // Render Functions
  const renderEquipmentCard = ({ item, index }: { item: Equipment; index: number }) => (
    <EquipmentCard
      item={item}
      onPress={() => openDetailsModal(item)}
      index={index}
    />
  );

  const renderListHeader = () => (
    <View style={styles.listHeader}>
      <Text style={styles.listHeaderText}>All Equipment</Text>
      <Text style={styles.listHeaderCount}>{equipment.length} items</Text>
    </View>
  );

  const renderEmptyList = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>🔧</Text>
      <Text style={styles.emptyTitle}>No Equipment Added</Text>
      <Text style={styles.emptySubtitle}>
        Tap "Add Tool" to register your first equipment
      </Text>
    </View>
  );

  // ============================================================================
  // MAIN RENDER
  // ============================================================================

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />

      {/* ===== HEADER ===== */}
      <Animated.View 
        style={[
          styles.header,
          {
            opacity: headerAnim,
            transform: [{
              translateY: headerAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [-20, 0],
              }),
            }],
          },
        ]}
      >
        <View style={styles.headerLeft}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitle}>My Equipment</Text>
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{stats.total}</Text>
            </View>
          </View>
          <Text style={styles.headerSubtitle}>
            {stats.expired > 0 
              ? `⚠️ ${stats.expired} item${stats.expired > 1 ? 's' : ''} need${stats.expired === 1 ? 's' : ''} attention`
              : '✓ All equipment up to date'
            }
          </Text>
        </View>
        
        <TouchableOpacity 
          style={styles.addButton} 
          onPress={() => openAddEditModal()}
          activeOpacity={0.8}
        >
          <PlusIcon size={16} color="#FFFFFF" />
          <Text style={styles.addButtonText}>Add Tool</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* ===== STATS BAR ===== */}
      <View style={styles.statsBar}>
        <StatsCard 
          count={stats.valid} 
          label="Valid" 
          color={COLORS.valid}
          bgColor={COLORS.validBg}
        />
        <StatsCard 
          count={stats.expiring} 
          label="Expiring" 
          color={COLORS.warning}
          bgColor={COLORS.warningBg}
        />
        <StatsCard 
          count={stats.expired} 
          label="Expired" 
          color={COLORS.expired}
          bgColor={COLORS.expiredBg}
        />
      </View>

      {/* ===== EQUIPMENT LIST ===== */}
      <FlatList
        data={equipment}
        renderItem={renderEquipmentCard}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={equipment.length > 0 ? renderListHeader : null}
        ListEmptyComponent={renderEmptyList}
      />

      {/* ===== ADD/EDIT MODAL ===== */}
      <Modal visible={isModalVisible} transparent animationType="none">
        <View style={styles.modalWrapper}>
          {/* Backdrop */}
          <Animated.View
            style={[styles.modalBackdrop, { opacity: backdropAnim }]}
          >
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              onPress={closeAddEditModal}
              activeOpacity={1}
            />
          </Animated.View>

          {/* Modal Content */}
          <Animated.View
            style={[
              styles.modalContent,
              { transform: [{ translateY: slideAnim }] },
            ]}
          >
            {/* Handle Bar */}
            <View style={styles.modalHandleContainer}>
              <View style={styles.modalHandle} />
            </View>

            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>
                  {isEditing ? 'Edit Equipment' : 'Add New Equipment'}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {isEditing ? 'Update equipment details' : 'Register a new tool or device'}
                </Text>
              </View>
              <TouchableOpacity 
                onPress={closeAddEditModal} 
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Form */}
            <ScrollView 
              style={styles.formContainer} 
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <InputField
                label="Equipment Name"
                value={formData.name}
                onChangeText={text => setFormData(prev => ({ ...prev, name: text }))}
                placeholder="e.g., Ultrasonic Thickness Gauge"
                required
              />

              <InputField
                label="Model Number"
                value={formData.model}
                onChangeText={text => setFormData(prev => ({ ...prev, model: text }))}
                placeholder="e.g., UTG-200X Pro"
              />

              <InputField
                label="Serial Number"
                value={formData.serialNumber}
                onChangeText={text => setFormData(prev => ({ ...prev, serialNumber: text }))}
                placeholder="e.g., UTG-2024-001542"
                required
              />

              {/* Date Row */}
              <View style={styles.dateRow}>
                <View style={styles.dateInputContainer}>
                  <Text style={styles.inputLabel}>Calibration Date</Text>
                  <TouchableOpacity 
                    style={styles.dateInput}
                    onPress={() => Alert.alert('Date Picker', 'Would open date picker')}
                  >
                    <Text style={styles.dateIcon}>📅</Text>
                    <Text style={styles.dateText}>
                      {formData.calibrationDate || 'Select Date'}
                    </Text>
                  </TouchableOpacity>
                </View>
                
                <View style={styles.dateInputContainer}>
                  <Text style={styles.inputLabel}>Expiry Date</Text>
                  <TouchableOpacity 
                    style={styles.dateInput}
                    onPress={() => Alert.alert('Date Picker', 'Would open date picker')}
                  >
                    <Text style={styles.dateIcon}>📅</Text>
                    <Text style={styles.dateText}>
                      {formData.expiryDate || 'Select Date'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Category Selection */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Category</Text>
                <ScrollView 
                  horizontal 
                  showsHorizontalScrollIndicator={false}
                  style={styles.categoryScroll}
                >
                  {CATEGORIES.map(cat => (
                    <TouchableOpacity
                      key={cat}
                      style={[
                        styles.categoryChip,
                        formData.category === cat && styles.categoryChipActive,
                      ]}
                      onPress={() => setFormData(prev => ({ ...prev, category: cat }))}
                    >
                      <Text style={styles.categoryChipIcon}>
                        {getCategoryIcon(cat)}
                      </Text>
                      <Text
                        style={[
                          styles.categoryChipText,
                          formData.category === cat && styles.categoryChipTextActive,
                        ]}
                      >
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <InputField
                label="Manufacturer"
                value={formData.manufacturer}
                onChangeText={text => setFormData(prev => ({ ...prev, manufacturer: text }))}
                placeholder="e.g., Olympus NDT"
              />

              {/* Certificate Upload */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Calibration Certificate</Text>
                <TouchableOpacity
                  style={[
                    styles.uploadArea,
                    uploadedFile && styles.uploadAreaSuccess,
                  ]}
                  onPress={handleUploadCertificate}
                  activeOpacity={0.7}
                >
                  <View style={styles.uploadIconContainer}>
                    <Text style={styles.uploadIcon}>
                      {uploadedFile ? '✓' : '📄'}
                    </Text>
                  </View>
                  <Text style={styles.uploadText}>
                    {uploadedFile || 'Upload PDF or Image'}
                  </Text>
                  <Text style={styles.uploadHint}>
                    {uploadedFile 
                      ? 'Tap to change file'
                      : 'Tap to select calibration certificate'
                    }
                  </Text>
                </TouchableOpacity>
              </View>

              <InputField
                label="Notes"
                value={formData.notes}
                onChangeText={text => setFormData(prev => ({ ...prev, notes: text }))}
                placeholder="Additional notes about the equipment..."
                multiline
              />

              {/* Form Buttons */}
              <View style={styles.formButtons}>
                <TouchableOpacity 
                  style={styles.cancelButton} 
                  onPress={closeAddEditModal}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.saveButton} 
                  onPress={handleSave}
                >
                  <Text style={styles.saveButtonText}>
                    {isEditing ? 'Update Equipment' : 'Add Equipment'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Bottom Spacing */}
              <View style={{ height: 40 }} />
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* ===== DETAILS MODAL ===== */}
      <Modal visible={isDetailsModalVisible} transparent animationType="fade">
        <View style={styles.detailsModalWrapper}>
          <TouchableOpacity 
            style={styles.detailsModalBackdrop}
            onPress={closeDetailsModal}
            activeOpacity={1}
          />
          
          <Animated.View 
            style={[
              styles.detailsModalContent,
              { transform: [{ translateY: detailsSlideAnim }] },
            ]}
          >
            {selectedEquipment && (
              <>
                {/* Details Header */}
                <View style={styles.detailsHeader}>
                  <View style={styles.detailsIconLarge}>
                    <Text style={styles.detailsIconText}>
                      {getCategoryIcon(selectedEquipment.category)}
                    </Text>
                  </View>
                  <StatusBadge 
                    status={getCalibrationStatus(selectedEquipment.expiryDate)} 
                    large 
                  />
                </View>

                {/* Equipment Info */}
                <Text style={styles.detailsTitle}>{selectedEquipment.name}</Text>
                <Text style={styles.detailsModel}>{selectedEquipment.model}</Text>

                {/* Details Grid */}
                <View style={styles.detailsSection}>
                  <View style={styles.detailsGrid}>
                    <View style={styles.detailsGridItem}>
                      <Text style={styles.detailsGridLabel}>Serial Number</Text>
                      <Text style={styles.detailsGridValue}>
                        {selectedEquipment.serialNumber}
                      </Text>
                    </View>
                    <View style={styles.detailsGridItem}>
                      <Text style={styles.detailsGridLabel}>Category</Text>
                      <Text style={styles.detailsGridValue}>
                        {selectedEquipment.category}
                      </Text>
                    </View>
                    <View style={styles.detailsGridItem}>
                      <Text style={styles.detailsGridLabel}>Manufacturer</Text>
                      <Text style={styles.detailsGridValue}>
                        {selectedEquipment.manufacturer || 'Not specified'}
                      </Text>
                    </View>
                    <View style={styles.detailsGridItem}>
                      <Text style={styles.detailsGridLabel}>Location</Text>
                      <Text style={styles.detailsGridValue}>
                        {selectedEquipment.location || 'Not specified'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.detailsDivider} />

                  {/* Calibration Info */}
                  <View style={styles.calibrationInfo}>
                    <View style={styles.calibrationItem}>
                      <Text style={styles.calibrationLabel}>Calibrated On</Text>
                      <Text style={styles.calibrationValue}>
                        {formatDate(selectedEquipment.calibrationDate)}
                      </Text>
                    </View>
                    <View style={styles.calibrationArrow}>
                      <Text style={styles.calibrationArrowText}>→</Text>
                    </View>
                    <View style={styles.calibrationItem}>
                      <Text style={styles.calibrationLabel}>Expires On</Text>
                      <Text 
                        style={[
                          styles.calibrationValue,
                          getCalibrationStatus(selectedEquipment.expiryDate) === 'expired' 
                            && { color: COLORS.expired },
                          getCalibrationStatus(selectedEquipment.expiryDate) === 'expiring' 
                            && { color: COLORS.warning },
                        ]}
                      >
                        {formatDate(selectedEquipment.expiryDate)}
                      </Text>
                    </View>
                  </View>

                  {/* Notes */}
                  {selectedEquipment.notes && (
                    <>
                      <View style={styles.detailsDivider} />
                      <View style={styles.notesSection}>
                        <Text style={styles.notesLabel}>Notes</Text>
                        <Text style={styles.notesText}>{selectedEquipment.notes}</Text>
                      </View>
                    </>
                  )}
                </View>

                {/* Action Buttons */}
                <View style={styles.detailsActions}>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => handleDelete(selectedEquipment)}
                  >
                    <Text style={styles.deleteButtonText}>🗑️</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.editButton}
                    onPress={() => {
                      closeDetailsModal();
                      setTimeout(() => {
                        openAddEditModal(true, selectedEquipment);
                      }, 350);
                    }}
                  >
                    <Text style={styles.editButtonText}>Edit Details</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.closeDetailsButton}
                    onPress={closeDetailsModal}
                  >
                    <Text style={styles.closeDetailsButtonText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </Animated.View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  // Container
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  // Header Styles
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 24,
    paddingBottom: 16,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  headerBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 12,
  },
  headerBadgeText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 6,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginLeft: 8,
  },

  // Plus Icon
  plusIcon: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  plusHorizontal: {
    position: 'absolute',
    borderRadius: 1,
  },
  plusVertical: {
    position: 'absolute',
    borderRadius: 1,
  },

  // Stats Bar
  statsBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 20,
    gap: 12,
  },
  statItem: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 16,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
    fontWeight: '500',
  },

  // List
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  listHeaderText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  listHeaderCount: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },

  // Empty State
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },

  // Card Styles
  cardContainer: {
    marginBottom: 16,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  cardGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  cardIconText: {
    fontSize: 24,
  },
  cardTitleContainer: {
    flex: 1,
    marginRight: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  cardModel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 3,
  },
  cardDivider: {
    height: 1,
    backgroundColor: COLORS.divider,
    marginVertical: 14,
  },
  cardDetails: {
    gap: 10,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailItem: {
    flex: 1,
  },
  detailItemRight: {
    alignItems: 'flex-end',
  },
  detailLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 3,
  },
  detailValue: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
  },
  categoryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  categoryTag: {
    fontSize: 12,
    color: COLORS.primary,
    backgroundColor: COLORS.primaryGlow,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    fontWeight: '600',
  },
  locationText: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  expiryInfo: {},
  daysText: {
    fontSize: 12,
    fontWeight: '600',
  },
  tapIndicator: {
    position: 'absolute',
    right: 18,
    top: '50%',
    marginTop: -10,
  },
  tapIndicatorText: {
    fontSize: 18,
    color: COLORS.textMuted,
  },

  // Status Badge
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusBadgeLarge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 7,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  statusTextLarge: {
    fontSize: 12,
  },

  // Modal Styles
  modalWrapper: {
    flex: 1,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
  },
  modalContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: SCREEN_HEIGHT * 0.92,
  },
  modalHandleContainer: {
    alignItems: 'center',
    paddingTop: 12,
  },
  modalHandle: {
    width: 40,
    height: 5,
    backgroundColor: COLORS.border,
    borderRadius: 3,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  modalSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 18,
    color: COLORS.textSecondary,
  },

  // Form Styles
  formContainer: {
    paddingHorizontal: 24,
  },
  inputGroup: {
    marginBottom: 18,
  },
  inputLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 10,
    fontWeight: '500',
  },
  requiredAsterisk: {
    color: COLORS.expired,
  },
  input: {
    backgroundColor: COLORS.inputBg,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
    paddingTop: 16,
  },
  dateRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 18,
  },
  dateInputContainer: {
    flex: 1,
  },
  dateInput: {
    backgroundColor: COLORS.inputBg,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateIcon: {
    fontSize: 16,
    marginRight: 10,
  },
  dateText: {
    color: COLORS.textSecondary,
    fontSize: 15,
    flex: 1,
  },

  // Category Chips
  categoryScroll: {
    marginHorizontal: -4,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLight,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginHorizontal: 4,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  categoryChipActive: {
    backgroundColor: COLORS.primaryGlow,
    borderColor: COLORS.primary,
  },
  categoryChipIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  categoryChipText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  categoryChipTextActive: {
    color: COLORS.primary,
  },

  // Upload Area
  uploadArea: {
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingVertical: 28,
    alignItems: 'center',
    backgroundColor: 'rgba(124, 58, 237, 0.03)',
  },
  uploadAreaSuccess: {
    borderColor: COLORS.valid,
    borderStyle: 'solid',
    backgroundColor: COLORS.validBg,
  },
  uploadIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  uploadIcon: {
    fontSize: 28,
  },
  uploadText: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '600',
  },
  uploadHint: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 6,
  },

  // Form Buttons
  formButtons: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 28,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 18,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  saveButton: {
    flex: 2,
    paddingVertical: 18,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  saveButtonText: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // Details Modal
  detailsModalWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  detailsModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  detailsModalContent: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    maxHeight: SCREEN_HEIGHT * 0.85,
  },
  detailsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  detailsIconLarge: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: COLORS.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailsIconText: {
    fontSize: 36,
  },
  detailsTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  detailsModel: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 4,
    marginBottom: 24,
  },
  detailsSection: {
    backgroundColor: COLORS.background,
    borderRadius: 18,
    padding: 18,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  detailsGridItem: {
    width: '47%',
  },
  detailsGridLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 5,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailsGridValue: {
    fontSize: 15,
    color: COLORS.text,
    fontWeight: '500',
  },
  detailsDivider: {
    height: 1,
    backgroundColor: COLORS.divider,
    marginVertical: 18,
  },
  calibrationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  calibrationItem: {
    flex: 1,
  },
  calibrationLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 5,
  },
  calibrationValue: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '600',
  },
  calibrationArrow: {
    paddingHorizontal: 16,
  },
  calibrationArrowText: {
    fontSize: 20,
    color: COLORS.textMuted,
  },
  notesSection: {},
  notesLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  notesText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 22,
  },

  // Details Actions
  detailsActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  deleteButton: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: COLORS.expiredBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.expiredBorder,
  },
  deleteButtonText: {
    fontSize: 20,
  },
  editButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButtonText: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '600',
  },
  closeDetailsButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeDetailsButtonText: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '700',
  },
});

export default EquipmentScreen;
