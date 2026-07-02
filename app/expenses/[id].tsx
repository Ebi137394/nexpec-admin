import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  ActivityIndicator,
  Modal,
  Platform,
  KeyboardAvoidingView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../../lib/supabase';
import { signedUrls, SIGNED_URL_TTL } from '@/src/core/storage/signedUrls';

// =============================================================================
// TYPES
// =============================================================================

interface Expense {
  id: string;
  job_id: string;
  user_id: string;
  amount: number;
  description: string;
  category: string;
  receipt_url: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

interface Job {
  id: string;
  title: string;
  company_name: string;
}

// =============================================================================
// COLORS - Dark Theme
// =============================================================================

const COLORS = {
  background: '#020420',
  card: '#1e293b',
  cardBorder: '#334155',
  primary: '#3b82f6',
  primaryDark: '#2563eb',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  success: '#22c55e',
  danger: '#ef4444',
  warning: '#f59e0b',
  inputBg: '#0f172a',
  pending: '#f59e0b',
  approved: '#22c55e',
  rejected: '#ef4444',
};

const EXPENSE_CATEGORIES = [
  { id: 'travel', label: 'Travel', icon: 'car' },
  { id: 'food', label: 'Food & Meals', icon: 'restaurant' },
  { id: 'lodging', label: 'Lodging', icon: 'bed' },
  { id: 'equipment', label: 'Equipment', icon: 'construct' },
  { id: 'supplies', label: 'Supplies', icon: 'cube' },
  { id: 'other', label: 'Other', icon: 'ellipsis-horizontal' },
];

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function ExpensesScreen() {
  const { id: jobId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  // State
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  // receipt_url now stores a PATH in the locked `receipts` bucket; mint a signed
  // URL per expense for display. Keyed by expense id. (Never await in JSX.)
  const [receiptSignedUrls, setReceiptSignedUrls] = useState<Record<string, string | null>>({});

  // New Expense Form
  const [newExpense, setNewExpense] = useState({
    amount: '',
    description: '',
    category: 'travel',
    receipt_uri: '',
  });

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  useEffect(() => {
    initializeData();
  }, [jobId]);

  // Mint signed URLs for any expense whose receipt_url (now a storage PATH in the
  // locked `receipts` bucket) hasn't been minted yet. Runs after expenses load /
  // refresh / add. Minting happens here, never inside JSX render.
  useEffect(() => {
    const pending = expenses
      .map((e) => e.receipt_url)
      .filter((p): p is string => !!p && !(p in receiptSignedUrls));
    if (pending.length === 0) return;

    let cancelled = false;
    (async () => {
      const minted = await signedUrls('receipts', pending, SIGNED_URL_TTL.VIEW);
      if (!cancelled) setReceiptSignedUrls((prev) => ({ ...prev, ...minted }));
    })();

    return () => { cancelled = true; };
  }, [expenses]);

  const initializeData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        Alert.alert('Error', 'Please log in to view expenses');
        router.back();
        return;
      }

      setUserId(user.id);
      
      await Promise.all([
        fetchExpenses(user.id),
        fetchJob(),
      ]);
    } catch (error) {
      console.error('Error initializing:', error);
      Alert.alert('Error', 'Failed to load expenses');
    } finally {
      setLoading(false);
    }
  };

  const fetchExpenses = async (uid: string) => {
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .eq('job_id', jobId)
      .eq('user_id', uid)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching expenses:', error);
      return;
    }

    if (data) {
      setExpenses(data);
    }
  };

  const fetchJob = async () => {
    const { data, error } = await supabase
      .from('jobs')
      .select('id, title, company_name')
      .eq('id', jobId)
      .single();

    if (error) {
      console.error('Error fetching job:', error);
    }

    if (data) {
      setJob(data);
    }
  };

  const onRefresh = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true);
    await fetchExpenses(userId);
    setRefreshing(false);
  }, [userId, jobId]);

  // ===========================================================================
  // CALCULATIONS
  // ===========================================================================

  const calculateTotal = () => {
    return expenses.reduce((sum, expense) => sum + expense.amount, 0);
  };

  const calculateApprovedTotal = () => {
    return expenses
      .filter(e => e.status === 'approved')
      .reduce((sum, expense) => sum + expense.amount, 0);
  };

  const calculatePendingTotal = () => {
    return expenses
      .filter(e => e.status === 'pending')
      .reduce((sum, expense) => sum + expense.amount, 0);
  };

  // ===========================================================================
  // IMAGE HANDLING
  // ===========================================================================

  const pickReceiptImage = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (!permissionResult.granted) {
        Alert.alert(
          'Permission Required',
          'Please allow access to your photo library to upload receipt images.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7,
      });

      if (!result.canceled && result.assets[0]) {
        setNewExpense(prev => ({ ...prev, receipt_uri: result.assets[0].uri }));
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  const takeReceiptPhoto = async () => {
    try {
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      
      if (!permissionResult.granted) {
        Alert.alert(
          'Permission Required',
          'Please allow camera access to take receipt photos.'
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7,
      });

      if (!result.canceled && result.assets[0]) {
        setNewExpense(prev => ({ ...prev, receipt_uri: result.assets[0].uri }));
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo');
    }
  };

  const showImageOptions = () => {
    Alert.alert(
      'Add Receipt',
      'Choose how to add your receipt image',
      [
        { text: 'Camera', onPress: takeReceiptPhoto },
        { text: 'Gallery', onPress: pickReceiptImage },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  /**
   * Upload receipt image to Supabase Storage.
   * The `receipts` bucket is locked to owner+admin, so a public URL would be a
   * dead link. We STORE the storage PATH and mint a signed URL at read time.
   */
  const uploadReceiptImage = async (uri: string): Promise<string | null> => {
    try {
      const timestamp = Date.now();
      const fileName = `receipt_${userId}_${timestamp}.jpg`;
      const filePath = `receipts/${jobId}/${fileName}`;

      // Step 1: Read file as base64
      const base64Data = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Step 2: Convert base64 to ArrayBuffer
      const arrayBuffer = decode(base64Data);

      // Step 3: Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(filePath, arrayBuffer, {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw uploadError;
      }

      // Step 4: Persist the storage PATH (not a public URL).
      // A signed URL is minted on display via signedUrl().
      const receiptUrl = filePath;

      return receiptUrl;

    } catch (error) {
      console.error('Error uploading receipt:', error);
      return null;
    }
  };

  // ===========================================================================
  // ADD EXPENSE
  // ===========================================================================

  const validateExpense = (): boolean => {
    const amount = parseFloat(newExpense.amount);
    
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid expense amount');
      return false;
    }

    if (!newExpense.description.trim()) {
      Alert.alert('Missing Description', 'Please enter a description for this expense');
      return false;
    }

    return true;
  };

  const addExpense = async () => {
    if (!validateExpense() || !userId) return;

    setSaving(true);

    try {
      // Upload receipt if selected
      let receiptUrl: string | null = null;
      let receiptUploadFailed = false;

      if (newExpense.receipt_uri) {
        receiptUrl = await uploadReceiptImage(newExpense.receipt_uri);
        // Continue even if upload fails — but say so honestly below.
        if (!receiptUrl) receiptUploadFailed = true;
      }

      // Insert expense
      const { data, error } = await supabase
        .from('expenses')
        .insert({
          job_id: jobId,
          user_id: userId,
          amount: parseFloat(newExpense.amount),
          description: newExpense.description.trim(),
          category: newExpense.category,
          receipt_url: receiptUrl,
          status: 'pending',
        })
        .select()
        .single();

      if (error) throw error;

      // Update local state
      setExpenses(prev => [data, ...prev]);

      // Reset form and close modal
      setNewExpense({
        amount: '',
        description: '',
        category: 'travel',
        receipt_uri: '',
      });
      setShowModal(false);

      if (receiptUploadFailed) {
        Alert.alert(
          'Expense Saved',
          'Expense saved, but the receipt upload failed — you can re-attach it later.'
        );
      } else {
        Alert.alert('Success', 'Expense added successfully!');
      }

    } catch (error: any) {
      console.error('Error adding expense:', error);
      Alert.alert('Error', error.message || 'Failed to add expense');
    } finally {
      setSaving(false);
    }
  };

  // ===========================================================================
  // DELETE EXPENSE
  // ===========================================================================

  const deleteExpense = async (expense: Expense) => {
    Alert.alert(
      'Delete Expense',
      'Are you sure you want to delete this expense?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('expenses')
                .delete()
                .eq('id', expense.id);

              if (error) throw error;

              // Try to delete receipt from storage.
              // receipt_url stores the FULL object key within the `receipts`
              // bucket (`receipts/<jobId>/<file>` — the upload path keeps a
              // `receipts/` prefix inside the bucket, see uploadReceiptImage).
              // Bare keys pass through unchanged; legacy full-URL rows extract
              // the key after the bucket segment, preserving that prefix.
              if (expense.receipt_url) {
                try {
                  const storagePath = expense.receipt_url.startsWith('receipts/')
                    ? expense.receipt_url
                    : expense.receipt_url.match(/\/receipts\/(.+)$/)?.[1] ?? expense.receipt_url;
                  await supabase.storage.from('receipts').remove([storagePath]);
                } catch (e) {
                  console.log('Could not delete receipt file:', e);
                }
              }

              setExpenses(prev => prev.filter(e => e.id !== expense.id));
              Alert.alert('Success', 'Expense deleted');
              
            } catch (error: any) {
              console.error('Error deleting expense:', error);
              Alert.alert('Error', error.message || 'Failed to delete expense');
            }
          },
        },
      ]
    );
  };

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getCategoryConfig = (categoryId: string) => {
    return EXPENSE_CATEGORIES.find(c => c.id === categoryId) || EXPENSE_CATEGORIES[5];
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'approved':
        return { label: 'Approved', color: COLORS.approved, icon: 'checkmark-circle' };
      case 'rejected':
        return { label: 'Rejected', color: COLORS.rejected, icon: 'close-circle' };
      default:
        return { label: 'Pending', color: COLORS.pending, icon: 'time' };
    }
  };

  // ===========================================================================
  // RENDER: LOADING STATE
  // ===========================================================================

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen
          options={{
            headerShown: false,
          }}
        />
        {/* Custom Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 8, marginRight: 8 }}>
            <Ionicons name="arrow-back" size={24} color="white" />
          </TouchableOpacity>
          <Text style={{ color: 'white', fontSize: 20, fontWeight: 'bold' }}>
            Job Expenses
          </Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading expenses...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ===========================================================================
  // MAIN RENDER
  // ===========================================================================

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />

      {/* Custom Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8, marginRight: 8 }}>
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <Text style={{ color: 'white', fontSize: 20, fontWeight: 'bold' }}>
          Job Expenses
        </Text>
      </View>

      {/* Job Header */}
      {job && (
        <View style={styles.jobHeader}>
          <Text style={styles.jobTitle} numberOfLines={1}>{job.title}</Text>
          <Text style={styles.jobCompany}>{job.company_name}</Text>
        </View>
      )}

      {/* Summary Cards */}
      <View style={styles.summaryContainer}>
        <View style={[styles.summaryCard, styles.summaryCardPrimary]}>
          <Text style={styles.summaryLabel}>Total</Text>
          <Text style={styles.summaryAmount}>{formatCurrency(calculateTotal())}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Approved</Text>
          <Text style={[styles.summaryAmount, { color: COLORS.approved }]}>
            {formatCurrency(calculateApprovedTotal())}
          </Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Pending</Text>
          <Text style={[styles.summaryAmount, { color: COLORS.pending }]}>
            {formatCurrency(calculatePendingTotal())}
          </Text>
        </View>
      </View>

      {/* Expenses List */}
      <ScrollView
        style={styles.listContainer}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
          />
        }
      >
        {expenses.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={64} color={COLORS.textSecondary} />
            <Text style={styles.emptyStateTitle}>No Expenses Yet</Text>
            <Text style={styles.emptyStateText}>
              Track your travel, meals, and other job-related expenses here.
            </Text>
          </View>
        ) : (
          expenses.map((expense) => {
            const category = getCategoryConfig(expense.category);
            const status = getStatusConfig(expense.status);
            
            return (
              <View key={expense.id} style={styles.expenseCard}>
                <View style={styles.expenseHeader}>
                  <View style={styles.expenseIconContainer}>
                    <Ionicons name={category.icon as any} size={24} color={COLORS.primary} />
                  </View>
                  <View style={styles.expenseInfo}>
                    <Text style={styles.expenseDescription} numberOfLines={2}>
                      {expense.description}
                    </Text>
                    <View style={styles.expenseMeta}>
                      <Text style={styles.expenseCategory}>{category.label}</Text>
                      <Text style={styles.expenseDate}>{formatDate(expense.created_at)}</Text>
                    </View>
                  </View>
                  <View style={styles.expenseAmountContainer}>
                    <Text style={styles.expenseAmount}>{formatCurrency(expense.amount)}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: status.color + '20' }]}>
                      <Ionicons name={status.icon as any} size={12} color={status.color} />
                      <Text style={[styles.statusText, { color: status.color }]}>
                        {status.label}
                      </Text>
                    </View>
                  </View>
                </View>

                {expense.receipt_url && receiptSignedUrls[expense.receipt_url] && (
                  <View style={styles.receiptPreview}>
                    <Image
                      source={{ uri: receiptSignedUrls[expense.receipt_url]! }}
                      style={styles.receiptImage}
                      resizeMode="cover"
                    />
                    <View style={styles.receiptOverlay}>
                      <Ionicons name="receipt" size={16} color="#fff" />
                      <Text style={styles.receiptLabel}>Receipt Attached</Text>
                    </View>
                  </View>
                )}

                {expense.status === 'pending' && (
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => deleteExpense(expense)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Floating Action Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowModal(true)}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Add Expense Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        transparent
        onRequestClose={() => !saving && setShowModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />

            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Expense</Text>
              <TouchableOpacity
                onPress={() => !saving && setShowModal(false)}
                disabled={saving}
              >
                <Ionicons
                  name="close-circle"
                  size={28}
                  color={saving ? COLORS.textSecondary : COLORS.text}
                />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Amount Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Amount *</Text>
                <View style={styles.amountInputContainer}>
                  <Text style={styles.currencySymbol}>$</Text>
                  <TextInput
                    style={styles.amountInput}
                    value={newExpense.amount}
                    onChangeText={(text) => {
                      // Only allow numbers and decimal
                      const cleaned = text.replace(/[^0-9.]/g, '');
                      setNewExpense(prev => ({ ...prev, amount: cleaned }));
                    }}
                    placeholder="0.00"
                    placeholderTextColor={COLORS.textSecondary}
                    keyboardType="decimal-pad"
                    editable={!saving}
                  />
                </View>
              </View>

              {/* Category Selection */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Category</Text>
                <ScrollView 
                  horizontal 
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.categoriesContainer}
                >
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <TouchableOpacity
                      key={cat.id}
                      style={[
                        styles.categoryChip,
                        newExpense.category === cat.id && styles.categoryChipActive,
                      ]}
                      onPress={() => setNewExpense(prev => ({ ...prev, category: cat.id }))}
                      disabled={saving}
                    >
                      <Ionicons
                        name={cat.icon as any}
                        size={18}
                        color={newExpense.category === cat.id ? '#fff' : COLORS.textSecondary}
                      />
                      <Text
                        style={[
                          styles.categoryChipText,
                          newExpense.category === cat.id && styles.categoryChipTextActive,
                        ]}
                      >
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* Description Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Description *</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={newExpense.description}
                  onChangeText={(text) => setNewExpense(prev => ({ ...prev, description: text }))}
                  placeholder="e.g., Uber to job site, Client dinner, Hotel stay..."
                  placeholderTextColor={COLORS.textSecondary}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  editable={!saving}
                />
              </View>

              {/* Receipt Image */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Receipt (Optional)</Text>
                <TouchableOpacity
                  style={styles.imagePicker}
                  onPress={showImageOptions}
                  disabled={saving}
                  activeOpacity={0.7}
                >
                  {newExpense.receipt_uri ? (
                    <View style={styles.imagePreviewContainer}>
                      <Image
                        source={{ uri: newExpense.receipt_uri }}
                        style={styles.previewImage}
                        resizeMode="cover"
                      />
                      <TouchableOpacity
                        style={styles.removeImageButton}
                        onPress={() => setNewExpense(prev => ({ ...prev, receipt_uri: '' }))}
                      >
                        <Ionicons name="close-circle" size={24} color={COLORS.danger} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.imagePickerPlaceholder}>
                      <Ionicons name="camera-outline" size={40} color={COLORS.primary} />
                      <Text style={styles.imagePickerTitle}>Add Receipt Image</Text>
                      <Text style={styles.imagePickerText}>
                        Take a photo or choose from gallery
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>

            {/* Save Button */}
            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={addExpense}
              disabled={saving}
              activeOpacity={0.8}
            >
              {saving ? (
                <View style={styles.loadingButton}>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={styles.saveButtonText}>Saving...</Text>
                </View>
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={22} color="#fff" />
                  <Text style={styles.saveButtonText}>Add Expense</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    color: COLORS.textSecondary,
    fontSize: 16,
  },

  // Job Header
  jobHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  jobTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  jobCompany: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },

  // Summary Cards
  summaryContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  summaryCardPrimary: {
    backgroundColor: COLORS.primary + '20',
    borderColor: COLORS.primary,
  },
  summaryLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  summaryAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },

  // List
  listContainer: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 20,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },

  // Expense Card
  expenseCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    position: 'relative',
  },
  expenseHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  expenseIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: COLORS.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  expenseInfo: {
    flex: 1,
    marginLeft: 12,
  },
  expenseDescription: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
    lineHeight: 20,
  },
  expenseMeta: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 12,
  },
  expenseCategory: {
    fontSize: 13,
    color: COLORS.primary,
  },
  expenseDate: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  expenseAmountContainer: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  expenseAmount: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
  },
  receiptPreview: {
    marginTop: 12,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  receiptImage: {
    width: '100%',
    height: 120,
    backgroundColor: COLORS.inputBg,
  },
  receiptOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 6,
  },
  receiptLabel: {
    fontSize: 12,
    color: '#fff',
    marginLeft: 6,
  },
  deleteButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    padding: 4,
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingTop: 12,
    maxHeight: '90%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: COLORS.cardBorder,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
  },

  // Form Elements
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: COLORS.text,
    fontSize: 16,
  },
  textArea: {
    height: 90,
    textAlignVertical: 'top',
    paddingTop: 14,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    paddingHorizontal: 16,
  },
  currencySymbol: {
    fontSize: 24,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginRight: 8,
  },
  amountInput: {
    flex: 1,
    paddingVertical: 14,
    color: COLORS.text,
    fontSize: 24,
    fontWeight: '600',
  },

  // Categories
  categoriesContainer: {
    gap: 10,
    paddingVertical: 4,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    gap: 6,
  },
  categoryChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  categoryChipText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  categoryChipTextActive: {
    color: '#fff',
    fontWeight: '500',
  },

  // Image Picker
  imagePicker: {
    backgroundColor: COLORS.inputBg,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.cardBorder,
    borderStyle: 'dashed',
    overflow: 'hidden',
  },
  imagePickerPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
  },
  imagePickerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 12,
  },
  imagePickerText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  imagePreviewContainer: {
    position: 'relative',
  },
  previewImage: {
    width: '100%',
    height: 180,
  },
  removeImageButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
  },

  // Save Button
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 8,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    marginLeft: 8,
  },
  loadingButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  bottomSpacer: {
    height: 40,
  },
});

