import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
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
  KeyboardAvoidingView,
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
  cardBg: '#161E2E',
  
  // Accent Colors
  primary: '#00F5FF',
  primaryDark: '#00C4CC',
  primaryGlow: 'rgba(0, 245, 255, 0.15)',
  primaryMuted: 'rgba(0, 245, 255, 0.5)',
  
  // Financial Colors
  money: '#00F5FF',
  moneyGlow: 'rgba(0, 245, 255, 0.2)',
  reimbursable: '#10B981',
  reimbursableBg: 'rgba(16, 185, 129, 0.15)',
  nonBillable: '#F59E0B',
  nonBillableBg: 'rgba(245, 158, 11, 0.15)',
  
  // Text Colors
  text: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  
  // Status Colors
  pending: '#F59E0B',
  pendingBg: 'rgba(245, 158, 11, 0.15)',
  pendingBorder: 'rgba(245, 158, 11, 0.4)',
  approved: '#10B981',
  approvedBg: 'rgba(16, 185, 129, 0.15)',
  approvedBorder: 'rgba(16, 185, 129, 0.4)',
  rejected: '#EF4444',
  rejectedBg: 'rgba(239, 68, 68, 0.15)',
  
  // UI Elements
  border: '#374151',
  inputBg: '#1F2937',
  divider: '#2D3748',
  overlay: 'rgba(0, 0, 0, 0.8)',
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

type ExpenseCategory = 'fuel' | 'food' | 'hotel' | 'transport' | 'supplies' | 'other';
type ExpenseStatus = 'pending' | 'approved' | 'rejected';
type BillableType = 'reimbursable' | 'non-billable';

interface Expense {
  id: string;
  amount: number;
  merchant: string;
  date: Date;
  category: ExpenseCategory;
  status: ExpenseStatus;
  billableType: BillableType;
  receiptUrl?: string;
  notes?: string;
  projectId: string;
  projectName: string;
}

interface CategoryConfig {
  icon: string;
  label: string;
  color: string;
  bgColor: string;
}

interface FormData {
  amount: string;
  merchant: string;
  date: string;
  category: ExpenseCategory | null;
  billableType: BillableType;
  notes: string;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const CATEGORIES: Record<ExpenseCategory, CategoryConfig> = {
  fuel: {
    icon: '⛽',
    label: 'Fuel & Gas',
    color: '#F97316',
    bgColor: 'rgba(249, 115, 22, 0.15)',
  },
  food: {
    icon: '🍽️',
    label: 'Food & Meals',
    color: '#22C55E',
    bgColor: 'rgba(34, 197, 94, 0.15)',
  },
  hotel: {
    icon: '🏨',
    label: 'Accommodation',
    color: '#8B5CF6',
    bgColor: 'rgba(139, 92, 246, 0.15)',
  },
  transport: {
    icon: '🚗',
    label: 'Transportation',
    color: '#3B82F6',
    bgColor: 'rgba(59, 130, 246, 0.15)',
  },
  supplies: {
    icon: '🛠️',
    label: 'Supplies',
    color: '#EC4899',
    bgColor: 'rgba(236, 72, 153, 0.15)',
  },
  other: {
    icon: '📦',
    label: 'Other',
    color: '#6B7280',
    bgColor: 'rgba(107, 114, 128, 0.15)',
  },
};

// ============================================================================
// MOCK DATA
// ============================================================================

const MOCK_EXPENSES: Expense[] = [
  {
    id: '1',
    amount: 125.50,
    merchant: 'Shell Gas Station',
    date: new Date('2024-12-10'),
    category: 'fuel',
    status: 'approved',
    billableType: 'reimbursable',
    projectId: 'proj_001',
    projectName: 'Pipeline Inspection - Site A',
    notes: 'Field vehicle refueling',
  },
  {
    id: '2',
    amount: 89.00,
    merchant: 'Marriott Hotel',
    date: new Date('2024-12-09'),
    category: 'hotel',
    status: 'pending',
    billableType: 'reimbursable',
    projectId: 'proj_001',
    projectName: 'Pipeline Inspection - Site A',
    notes: 'Overnight stay near site',
  },
  {
    id: '3',
    amount: 45.75,
    merchant: 'Olive Garden',
    date: new Date('2024-12-09'),
    category: 'food',
    status: 'approved',
    billableType: 'reimbursable',
    projectId: 'proj_001',
    projectName: 'Pipeline Inspection - Site A',
  },
  {
    id: '4',
    amount: 32.00,
    merchant: 'Uber',
    date: new Date('2024-12-08'),
    category: 'transport',
    status: 'pending',
    billableType: 'non-billable',
    projectId: 'proj_001',
    projectName: 'Pipeline Inspection - Site A',
    notes: 'Transport to client meeting',
  },
  {
    id: '5',
    amount: 78.25,
    merchant: 'Industrial Supply Co.',
    date: new Date('2024-12-08'),
    category: 'supplies',
    status: 'approved',
    billableType: 'reimbursable',
    projectId: 'proj_001',
    projectName: 'Pipeline Inspection - Site A',
    notes: 'Safety equipment',
  },
  {
    id: '6',
    amount: 55.00,
    merchant: 'Chevron',
    date: new Date('2024-12-07'),
    category: 'fuel',
    status: 'approved',
    billableType: 'reimbursable',
    projectId: 'proj_001',
    projectName: 'Pipeline Inspection - Site A',
  },
  {
    id: '7',
    amount: 24.50,
    merchant: 'Starbucks',
    date: new Date('2024-12-07'),
    category: 'food',
    status: 'rejected',
    billableType: 'non-billable',
    projectId: 'proj_001',
    projectName: 'Pipeline Inspection - Site A',
    notes: 'Team coffee',
  },
];

const MOCK_RECEIPT_PLACEHOLDER = `
┌─────────────────────────────┐
│      SHELL GAS STATION      │
│     1234 Industrial Ave     │
│     Houston, TX 77001       │
├─────────────────────────────┤
│                             │
│  Date: 12/10/2024           │
│  Time: 14:32                │
│                             │
│  UNLEADED PLUS              │
│  12.543 GAL @ $3.459        │
│                             │
│  Subtotal:        $43.38    │
│  Tax:              $3.47    │
│  ─────────────────────────  │
│  TOTAL:           $46.85    │
│                             │
│  VISA ****1234              │
│  Auth: 847291               │
│                             │
│     Thank you for your      │
│         business!           │
└─────────────────────────────┘
`;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

const formatDate = (date: Date): string => {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatDateShort = (date: Date): string => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const getStatusConfig = (status: ExpenseStatus) => {
  const configs = {
    pending: {
      label: 'Pending Approval',
      color: COLORS.pending,
      bgColor: COLORS.pendingBg,
      borderColor: COLORS.pendingBorder,
      icon: '⏳',
    },
    approved: {
      label: 'Approved',
      color: COLORS.approved,
      bgColor: COLORS.approvedBg,
      borderColor: COLORS.approvedBorder,
      icon: '✓',
    },
    rejected: {
      label: 'Rejected',
      color: COLORS.rejected,
      bgColor: COLORS.rejectedBg,
      borderColor: 'rgba(239, 68, 68, 0.4)',
      icon: '✕',
    },
  };
  return configs[status];
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// Plus Icon Component
const PlusIcon: React.FC<{ size?: number; color?: string }> = ({
  size = 18,
  color = COLORS.background,
}) => (
  <View style={[styles.plusIcon, { width: size, height: size }]}>
    <View
      style={[
        styles.plusHorizontal,
        { backgroundColor: color, width: size, height: 2 },
      ]}
    />
    <View
      style={[
        styles.plusVertical,
        { backgroundColor: color, width: 2, height: size },
      ]}
    />
  </View>
);

// Summary Card Component
const SummaryCard: React.FC<{
  title: string;
  amount: number;
  subtitle?: string;
  color?: string;
  bgColor?: string;
  icon?: string;
  isMain?: boolean;
}> = ({
  title,
  amount,
  subtitle,
  color = COLORS.primary,
  bgColor,
  icon,
  isMain = false,
}) => {
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
        isMain ? styles.mainSummaryCard : styles.summaryCard,
        bgColor && { backgroundColor: bgColor },
        { transform: [{ scale: scaleAnim }] },
      ]}
    >
      {icon && (
        <View style={[styles.summaryIcon, { backgroundColor: bgColor || COLORS.surfaceLight }]}>
          <Text style={styles.summaryIconText}>{icon}</Text>
        </View>
      )}
      <Text style={[styles.summaryTitle, isMain && styles.summaryTitleMain]}>
        {title}
      </Text>
      <Text style={[styles.summaryAmount, { color }, isMain && styles.summaryAmountMain]}>
        {formatCurrency(amount)}
      </Text>
      {subtitle && <Text style={styles.summarySubtitle}>{subtitle}</Text>}
    </Animated.View>
  );
};

// Status Badge Component
const StatusBadge: React.FC<{ status: ExpenseStatus; compact?: boolean }> = ({
  status,
  compact = false,
}) => {
  const config = getStatusConfig(status);

  return (
    <View
      style={[
        styles.statusBadge,
        { backgroundColor: config.bgColor },
        compact && styles.statusBadgeCompact,
      ]}
    >
      <Text style={[styles.statusIcon, compact && { fontSize: 10 }]}>
        {config.icon}
      </Text>
      {!compact && (
        <Text style={[styles.statusText, { color: config.color }]}>
          {config.label}
        </Text>
      )}
    </View>
  );
};

// Expense Item Component
const ExpenseItem: React.FC<{
  expense: Expense;
  onPress: () => void;
  index: number;
}> = ({ expense, onPress, index }) => {
  const categoryConfig = CATEGORIES[expense.category];
  const animatedValue = useRef(new Animated.Value(0)).current;
  const scaleValue = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: 1,
      duration: 400,
      delay: index * 80,
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

  return (
    <Animated.View
      style={[
        styles.expenseItemContainer,
        {
          opacity: animatedValue,
          transform: [
            {
              translateX: animatedValue.interpolate({
                inputRange: [0, 1],
                outputRange: [-30, 0],
              }),
            },
            { scale: scaleValue },
          ],
        },
      ]}
    >
      <TouchableOpacity
        style={styles.expenseItem}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.9}
      >
        {/* Category Icon */}
        <View
          style={[
            styles.expenseIcon,
            { backgroundColor: categoryConfig.bgColor },
          ]}
        >
          <Text style={styles.expenseIconText}>{categoryConfig.icon}</Text>
        </View>

        {/* Expense Details */}
        <View style={styles.expenseDetails}>
          <View style={styles.expenseTopRow}>
            <Text style={styles.expenseMerchant} numberOfLines={1}>
              {expense.merchant}
            </Text>
            <Text style={styles.expenseAmount}>
              {formatCurrency(expense.amount)}
            </Text>
          </View>
          <View style={styles.expenseBottomRow}>
            <View style={styles.expenseMetaRow}>
              <Text style={styles.expenseDate}>
                {formatDateShort(expense.date)}
              </Text>
              <View style={styles.expenseDot} />
              <Text style={styles.expenseCategory}>{categoryConfig.label}</Text>
            </View>
            <StatusBadge status={expense.status} compact />
          </View>
          {expense.billableType === 'non-billable' && (
            <View style={styles.nonBillableTag}>
              <Text style={styles.nonBillableTagText}>Non-Billable</Text>
            </View>
          )}
        </View>

        {/* Arrow Indicator */}
        <View style={styles.expenseArrow}>
          <Text style={styles.expenseArrowText}>›</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Category Chip Component
const CategoryChip: React.FC<{
  category: ExpenseCategory;
  selected: boolean;
  onPress: () => void;
}> = ({ category, selected, onPress }) => {
  const config = CATEGORIES[category];
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: 100, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[
          styles.categoryChip,
          selected && { backgroundColor: config.bgColor, borderColor: config.color },
        ]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <Text style={styles.categoryChipIcon}>{config.icon}</Text>
        <Text
          style={[
            styles.categoryChipLabel,
            selected && { color: config.color },
          ]}
        >
          {config.label}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Receipt Preview Component
const ReceiptPreview: React.FC<{
  hasReceipt: boolean;
  onCapture: () => void;
  onRemove: () => void;
}> = ({ hasReceipt, onCapture, onRemove }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (hasReceipt) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [hasReceipt]);

  if (hasReceipt) {
    return (
      <Animated.View style={[styles.receiptPreview, { opacity: fadeAnim }]}>
        <View style={styles.receiptDocument}>
          <Text style={styles.receiptText}>{MOCK_RECEIPT_PLACEHOLDER}</Text>
        </View>
        <View style={styles.receiptActions}>
          <TouchableOpacity
            style={styles.receiptActionButton}
            onPress={onRemove}
          >
            <Text style={styles.receiptActionIcon}>🗑️</Text>
            <Text style={styles.receiptActionText}>Remove</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.receiptActionButton}
            onPress={onCapture}
          >
            <Text style={styles.receiptActionIcon}>📷</Text>
            <Text style={styles.receiptActionText}>Retake</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  }

  return (
    <TouchableOpacity
      style={styles.captureButton}
      onPress={onCapture}
      activeOpacity={0.8}
    >
      <View style={styles.captureIconContainer}>
        <Text style={styles.captureIcon}>📷</Text>
      </View>
      <View style={styles.captureTextContainer}>
        <Text style={styles.captureTitle}>Snap Receipt</Text>
        <Text style={styles.captureSubtitle}>
          Take a photo of your receipt for verification
        </Text>
      </View>
      <View style={styles.captureArrow}>
        <Text style={styles.captureArrowText}>→</Text>
      </View>
    </TouchableOpacity>
  );
};

// Filter Tab Component
const FilterTab: React.FC<{
  label: string;
  active: boolean;
  count?: number;
  onPress: () => void;
}> = ({ label, active, count, onPress }) => (
  <TouchableOpacity
    style={[styles.filterTab, active && styles.filterTabActive]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <Text style={[styles.filterTabText, active && styles.filterTabTextActive]}>
      {label}
    </Text>
    {count !== undefined && count > 0 && (
      <View style={[styles.filterBadge, active && styles.filterBadgeActive]}>
        <Text style={[styles.filterBadgeText, active && styles.filterBadgeTextActive]}>
          {count}
        </Text>
      </View>
    )}
  </TouchableOpacity>
);

// ============================================================================
// MAIN SCREEN COMPONENT
// ============================================================================

const ExpenseTrackerScreen: React.FC = () => {
  // State
  const [expenses, setExpenses] = useState<Expense[]>(MOCK_EXPENSES);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [isDetailModalVisible, setIsDetailModalVisible] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | ExpenseStatus>('all');
  const [hasReceipt, setHasReceipt] = useState(false);

  // Form State
  const [formData, setFormData] = useState<FormData>({
    amount: '',
    merchant: '',
    date: formatDate(new Date()),
    category: null,
    billableType: 'reimbursable',
    notes: '',
  });

  // Animation Refs
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const headerAnim = useRef(new Animated.Value(0)).current;

  // Computed Values
  const summaryData = useMemo(() => {
    const total = expenses.reduce((sum, exp) => sum + exp.amount, 0);
    const reimbursable = expenses
      .filter(exp => exp.billableType === 'reimbursable')
      .reduce((sum, exp) => sum + exp.amount, 0);
    const nonBillable = expenses
      .filter(exp => exp.billableType === 'non-billable')
      .reduce((sum, exp) => sum + exp.amount, 0);
    const pending = expenses.filter(exp => exp.status === 'pending').length;
    const approved = expenses.filter(exp => exp.status === 'approved').length;

    return { total, reimbursable, nonBillable, pending, approved };
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    if (activeFilter === 'all') return expenses;
    return expenses.filter(exp => exp.status === activeFilter);
  }, [expenses, activeFilter]);

  // Effects
  useEffect(() => {
    Animated.timing(headerAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, []);

  // Modal Control Functions
  const openAddModal = () => {
    resetForm();
    setIsAddModalVisible(true);
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

  const closeAddModal = () => {
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
      setIsAddModalVisible(false);
      resetForm();
    });
  };

  const openDetailModal = (expense: Expense) => {
    setSelectedExpense(expense);
    setIsDetailModalVisible(true);
  };

  const closeDetailModal = () => {
    setIsDetailModalVisible(false);
    setSelectedExpense(null);
  };

  const resetForm = () => {
    setFormData({
      amount: '',
      merchant: '',
      date: formatDate(new Date()),
      category: null,
      billableType: 'reimbursable',
      notes: '',
    });
    setHasReceipt(false);
  };

  // Handlers
  const handleCaptureReceipt = () => {
    Alert.alert(
      '📷 Capture Receipt',
      'Choose an option',
      [
        {
          text: 'Take Photo',
          onPress: () => {
            setHasReceipt(true);
            Alert.alert('Success', 'Receipt captured successfully!');
          },
        },
        {
          text: 'Choose from Gallery',
          onPress: () => {
            setHasReceipt(true);
            Alert.alert('Success', 'Receipt selected successfully!');
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleRemoveReceipt = () => {
    Alert.alert('Remove Receipt', 'Are you sure you want to remove this receipt?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => setHasReceipt(false) },
    ]);
  };

  const handleSubmitExpense = () => {
    // Validation
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid amount');
      return;
    }
    if (!formData.merchant.trim()) {
      Alert.alert('Validation Error', 'Please enter merchant name');
      return;
    }
    if (!formData.category) {
      Alert.alert('Validation Error', 'Please select a category');
      return;
    }

    const newExpense: Expense = {
      id: `exp_${Date.now()}`,
      amount: parseFloat(formData.amount),
      merchant: formData.merchant.trim(),
      date: new Date(),
      category: formData.category,
      status: 'pending',
      billableType: formData.billableType,
      notes: formData.notes.trim() || undefined,
      projectId: 'proj_001',
      projectName: 'Pipeline Inspection - Site A',
      receiptUrl: hasReceipt ? 'receipt_captured' : undefined,
    };

    setExpenses(prev => [newExpense, ...prev]);
    closeAddModal();

    setTimeout(() => {
      Alert.alert('✅ Expense Submitted', 'Your expense has been submitted for approval.');
    }, 300);
  };

  // Render Functions
  const renderExpenseItem = ({ item, index }: { item: Expense; index: number }) => (
    <ExpenseItem
      expense={item}
      onPress={() => openDetailModal(item)}
      index={index}
    />
  );

  const renderListHeader = () => (
    <View style={styles.listHeader}>
      <Text style={styles.listHeaderTitle}>Recent Expenses</Text>
      <Text style={styles.listHeaderCount}>
        {filteredExpenses.length} item{filteredExpenses.length !== 1 ? 's' : ''}
      </Text>
    </View>
  );

  const renderEmptyList = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>💰</Text>
      <Text style={styles.emptyTitle}>No Expenses Found</Text>
      <Text style={styles.emptySubtitle}>
        {activeFilter === 'all'
          ? 'Add your first expense to get started'
          : `No ${activeFilter} expenses`}
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
            transform: [
              {
                translateY: headerAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-20, 0],
                }),
              },
            ],
          },
        ]}
      >
        <View style={styles.headerTop}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>Expense Tracker</Text>
            <Text style={styles.headerSubtitle}>Pipeline Inspection - Site A</Text>
          </View>
          <TouchableOpacity style={styles.addButton} onPress={openAddModal}>
            <PlusIcon size={16} color={COLORS.background} />
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* ===== SUMMARY SECTION ===== */}
      <View style={styles.summarySection}>
        {/* Main Total Card */}
        <SummaryCard
          title="Total Expenses"
          amount={summaryData.total}
          subtitle="This project"
          color={COLORS.money}
          icon="💵"
          isMain
        />

        {/* Breakdown Cards */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCardHalf}>
            <SummaryCard
              title="Reimbursable"
              amount={summaryData.reimbursable}
              color={COLORS.reimbursable}
              bgColor={COLORS.reimbursableBg}
            />
          </View>
          <View style={styles.summaryCardHalf}>
            <SummaryCard
              title="Non-Billable"
              amount={summaryData.nonBillable}
              color={COLORS.nonBillable}
              bgColor={COLORS.nonBillableBg}
            />
          </View>
        </View>

        {/* Status Overview */}
        <View style={styles.statusOverview}>
          <View style={styles.statusItem}>
            <View style={[styles.statusDot, { backgroundColor: COLORS.pending }]} />
            <Text style={styles.statusLabel}>Pending</Text>
            <Text style={[styles.statusCount, { color: COLORS.pending }]}>
              {summaryData.pending}
            </Text>
          </View>
          <View style={styles.statusDivider} />
          <View style={styles.statusItem}>
            <View style={[styles.statusDot, { backgroundColor: COLORS.approved }]} />
            <Text style={styles.statusLabel}>Approved</Text>
            <Text style={[styles.statusCount, { color: COLORS.approved }]}>
              {summaryData.approved}
            </Text>
          </View>
        </View>
      </View>

      {/* ===== FILTER TABS ===== */}
      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <FilterTab
            label="All"
            active={activeFilter === 'all'}
            count={expenses.length}
            onPress={() => setActiveFilter('all')}
          />
          <FilterTab
            label="Pending"
            active={activeFilter === 'pending'}
            count={summaryData.pending}
            onPress={() => setActiveFilter('pending')}
          />
          <FilterTab
            label="Approved"
            active={activeFilter === 'approved'}
            count={summaryData.approved}
            onPress={() => setActiveFilter('approved')}
          />
          <FilterTab
            label="Rejected"
            active={activeFilter === 'rejected'}
            count={expenses.filter(e => e.status === 'rejected').length}
            onPress={() => setActiveFilter('rejected')}
          />
        </ScrollView>
      </View>

      {/* ===== EXPENSE LIST ===== */}
      <FlatList
        data={filteredExpenses}
        renderItem={renderExpenseItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={filteredExpenses.length > 0 ? renderListHeader : null}
        ListEmptyComponent={renderEmptyList}
      />

      {/* ===== ADD EXPENSE MODAL ===== */}
      <Modal visible={isAddModalVisible} transparent animationType="none">
        <KeyboardAvoidingView
          style={styles.modalWrapper}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Backdrop */}
          <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              onPress={closeAddModal}
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
            {/* Handle */}
            <View style={styles.modalHandle}>
              <View style={styles.handleBar} />
            </View>

            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Add Expense</Text>
                <Text style={styles.modalSubtitle}>Log a new expense entry</Text>
              </View>
              <TouchableOpacity style={styles.closeButton} onPress={closeAddModal}>
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Form */}
            <ScrollView
              style={styles.formScroll}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {/* Amount Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Amount *</Text>
                <View style={styles.amountInputContainer}>
                  <Text style={styles.currencySymbol}>$</Text>
                  <TextInput
                    style={styles.amountInput}
                    placeholder="0.00"
                    placeholderTextColor={COLORS.textMuted}
                    value={formData.amount}
                    onChangeText={text => {
                      // Allow only valid decimal numbers
                      const cleaned = text.replace(/[^0-9.]/g, '');
                      setFormData(prev => ({ ...prev, amount: cleaned }));
                    }}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>

              {/* Merchant Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Merchant *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., Shell Gas Station"
                  placeholderTextColor={COLORS.textMuted}
                  value={formData.merchant}
                  onChangeText={text => setFormData(prev => ({ ...prev, merchant: text }))}
                />
              </View>

              {/* Date Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Date</Text>
                <TouchableOpacity
                  style={styles.dateButton}
                  onPress={() => Alert.alert('Date Picker', 'Would open date picker')}
                >
                  <Text style={styles.dateIcon}>📅</Text>
                  <Text style={styles.dateText}>{formData.date}</Text>
                </TouchableOpacity>
              </View>

              {/* Category Selection */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Category *</Text>
                <View style={styles.categoryGrid}>
                  {(Object.keys(CATEGORIES) as ExpenseCategory[]).map(cat => (
                    <CategoryChip
                      key={cat}
                      category={cat}
                      selected={formData.category === cat}
                      onPress={() => setFormData(prev => ({ ...prev, category: cat }))}
                    />
                  ))}
                </View>
              </View>

              {/* Billable Type Toggle */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Expense Type</Text>
                <View style={styles.toggleContainer}>
                  <TouchableOpacity
                    style={[
                      styles.toggleButton,
                      formData.billableType === 'reimbursable' && styles.toggleButtonActive,
                    ]}
                    onPress={() => setFormData(prev => ({ ...prev, billableType: 'reimbursable' }))}
                  >
                    <Text style={styles.toggleIcon}>💰</Text>
                    <Text
                      style={[
                        styles.toggleText,
                        formData.billableType === 'reimbursable' && styles.toggleTextActive,
                      ]}
                    >
                      Reimbursable
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.toggleButton,
                      formData.billableType === 'non-billable' && styles.toggleButtonActiveWarning,
                    ]}
                    onPress={() => setFormData(prev => ({ ...prev, billableType: 'non-billable' }))}
                  >
                    <Text style={styles.toggleIcon}>🏷️</Text>
                    <Text
                      style={[
                        styles.toggleText,
                        formData.billableType === 'non-billable' && styles.toggleTextActiveWarning,
                      ]}
                    >
                      Non-Billable
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Receipt Capture */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Receipt</Text>
                <ReceiptPreview
                  hasReceipt={hasReceipt}
                  onCapture={handleCaptureReceipt}
                  onRemove={handleRemoveReceipt}
                />
              </View>

              {/* Notes */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Notes (Optional)</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Add any additional details..."
                  placeholderTextColor={COLORS.textMuted}
                  value={formData.notes}
                  onChangeText={text => setFormData(prev => ({ ...prev, notes: text }))}
                  multiline
                  numberOfLines={3}
                />
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleSubmitExpense}
                activeOpacity={0.8}
              >
                <Text style={styles.submitButtonText}>Submit Expense</Text>
              </TouchableOpacity>

              <View style={{ height: 40 }} />
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ===== EXPENSE DETAIL MODAL ===== */}
      <Modal visible={isDetailModalVisible} transparent animationType="fade">
        <View style={styles.detailModalWrapper}>
          <TouchableOpacity
            style={styles.detailBackdrop}
            onPress={closeDetailModal}
            activeOpacity={1}
          />
          <View style={styles.detailModal}>
            {selectedExpense && (
              <>
                {/* Header */}
                <View style={styles.detailHeader}>
                  <View
                    style={[
                      styles.detailIcon,
                      { backgroundColor: CATEGORIES[selectedExpense.category].bgColor },
                    ]}
                  >
                    <Text style={styles.detailIconText}>
                      {CATEGORIES[selectedExpense.category].icon}
                    </Text>
                  </View>
                  <StatusBadge status={selectedExpense.status} />
                </View>

                {/* Amount */}
                <Text style={styles.detailAmount}>
                  {formatCurrency(selectedExpense.amount)}
                </Text>
                <Text style={styles.detailMerchant}>{selectedExpense.merchant}</Text>

                {/* Details Grid */}
                <View style={styles.detailGrid}>
                  <View style={styles.detailGridItem}>
                    <Text style={styles.detailGridLabel}>Date</Text>
                    <Text style={styles.detailGridValue}>
                      {formatDate(selectedExpense.date)}
                    </Text>
                  </View>
                  <View style={styles.detailGridItem}>
                    <Text style={styles.detailGridLabel}>Category</Text>
                    <Text style={styles.detailGridValue}>
                      {CATEGORIES[selectedExpense.category].label}
                    </Text>
                  </View>
                  <View style={styles.detailGridItem}>
                    <Text style={styles.detailGridLabel}>Type</Text>
                    <Text
                      style={[
                        styles.detailGridValue,
                        {
                          color:
                            selectedExpense.billableType === 'reimbursable'
                              ? COLORS.reimbursable
                              : COLORS.nonBillable,
                        },
                      ]}
                    >
                      {selectedExpense.billableType === 'reimbursable'
                        ? 'Reimbursable'
                        : 'Non-Billable'}
                    </Text>
                  </View>
                  <View style={styles.detailGridItem}>
                    <Text style={styles.detailGridLabel}>Project</Text>
                    <Text style={styles.detailGridValue} numberOfLines={1}>
                      {selectedExpense.projectName}
                    </Text>
                  </View>
                </View>

                {/* Notes */}
                {selectedExpense.notes && (
                  <View style={styles.detailNotes}>
                    <Text style={styles.detailNotesLabel}>Notes</Text>
                    <Text style={styles.detailNotesText}>{selectedExpense.notes}</Text>
                  </View>
                )}

                {/* Actions */}
                <View style={styles.detailActions}>
                  <TouchableOpacity
                    style={styles.detailActionSecondary}
                    onPress={() => {
                      closeDetailModal();
                      Alert.alert('Edit', 'Edit expense functionality');
                    }}
                  >
                    <Text style={styles.detailActionSecondaryText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.detailActionPrimary}
                    onPress={closeDetailModal}
                  >
                    <Text style={styles.detailActionPrimaryText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
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

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 12 : 8,
    paddingBottom: 16,
    backgroundColor: COLORS.background,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  addButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.background,
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

  // Summary Section
  summarySection: {
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  mainSummaryCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  summaryCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    flex: 1,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  summaryCardHalf: {
    flex: 1,
  },
  summaryIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  summaryIconText: {
    fontSize: 20,
  },
  summaryTitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  summaryTitleMain: {
    fontSize: 14,
  },
  summaryAmount: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 4,
  },
  summaryAmountMain: {
    fontSize: 32,
    letterSpacing: -1,
  },
  summarySubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
  },

  // Status Overview
  statusOverview: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statusItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginRight: 6,
  },
  statusCount: {
    fontSize: 15,
    fontWeight: '700',
  },
  statusDivider: {
    width: 1,
    height: 20,
    backgroundColor: COLORS.border,
  },

  // Filter Container
  filterContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    marginRight: 10,
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterTabActive: {
    backgroundColor: COLORS.primaryGlow,
    borderColor: COLORS.primary,
  },
  filterTabText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  filterTabTextActive: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  filterBadge: {
    backgroundColor: COLORS.surfaceHighlight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 8,
  },
  filterBadgeActive: {
    backgroundColor: COLORS.primary,
  },
  filterBadgeText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  filterBadgeTextActive: {
    color: COLORS.background,
  },

  // List
  listContainer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 100,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  listHeaderTitle: {
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

  // Expense Item
  expenseItemContainer: {
    marginBottom: 12,
  },
  expenseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  expenseIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  expenseIconText: {
    fontSize: 22,
  },
  expenseDetails: {
    flex: 1,
  },
  expenseTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  expenseMerchant: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
    marginRight: 12,
  },
  expenseAmount: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.money,
  },
  expenseBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  expenseMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  expenseDate: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  expenseDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.textMuted,
    marginHorizontal: 8,
  },
  expenseCategory: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  expenseArrow: {
    marginLeft: 8,
  },
  expenseArrowText: {
    fontSize: 20,
    color: COLORS.textMuted,
  },
  nonBillableTag: {
    marginTop: 6,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.nonBillableBg,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  nonBillableTagText: {
    fontSize: 11,
    color: COLORS.nonBillable,
    fontWeight: '600',
  },

  // Status Badge
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeCompact: {
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  statusIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  // Modal
  modalWrapper: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.overlay,
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
  modalHandle: {
    alignItems: 'center',
    paddingTop: 12,
  },
  handleBar: {
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
    paddingTop: 16,
    paddingBottom: 20,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.text,
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

  // Form
  formScroll: {
    paddingHorizontal: 24,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 10,
    fontWeight: '500',
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
    minHeight: 90,
    textAlignVertical: 'top',
    paddingTop: 16,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    paddingHorizontal: 18,
  },
  currencySymbol: {
    fontSize: 28,
    fontWeight: '600',
    color: COLORS.money,
    marginRight: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 28,
    fontWeight: '600',
    color: COLORS.text,
    paddingVertical: 16,
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  dateIcon: {
    fontSize: 18,
    marginRight: 12,
  },
  dateText: {
    fontSize: 16,
    color: COLORS.text,
  },

  // Category Grid
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  categoryChipIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  categoryChipLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },

  // Toggle
  toggleContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  toggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  toggleButtonActive: {
    backgroundColor: COLORS.reimbursableBg,
    borderColor: COLORS.reimbursable,
  },
  toggleButtonActiveWarning: {
    backgroundColor: COLORS.nonBillableBg,
    borderColor: COLORS.nonBillable,
  },
  toggleIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  toggleText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  toggleTextActive: {
    color: COLORS.reimbursable,
    fontWeight: '600',
  },
  toggleTextActiveWarning: {
    color: COLORS.nonBillable,
    fontWeight: '600',
  },

  // Receipt Capture
  captureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  captureIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: COLORS.primaryGlow,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  captureIcon: {
    fontSize: 28,
  },
  captureTextContainer: {
    flex: 1,
  },
  captureTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
  },
  captureSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  captureArrow: {
    marginLeft: 12,
  },
  captureArrowText: {
    fontSize: 20,
    color: COLORS.primary,
  },

  // Receipt Preview
  receiptPreview: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  receiptDocument: {
    backgroundColor: '#F5F5F5',
    padding: 16,
    maxHeight: 200,
    overflow: 'hidden',
  },
  receiptText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 10,
    color: '#1F2937',
    lineHeight: 14,
  },
  receiptActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  receiptActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
  },
  receiptActionIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  receiptActionText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },

  // Submit Button
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 12,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  submitButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.background,
  },

  // Detail Modal
  detailModalWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.overlay,
  },
  detailModal: {
    width: SCREEN_WIDTH - 48,
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  detailIcon: {
    width: 64,
    height: 64,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailIconText: {
    fontSize: 32,
  },
  detailAmount: {
    fontSize: 36,
    fontWeight: 'bold',
    color: COLORS.money,
    letterSpacing: -1,
  },
  detailMerchant: {
    fontSize: 18,
    color: COLORS.text,
    marginTop: 4,
    marginBottom: 24,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 16,
    gap: 16,
  },
  detailGridItem: {
    width: '45%',
  },
  detailGridLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  detailGridValue: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  detailNotes: {
    marginTop: 16,
    padding: 16,
    backgroundColor: COLORS.background,
    borderRadius: 12,
  },
  detailNotesLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  detailNotesText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  detailActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  detailActionSecondary: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  detailActionSecondaryText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  detailActionPrimary: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  detailActionPrimaryText: {
    fontSize: 15,
    color: COLORS.background,
    fontWeight: '700',
  },
});

export default ExpenseTrackerScreen;
