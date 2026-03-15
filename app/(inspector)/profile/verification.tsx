import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  ChevronLeft,
  FileText,
  Upload,
  Plus,
  Shield,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Calendar,
  Wrench,
  Hash,
  Trash2,
  Eye,
  RefreshCw,
  Award,
  Settings,
  FileCheck,
  X,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { showAlert, showConfirm } from '@/lib/alert';

// ============================================================================
// TYPES
// ============================================================================

type DocumentStatus = 'pending' | 'verified' | 'rejected' | 'expired';

interface InspectorDocument {
  id: string;
  inspector_id: string;
  doc_name: string;
  file_url: string;
  expiry_date: string | null;
  status: DocumentStatus;
  created_at: string;
  rejection_reason?: string | null;
}

interface Equipment {
  id: string;
  inspector_id: string;
  name: string;
  serial_number: string;
  calibration_expiry: string | null;
  created_at: string;
}

interface UploadingDoc {
  name: string;
  progress: number;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const DOCUMENT_STATUS_CONFIG: Record<
  DocumentStatus,
  { label: string; color: string; bgColor: string; icon: React.ReactNode }
> = {
  pending: {
    label: 'Pending Review',
    color: '#F59E0B',
    bgColor: '#FEF3C7',
    icon: <Clock size={14} color="#F59E0B" />,
  },
  verified: {
    label: 'Verified',
    color: '#22C55E',
    bgColor: '#DCFCE7',
    icon: <CheckCircle2 size={14} color="#22C55E" />,
  },
  rejected: {
    label: 'Rejected',
    color: '#EF4444',
    bgColor: '#FEE2E2',
    icon: <XCircle size={14} color="#EF4444" />,
  },
  expired: {
    label: 'Expired',
    color: '#64748B',
    bgColor: '#F1F5F9',
    icon: <AlertTriangle size={14} color="#64748B" />,
  },
};

const DOCUMENT_TYPES = [
  { id: 'license', name: 'Professional License', icon: Award },
  { id: 'insurance', name: 'Insurance Certificate', icon: Shield },
  { id: 'certification', name: 'Industry Certification', icon: FileCheck },
  { id: 'training', name: 'Training Certificate', icon: FileText },
  { id: 'other', name: 'Other Document', icon: FileText },
];

const STORAGE_BUCKET = 'inspector-docs';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const formatDate = (dateString: string | null): string => {
  if (!dateString) return 'No expiry';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const isExpiringSoon = (dateString: string | null): boolean => {
  if (!dateString) return false;
  const expiryDate = new Date(dateString);
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  return expiryDate <= thirtyDaysFromNow && expiryDate > new Date();
};

const isExpired = (dateString: string | null): boolean => {
  if (!dateString) return false;
  return new Date(dateString) < new Date();
};

const getFileExtension = (filename: string): string => {
  return filename.split('.').pop()?.toLowerCase() || '';
};

const generateUniqueFileName = (originalName: string, inspectorId: string): string => {
  const timestamp = Date.now();
  const extension = getFileExtension(originalName);
  const sanitizedName = originalName
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .substring(0, 30);
  return `${inspectorId}/${timestamp}_${sanitizedName}.${extension}`;
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// Header Component
interface HeaderProps {
  onBack: () => void;
  verificationProgress: number;
}

const Header: React.FC<HeaderProps> = ({ onBack, verificationProgress }) => (
  <View style={styles.header}>
    <TouchableOpacity
      onPress={onBack}
      style={styles.backButton}
      activeOpacity={0.7}
    >
      <ChevronLeft size={28} color="#0F172A" />
    </TouchableOpacity>
    
    <View style={styles.headerCenter}>
      <Text style={styles.headerTitle}>Verification</Text>
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View
            style={[styles.progressFill, { width: `${verificationProgress}%` }]}
          />
        </View>
        <Text style={styles.progressText}>{verificationProgress}% Complete</Text>
      </View>
    </View>
    
    <View style={styles.headerPlaceholder} />
  </View>
);

// Status Badge
const StatusBadge: React.FC<{ status: DocumentStatus }> = ({ status }) => {
  const config = DOCUMENT_STATUS_CONFIG[status];
  
  return (
    <View style={[styles.statusBadge, { backgroundColor: config.bgColor }]}>
      {config.icon}
      <Text style={[styles.statusText, { color: config.color }]}>
        {config.label}
      </Text>
    </View>
  );
};

// Document Card
interface DocumentCardProps {
  document: InspectorDocument;
  onView: (doc: InspectorDocument) => void;
  onDelete: (doc: InspectorDocument) => void;
}

const DocumentCard: React.FC<DocumentCardProps> = ({ document, onView, onDelete }) => {
  const expiringSoon = isExpiringSoon(document.expiry_date);
  const expired = isExpired(document.expiry_date);
  const effectiveStatus = expired && document.status === 'verified' ? 'expired' : document.status;

  return (
    <View style={styles.documentCard}>
      <View style={styles.documentHeader}>
        <View style={styles.documentIconContainer}>
          <FileText size={24} color="#3B82F6" />
        </View>
        <View style={styles.documentInfo}>
          <Text style={styles.documentName} numberOfLines={1}>
            {document.doc_name}
          </Text>
          <View style={styles.documentMeta}>
            <Calendar size={12} color="#64748B" />
            <Text style={[
              styles.documentExpiry,
              expiringSoon && styles.expiryWarning,
              expired && styles.expiryExpired,
            ]}>
              {expired ? 'Expired: ' : expiringSoon ? 'Expiring: ' : 'Expires: '}
              {formatDate(document.expiry_date)}
            </Text>
          </View>
        </View>
        <StatusBadge status={effectiveStatus} />
      </View>

      {document.rejection_reason && document.status === 'rejected' && (
        <View style={styles.rejectionBanner}>
          <AlertTriangle size={14} color="#EF4444" />
          <Text style={styles.rejectionText}>{document.rejection_reason}</Text>
        </View>
      )}

      <View style={styles.documentActions}>
        <TouchableOpacity
          style={styles.documentActionButton}
          onPress={() => onView(document)}
          activeOpacity={0.7}
        >
          <Eye size={18} color="#3B82F6" />
          <Text style={styles.documentActionText}>View</Text>
        </TouchableOpacity>
        
        <View style={styles.actionDivider} />
        
        <TouchableOpacity
          style={styles.documentActionButton}
          onPress={() => onDelete(document)}
          activeOpacity={0.7}
        >
          <Trash2 size={18} color="#EF4444" />
          <Text style={[styles.documentActionText, { color: '#EF4444' }]}>
            Delete
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// Equipment Card
interface EquipmentCardProps {
  equipment: Equipment;
  onDelete: (eq: Equipment) => void;
}

const EquipmentCard: React.FC<EquipmentCardProps> = ({ equipment, onDelete }) => {
  const calibrationExpired = isExpired(equipment.calibration_expiry);
  const calibrationExpiringSoon = isExpiringSoon(equipment.calibration_expiry);

  return (
    <View style={styles.equipmentCard}>
      <View style={styles.equipmentIcon}>
        <Wrench size={20} color="#8B5CF6" />
      </View>
      
      <View style={styles.equipmentContent}>
        <Text style={styles.equipmentName}>{equipment.name}</Text>
        
        <View style={styles.equipmentDetails}>
          <View style={styles.equipmentDetail}>
            <Hash size={12} color="#64748B" />
            <Text style={styles.equipmentDetailText}>
              SN: {equipment.serial_number}
            </Text>
          </View>
          
          <View style={styles.equipmentDetail}>
            <RefreshCw size={12} color={calibrationExpired ? '#EF4444' : calibrationExpiringSoon ? '#F59E0B' : '#64748B'} />
            <Text style={[
              styles.equipmentDetailText,
              calibrationExpired && styles.expiryExpired,
              calibrationExpiringSoon && styles.expiryWarning,
            ]}>
              Calibration: {formatDate(equipment.calibration_expiry)}
            </Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        onPress={() => onDelete(equipment)}
        style={styles.equipmentDeleteButton}
        activeOpacity={0.7}
      >
        <Trash2 size={18} color="#EF4444" />
      </TouchableOpacity>
    </View>
  );
};

// Document Type Picker Modal
interface DocTypePickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (type: { id: string; name: string }) => void;
}

const DocTypePicker: React.FC<DocTypePickerProps> = ({ visible, onClose, onSelect }) => (
  <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
    <SafeAreaView style={styles.modalContainer}>
      <View style={styles.modalHeader}>
        <TouchableOpacity onPress={onClose} style={styles.modalCloseButton}>
          <X size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.modalTitle}>Select Document Type</Text>
        <View style={styles.modalHeaderPlaceholder} />
      </View>

      <ScrollView style={styles.modalContent}>
        {DOCUMENT_TYPES.map((type) => {
          const IconComponent = type.icon;
          return (
            <TouchableOpacity
              key={type.id}
              style={styles.docTypeOption}
              onPress={() => onSelect(type)}
              activeOpacity={0.7}
            >
              <View style={styles.docTypeIcon}>
                <IconComponent size={24} color="#3B82F6" />
              </View>
              <Text style={styles.docTypeName}>{type.name}</Text>
              <ChevronLeft
                size={20}
                color="#94A3B8"
                style={{ transform: [{ rotate: '180deg' }] }}
              />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  </Modal>
);

// Add Equipment Modal
interface AddEquipmentModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (name: string, serialNumber: string, calibrationExpiry: Date | null) => void;
  isSubmitting: boolean;
}

const AddEquipmentModal: React.FC<AddEquipmentModalProps> = ({
  visible,
  onClose,
  onSubmit,
  isSubmitting,
}) => {
  const [name, setName] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [calibrationExpiry, setCalibrationExpiry] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const resetForm = () => {
    setName('');
    setSerialNumber('');
    setCalibrationExpiry(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = () => {
    if (!name.trim() || !serialNumber.trim()) {
      showAlert('Error', 'Please fill in all required fields');
      return;
    }
    onSubmit(name.trim(), serialNumber.trim(), calibrationExpiry);
    resetForm();
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selectedDate) {
      setCalibrationExpiry(selectedDate);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.modalCloseButton}
            disabled={isSubmitting}
          >
            <X size={24} color={isSubmitting ? '#CBD5E1' : '#0F172A'} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Add Equipment</Text>
          <View style={styles.modalHeaderPlaceholder} />
        </View>

        <ScrollView
          style={styles.modalContent}
          contentContainerStyle={styles.modalScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Equipment Icon */}
          <View style={styles.addEquipmentIcon}>
            <Settings size={40} color="#8B5CF6" />
          </View>

          {/* Name Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>
              Equipment Name <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g., Moisture Meter, Thermal Camera"
              placeholderTextColor="#94A3B8"
              value={name}
              onChangeText={setName}
              editable={!isSubmitting}
            />
          </View>

          {/* Serial Number Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>
              Serial Number <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g., SN-123456789"
              placeholderTextColor="#94A3B8"
              value={serialNumber}
              onChangeText={setSerialNumber}
              autoCapitalize="characters"
              editable={!isSubmitting}
            />
          </View>

          {/* Calibration Expiry */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Calibration Expiry Date</Text>
            <TouchableOpacity
              style={styles.datePickerButton}
              onPress={() => setShowDatePicker(true)}
              disabled={isSubmitting}
              activeOpacity={0.7}
            >
              <Calendar size={20} color="#64748B" />
              <Text style={[
                styles.datePickerText,
                !calibrationExpiry && styles.datePickerPlaceholder,
              ]}>
                {calibrationExpiry
                  ? calibrationExpiry.toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : 'Select date (optional)'}
              </Text>
            </TouchableOpacity>
          </View>

          {showDatePicker && (
            <DateTimePicker
              value={calibrationExpiry || new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handleDateChange}
              minimumDate={new Date()}
            />
          )}

          {Platform.OS === 'ios' && showDatePicker && (
            <TouchableOpacity
              style={styles.datePickerDone}
              onPress={() => setShowDatePicker(false)}
            >
              <Text style={styles.datePickerDoneText}>Done</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* Submit Button */}
        <View style={styles.modalFooter}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              (!name.trim() || !serialNumber.trim() || isSubmitting) &&
                styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!name.trim() || !serialNumber.trim() || isSubmitting}
            activeOpacity={0.8}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Plus size={20} color="#FFFFFF" />
                <Text style={styles.submitButtonText}>Add Equipment</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

// Upload Document Modal
interface UploadDocModalProps {
  visible: boolean;
  docType: { id: string; name: string } | null;
  onClose: () => void;
  onUpload: (expiryDate: Date | null) => void;
  isUploading: boolean;
  uploadProgress: number;
}

const UploadDocModal: React.FC<UploadDocModalProps> = ({
  visible,
  docType,
  onClose,
  onUpload,
  isUploading,
  uploadProgress,
}) => {
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const handleClose = () => {
    setExpiryDate(null);
    onClose();
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selectedDate) {
      setExpiryDate(selectedDate);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.modalCloseButton}
            disabled={isUploading}
          >
            <X size={24} color={isUploading ? '#CBD5E1' : '#0F172A'} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Upload Document</Text>
          <View style={styles.modalHeaderPlaceholder} />
        </View>

        <ScrollView
          style={styles.modalContent}
          contentContainerStyle={styles.modalScrollContent}
        >
          {/* Document Type Display */}
          <View style={styles.selectedDocType}>
            <FileCheck size={32} color="#3B82F6" />
            <Text style={styles.selectedDocTypeName}>{docType?.name}</Text>
          </View>

          {/* Expiry Date Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Document Expiry Date</Text>
            <TouchableOpacity
              style={styles.datePickerButton}
              onPress={() => setShowDatePicker(true)}
              disabled={isUploading}
              activeOpacity={0.7}
            >
              <Calendar size={20} color="#64748B" />
              <Text style={[
                styles.datePickerText,
                !expiryDate && styles.datePickerPlaceholder,
              ]}>
                {expiryDate
                  ? expiryDate.toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : 'Select expiry date (optional)'}
              </Text>
            </TouchableOpacity>
          </View>

          {showDatePicker && (
            <DateTimePicker
              value={expiryDate || new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handleDateChange}
              minimumDate={new Date()}
            />
          )}

          {Platform.OS === 'ios' && showDatePicker && (
            <TouchableOpacity
              style={styles.datePickerDone}
              onPress={() => setShowDatePicker(false)}
            >
              <Text style={styles.datePickerDoneText}>Done</Text>
            </TouchableOpacity>
          )}

          {/* Upload Progress */}
          {isUploading && (
            <View style={styles.uploadProgressContainer}>
              <View style={styles.uploadProgressBar}>
                <View
                  style={[
                    styles.uploadProgressFill,
                    { width: `${uploadProgress}%` },
                  ]}
                />
              </View>
              <Text style={styles.uploadProgressText}>
                Uploading... {uploadProgress}%
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Upload Button */}
        <View style={styles.modalFooter}>
          <TouchableOpacity
            style={[styles.uploadButton, isUploading && styles.uploadButtonDisabled]}
            onPress={() => onUpload(expiryDate)}
            disabled={isUploading}
            activeOpacity={0.8}
          >
            {isUploading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Upload size={20} color="#FFFFFF" />
                <Text style={styles.uploadButtonText}>Select & Upload File</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

// Empty State Component
interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
}) => (
  <View style={styles.emptyState}>
    <View style={styles.emptyStateIcon}>{icon}</View>
    <Text style={styles.emptyStateTitle}>{title}</Text>
    <Text style={styles.emptyStateSubtitle}>{subtitle}</Text>
    <TouchableOpacity
      style={styles.emptyStateButton}
      onPress={onAction}
      activeOpacity={0.8}
    >
      <Plus size={18} color="#FFFFFF" />
      <Text style={styles.emptyStateButtonText}>{actionLabel}</Text>
    </TouchableOpacity>
  </View>
);

// Loading Screen
const LoadingScreen: React.FC = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#3B82F6" />
    <Text style={styles.loadingText}>Loading verification data...</Text>
  </View>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function VerificationScreen() {
  const router = useRouter();

  // State
  const [documents, setDocuments] = useState<InspectorDocument[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Modal States
  const [showDocTypePicker, setShowDocTypePicker] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showEquipmentModal, setShowEquipmentModal] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState<{ id: string; name: string } | null>(null);

  // Upload States
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isSubmittingEquipment, setIsSubmittingEquipment] = useState(false);

  // ========================================
  // DATA FETCHING
  // ========================================

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        showAlert('Error', 'Please sign in to continue');
        router.back();
        return;
      }

      setCurrentUserId(user.id);

      // Fetch documents and equipment in parallel
      const [docsResult, equipResult] = await Promise.all([
        supabase
          .from('inspector_documents')
          .select('*')
          .eq('inspector_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('equipment')
          .select('*')
          .eq('inspector_id', user.id)
          .order('created_at', { ascending: false }),
      ]);

      if (docsResult.error) throw docsResult.error;
      if (equipResult.error) throw equipResult.error;

      setDocuments(docsResult.data || []);
      setEquipment(equipResult.data || []);
    } catch (error) {
      console.error('Fetch error:', error);
      showAlert('Error', 'Failed to load verification data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  // ========================================
  // DOCUMENT HANDLERS
  // ========================================

  const handleSelectDocType = (type: { id: string; name: string }) => {
    setSelectedDocType(type);
    setShowDocTypePicker(false);
    setShowUploadModal(true);
  };

  const handleUploadDocument = async (expiryDate: Date | null) => {
    if (!currentUserId || !selectedDocType) return;

    try {
      setIsUploading(true);
      setUploadProgress(0);

      // Pick document
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) {
        setIsUploading(false);
        return;
      }

      const file = result.assets[0];
      setUploadProgress(20);

      // Generate unique filename
      const fileName = generateUniqueFileName(file.name, currentUserId);
      
      // Read file and upload
      const response = await fetch(file.uri);
      const blob = await response.blob();
      setUploadProgress(50);

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(fileName, blob, {
          contentType: file.mimeType || 'application/octet-stream',
          upsert: false,
        });

      if (uploadError) throw uploadError;
      setUploadProgress(80);

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(fileName);

      // Insert document record
      const { data: docData, error: docError } = await supabase
        .from('inspector_documents')
        .insert({
          inspector_id: currentUserId,
          doc_name: `${selectedDocType.name} - ${file.name}`,
          file_url: urlData?.publicUrl,
          expiry_date: expiryDate?.toISOString() || null,
          status: 'pending',
        })
        .select()
        .single();

      if (docError) throw docError;
      setUploadProgress(100);

      // Update local state
      setDocuments((prev) => [docData, ...prev]);

      // Close modal and show success
      setShowUploadModal(false);
      setSelectedDocType(null);
      showAlert('Success', 'Document uploaded successfully! It will be reviewed shortly.');
    } catch (error) {
      console.error('Upload error:', error);
      showAlert('Error', 'Failed to upload document. Please try again.');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleViewDocument = (doc: InspectorDocument) => {
    // Open document URL in browser or viewer
    showAlert('View Document', `Opening: ${doc.doc_name}`);
    // In production, use Linking.openURL(doc.file_url)
  };

  const handleDeleteDocument = (doc: InspectorDocument) => {
    showConfirm(
      'Delete Document',
      `Are you sure you want to delete "${doc.doc_name}"?`,
      async () => {
        try {
          // Delete from database
          const { error } = await supabase
            .from('inspector_documents')
            .delete()
            .eq('id', doc.id);

          if (error) throw error;

          // Delete from storage (extract path from URL)
          const urlParts = doc.file_url.split('/');
          const filePath = urlParts.slice(-2).join('/');
          await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);

          // Update local state
          setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
          showAlert('Success', 'Document deleted successfully');
        } catch (error) {
          console.error('Delete error:', error);
          showAlert('Error', 'Failed to delete document');
        }
      }
    );
  };

  // ========================================
  // EQUIPMENT HANDLERS
  // ========================================

  const handleAddEquipment = async (
    name: string,
    serialNumber: string,
    calibrationExpiry: Date | null
  ) => {
    if (!currentUserId) return;

    setIsSubmittingEquipment(true);

    try {
      const { data, error } = await supabase
        .from('equipment')
        .insert({
          inspector_id: currentUserId,
          name,
          serial_number: serialNumber,
          calibration_expiry: calibrationExpiry?.toISOString() || null,
        })
        .select()
        .single();

      if (error) throw error;

      setEquipment((prev) => [data, ...prev]);
      setShowEquipmentModal(false);
      showAlert('Success', 'Equipment added successfully!');
    } catch (error) {
      console.error('Add equipment error:', error);
      showAlert('Error', 'Failed to add equipment. Please try again.');
    } finally {
      setIsSubmittingEquipment(false);
    }
  };

  const handleDeleteEquipment = (eq: Equipment) => {
    showConfirm(
      'Delete Equipment',
      `Are you sure you want to delete "${eq.name}"?`,
      async () => {
        try {
          const { error } = await supabase
            .from('equipment')
            .delete()
            .eq('id', eq.id);

          if (error) throw error;

          setEquipment((prev) => prev.filter((e) => e.id !== eq.id));
          showAlert('Success', 'Equipment deleted successfully');
        } catch (error) {
          console.error('Delete equipment error:', error);
          showAlert('Error', 'Failed to delete equipment');
        }
      }
    );
  };

  // ========================================
  // COMPUTED VALUES
  // ========================================

  const verifiedDocs = documents.filter((d) => d.status === 'verified' && !isExpired(d.expiry_date));
  const verificationProgress = Math.min(
    100,
    Math.round(
      ((verifiedDocs.length * 2 + equipment.length) / 7) * 100
    )
  );

  // ========================================
  // RENDER
  // ========================================

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header onBack={() => router.back()} verificationProgress={0} />
        <LoadingScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header onBack={() => router.back()} verificationProgress={verificationProgress} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#3B82F6"
          />
        }
      >
        {/* Verification Status Card */}
        <View style={styles.statusCard}>
          <View style={styles.statusCardHeader}>
            <Shield size={24} color="#3B82F6" />
            <Text style={styles.statusCardTitle}>Verification Status</Text>
          </View>
          <Text style={styles.statusCardDescription}>
            Upload your professional documents and equipment details to get verified
            and increase your visibility to clients.
          </Text>
          <View style={styles.statusStats}>
            <View style={styles.statusStat}>
              <Text style={styles.statusStatValue}>{documents.length}</Text>
              <Text style={styles.statusStatLabel}>Documents</Text>
            </View>
            <View style={styles.statusStatDivider} />
            <View style={styles.statusStat}>
              <Text style={styles.statusStatValue}>{verifiedDocs.length}</Text>
              <Text style={styles.statusStatLabel}>Verified</Text>
            </View>
            <View style={styles.statusStatDivider} />
            <View style={styles.statusStat}>
              <Text style={styles.statusStatValue}>{equipment.length}</Text>
              <Text style={styles.statusStatLabel}>Equipment</Text>
            </View>
          </View>
        </View>

        {/* Documents Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <FileText size={22} color="#0F172A" />
              <Text style={styles.sectionTitle}>Professional Documents</Text>
            </View>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => setShowDocTypePicker(true)}
              activeOpacity={0.8}
            >
              <Plus size={18} color="#FFFFFF" />
              <Text style={styles.addButtonText}>Upload</Text>
            </TouchableOpacity>
          </View>

          {documents.length === 0 ? (
            <EmptyState
              icon={<FileText size={48} color="#CBD5E1" />}
              title="No Documents Yet"
              subtitle="Upload your licenses, certifications, and insurance documents"
              actionLabel="Upload Document"
              onAction={() => setShowDocTypePicker(true)}
            />
          ) : (
            <View style={styles.cardList}>
              {documents.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  document={doc}
                  onView={handleViewDocument}
                  onDelete={handleDeleteDocument}
                />
              ))}
            </View>
          )}
        </View>

        {/* Equipment Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Wrench size={22} color="#0F172A" />
              <Text style={styles.sectionTitle}>Equipment & Tools</Text>
            </View>
            <TouchableOpacity
              style={[styles.addButton, styles.addButtonPurple]}
              onPress={() => setShowEquipmentModal(true)}
              activeOpacity={0.8}
            >
              <Plus size={18} color="#FFFFFF" />
              <Text style={styles.addButtonText}>Add</Text>
            </TouchableOpacity>
          </View>

          {equipment.length === 0 ? (
            <EmptyState
              icon={<Settings size={48} color="#CBD5E1" />}
              title="No Equipment Listed"
              subtitle="Add your inspection tools and equipment with calibration details"
              actionLabel="Add Equipment"
              onAction={() => setShowEquipmentModal(true)}
            />
          ) : (
            <View style={styles.cardList}>
              {equipment.map((eq) => (
                <EquipmentCard
                  key={eq.id}
                  equipment={eq}
                  onDelete={handleDeleteEquipment}
                />
              ))}
            </View>
          )}
        </View>

        {/* Bottom Spacer */}
        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Modals */}
      <DocTypePicker
        visible={showDocTypePicker}
        onClose={() => setShowDocTypePicker(false)}
        onSelect={handleSelectDocType}
      />

      <UploadDocModal
        visible={showUploadModal}
        docType={selectedDocType}
        onClose={() => {
          setShowUploadModal(false);
          setSelectedDocType(null);
        }}
        onUpload={handleUploadDocument}
        isUploading={isUploading}
        uploadProgress={uploadProgress}
      />

      <AddEquipmentModal
        visible={showEquipmentModal}
        onClose={() => setShowEquipmentModal(false)}
        onSubmit={handleAddEquipment}
        isSubmitting={isSubmittingEquipment}
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

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -8,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 8,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressBar: {
    width: 100,
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#22C55E',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  headerPlaceholder: {
    width: 40,
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },

  // Status Card
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  statusCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  statusCardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  statusCardDescription: {
    fontSize: 14,
    color: '#64748B',
    lineHeight: 20,
    marginBottom: 20,
  },
  statusStats: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 16,
  },
  statusStat: {
    flex: 1,
    alignItems: 'center',
  },
  statusStatValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
  },
  statusStatLabel: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
  },
  statusStatDivider: {
    width: 1,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 8,
  },

  // Section
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3B82F6',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 6,
  },
  addButtonPurple: {
    backgroundColor: '#8B5CF6',
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // Card List
  cardList: {
    gap: 12,
  },

  // Document Card
  documentCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  documentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  documentIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  documentInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  documentName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 4,
  },
  documentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  documentExpiry: {
    fontSize: 12,
    color: '#64748B',
  },
  expiryWarning: {
    color: '#F59E0B',
  },
  expiryExpired: {
    color: '#EF4444',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  rejectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
    gap: 8,
  },
  rejectionText: {
    flex: 1,
    fontSize: 12,
    color: '#EF4444',
    lineHeight: 16,
  },
  documentActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    marginTop: 12,
    paddingTop: 12,
  },
  documentActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 6,
  },
  documentActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3B82F6',
  },
  actionDivider: {
    width: 1,
    backgroundColor: '#F1F5F9',
  },

  // Equipment Card
  equipmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  equipmentIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F3E8FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  equipmentContent: {
    flex: 1,
    marginLeft: 12,
  },
  equipmentName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 6,
  },
  equipmentDetails: {
    gap: 4,
  },
  equipmentDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  equipmentDetailText: {
    fontSize: 12,
    color: '#64748B',
  },
  equipmentDeleteButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Empty State
  emptyState: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#F1F5F9',
    borderStyle: 'dashed',
  },
  emptyStateIcon: {
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E293B',
    marginBottom: 8,
  },
  emptyStateSubtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  emptyStateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3B82F6',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  emptyStateButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalCloseButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -8,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#0F172A',
  },
  modalHeaderPlaceholder: {
    width: 40,
  },
  modalContent: {
    flex: 1,
  },
  modalScrollContent: {
    padding: 20,
  },
  modalFooter: {
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 8 : 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },

  // Doc Type Options
  docTypeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  docTypeIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  docTypeName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: '#0F172A',
  },

  // Selected Doc Type
  selectedDocType: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    marginBottom: 24,
  },
  selectedDocTypeName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
    marginTop: 12,
  },

  // Add Equipment Icon
  addEquipmentIcon: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#F3E8FF',
    borderRadius: 16,
    marginBottom: 24,
    alignSelf: 'center',
    width: 100,
  },

  // Form Inputs
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
    marginBottom: 8,
  },
  required: {
    color: '#EF4444',
  },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#0F172A',
  },
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  datePickerText: {
    fontSize: 15,
    color: '#0F172A',
    flex: 1,
  },
  datePickerPlaceholder: {
    color: '#94A3B8',
  },
  datePickerDone: {
    alignSelf: 'center',
    backgroundColor: '#3B82F6',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 8,
  },
  datePickerDoneText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },

  // Upload Progress
  uploadProgressContainer: {
    marginTop: 24,
  },
  uploadProgressBar: {
    height: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  uploadProgressFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 4,
  },
  uploadProgressText: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
  },

  // Buttons
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8B5CF6',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  submitButtonDisabled: {
    backgroundColor: '#CBD5E1',
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3B82F6',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  uploadButtonDisabled: {
    backgroundColor: '#93C5FD',
  },
  uploadButtonText: {
    fontSize: 16,
    fontWeight: '700',
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

