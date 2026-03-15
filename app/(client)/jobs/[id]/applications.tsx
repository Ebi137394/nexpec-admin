import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Modal,
  ScrollView,
  Animated,
  Platform,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ChevronLeft,
  Star,
  MapPin,
  Clock,
  Briefcase,
  CheckCircle2,
  XCircle,
  User,
  Shield,
  Award,
  MessageSquare,
  Calendar,
  DollarSign,
  ChevronRight,
  X,
  Send,
  ThumbsUp,
  Bookmark,
  BookmarkCheck,
  AlertTriangle,
  Zap,
  Filter,
  Users,
  Check,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { showAlert, showConfirm } from '@/lib/alert';

// ============================================================================
// TYPES
// ============================================================================

interface Application {
  application_id: string;
  job_id: string;
  applicant_id: string;
  application_status: 'pending' | 'shortlisted' | 'offered' | 'accepted' | 'rejected' | 'withdrawn';
  cover_letter: string | null;
  proposed_price: number | null;
  availability_date: string | null;
  applied_at: string;
  
  job_title: string;
  job_price: number;
  job_status: string;
  escrow_status: string;
  
  inspector_full_name: string;
  inspector_avatar: string | null;
  inspector_bio: string | null;
  inspector_is_verified: boolean;
  inspector_hourly_rate: number | null;
  inspector_years_experience: number;
  inspector_skills: string[];
  inspector_ndt_methods: string[];
  inspector_certifications: string[];
  inspector_location: string;
  inspector_completed_jobs: number;
  inspector_response_time: number;
  inspector_rating: number;
  inspector_review_count: number;
  inspector_is_available: boolean;
  inspector_availability_status: 'online' | 'recently_active' | 'offline';
  inspector_recommend_percent: number;
}

type FilterOption = 'all' | 'pending' | 'shortlisted' | 'offered';

// ============================================================================
// CONSTANTS
// ============================================================================

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: '#F59E0B', bgColor: '#FEF3C7' },
  shortlisted: { label: 'Shortlisted', color: '#8B5CF6', bgColor: '#EDE9FE' },
  offered: { label: 'Offer Sent', color: '#3B82F6', bgColor: '#DBEAFE' },
  accepted: { label: 'Hired', color: '#22C55E', bgColor: '#DCFCE7' },
  rejected: { label: 'Rejected', color: '#64748B', bgColor: '#F1F5F9' },
  withdrawn: { label: 'Withdrawn', color: '#94A3B8', bgColor: '#F8FAFC' },
};

const NDT_COLORS: Record<string, string> = {
  UT: '#3B82F6',
  RT: '#8B5CF6',
  MT: '#EF4444',
  PT: '#F59E0B',
  VT: '#22C55E',
  CWI: '#06B6D4',
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(amount);
};

const getAvailabilityColor = (status: string): string => {
  switch (status) {
    case 'online': return '#22C55E';
    case 'recently_active': return '#F59E0B';
    default: return '#94A3B8';
  }
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// Header Component
interface HeaderProps {
  onBack: () => void;
  title: string;
  applicationCount: number;
}

const Header: React.FC<HeaderProps> = ({ onBack, title, applicationCount }) => (
  <View style={styles.header}>
    <TouchableOpacity onPress={onBack} style={styles.headerButton} activeOpacity={0.7}>
      <ChevronLeft size={28} color="#0F172A" />
    </TouchableOpacity>
    
    <View style={styles.headerCenter}>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      <Text style={styles.headerSubtitle}>
        {applicationCount} application{applicationCount !== 1 ? 's' : ''}
      </Text>
    </View>
    
    <View style={styles.headerButton} />
  </View>
);

// Filter Tabs
interface FilterTabsProps {
  activeFilter: FilterOption;
  onFilterChange: (filter: FilterOption) => void;
  counts: Record<FilterOption, number>;
}

const FilterTabs: React.FC<FilterTabsProps> = ({ activeFilter, onFilterChange, counts }) => {
  const filters: { id: FilterOption; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'shortlisted', label: 'Shortlisted' },
    { id: 'offered', label: 'Offered' },
  ];

  return (
    <View style={styles.filterTabs}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterTabsContent}
      >
        {filters.map((filter) => {
          const isActive = activeFilter === filter.id;
          const count = counts[filter.id];
          return (
            <TouchableOpacity
              key={filter.id}
              style={[styles.filterTab, isActive && styles.filterTabActive]}
              onPress={() => onFilterChange(filter.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterTabText, isActive && styles.filterTabTextActive]}>
                {filter.label}
              </Text>
              {count > 0 && (
                <View style={[styles.filterTabBadge, isActive && styles.filterTabBadgeActive]}>
                  <Text style={[styles.filterTabBadgeText, isActive && styles.filterTabBadgeTextActive]}>
                    {count}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

// Application Card Component
interface ApplicationCardProps {
  application: Application;
  onViewProfile: (app: Application) => void;
  onShortlist: (app: Application) => void;
  onSendOffer: (app: Application) => void;
  onReject: (app: Application) => void;
  isProcessing: boolean;
}

const ApplicationCard: React.FC<ApplicationCardProps> = ({
  application,
  onViewProfile,
  onShortlist,
  onSendOffer,
  onReject,
  isProcessing,
}) => {
  const statusConfig = STATUS_CONFIG[application.application_status];
  const availabilityColor = getAvailabilityColor(application.inspector_availability_status);
  const isShortlisted = application.application_status === 'shortlisted';
  const isPending = application.application_status === 'pending';
  const isOffered = application.application_status === 'offered';
  const isAccepted = application.application_status === 'accepted';
  const isRejected = application.application_status === 'rejected';

  return (
    <TouchableOpacity
      style={styles.applicationCard}
      onPress={() => onViewProfile(application)}
      activeOpacity={0.9}
    >
      {/* Header Row */}
      <View style={styles.cardHeader}>
        {/* Avatar */}
        <View style={styles.avatarContainer}>
          {application.inspector_avatar ? (
            <Image source={{ uri: application.inspector_avatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <User size={28} color="#64748B" />
            </View>
          )}
          <View style={[styles.onlineIndicator, { backgroundColor: availabilityColor }]} />
          {application.inspector_is_verified && (
            <View style={styles.verifiedBadge}>
              <CheckCircle2 size={16} color="#3B82F6" fill="#FFFFFF" />
            </View>
          )}
        </View>

        {/* Info */}
        <View style={styles.cardInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.inspectorName} numberOfLines={1}>
              {application.inspector_full_name}
            </Text>
            {application.inspector_is_verified && (
              <Shield size={14} color="#3B82F6" />
            )}
          </View>

          {/* Rating */}
          <View style={styles.ratingRow}>
            <Star size={14} color="#FBBF24" fill="#FBBF24" />
            <Text style={styles.ratingValue}>
              {(application.inspector_rating || 0).toFixed(1)}
            </Text>
            <Text style={styles.ratingCount}>
              ({application.inspector_review_count || 0})
            </Text>
            {application.inspector_recommend_percent > 0 && (
              <>
                <View style={styles.dotDivider} />
                <ThumbsUp size={12} color="#22C55E" />
                <Text style={styles.recommendText}>
                  {application.inspector_recommend_percent.toFixed(0)}%
                </Text>
              </>
            )}
          </View>

          {/* Location */}
          <View style={styles.locationRow}>
            <MapPin size={12} color="#64748B" />
            <Text style={styles.locationText}>{application.inspector_location}</Text>
          </View>
        </View>

        {/* Status Badge */}
        <View style={[styles.statusBadge, { backgroundColor: statusConfig.bgColor }]}>
          <Text style={[styles.statusBadgeText, { color: statusConfig.color }]}>
            {statusConfig.label}
          </Text>
        </View>
      </View>

      {/* NDT Methods */}
      {application.inspector_ndt_methods && application.inspector_ndt_methods.length > 0 && (
        <View style={styles.ndtContainer}>
          {application.inspector_ndt_methods.slice(0, 5).map((method) => (
            <View
              key={method}
              style={[styles.ndtBadge, { backgroundColor: (NDT_COLORS[method] || '#64748B') + '20' }]}
            >
              <Text style={[styles.ndtBadgeText, { color: NDT_COLORS[method] || '#64748B' }]}>
                {method}
              </Text>
            </View>
          ))}
          {application.inspector_ndt_methods.length > 5 && (
            <View style={styles.ndtBadgeMore}>
              <Text style={styles.ndtBadgeMoreText}>
                +{application.inspector_ndt_methods.length - 5}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Skills/Specialties */}
      {application.inspector_skills && application.inspector_skills.length > 0 && (
        <Text style={styles.skillsText} numberOfLines={1}>
          {application.inspector_skills.slice(0, 3).join(' • ')}
        </Text>
      )}

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Briefcase size={14} color="#64748B" />
          <Text style={styles.statText}>{application.inspector_completed_jobs} jobs</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Award size={14} color="#64748B" />
          <Text style={styles.statText}>{application.inspector_years_experience} yrs exp</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Clock size={14} color="#64748B" />
          <Text style={styles.statText}>{application.inspector_response_time}h</Text>
        </View>
      </View>

      {/* Cover Letter Preview */}
      {application.cover_letter && (
        <View style={styles.coverLetterPreview}>
          <MessageSquare size={14} color="#64748B" />
          <Text style={styles.coverLetterText} numberOfLines={2}>
            "{application.cover_letter}"
          </Text>
        </View>
      )}

      {/* Applied Date & Proposed Price */}
      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Calendar size={12} color="#94A3B8" />
          <Text style={styles.metaText}>Applied {formatDate(application.applied_at)}</Text>
        </View>
        {application.proposed_price && (
          <View style={styles.metaItem}>
            <DollarSign size={12} color="#22C55E" />
            <Text style={styles.proposedPrice}>
              {formatCurrency(application.proposed_price)}
            </Text>
          </View>
        )}
      </View>

      {/* Action Buttons */}
      {!isAccepted && !isRejected && (
        <View style={styles.actionsRow}>
          {isPending && (
            <>
              <TouchableOpacity
                style={styles.shortlistButton}
                onPress={() => onShortlist(application)}
                disabled={isProcessing}
                activeOpacity={0.7}
              >
                <Bookmark size={18} color="#8B5CF6" />
                <Text style={styles.shortlistButtonText}>Shortlist</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.rejectButton}
                onPress={() => onReject(application)}
                disabled={isProcessing}
                activeOpacity={0.7}
              >
                <XCircle size={18} color="#EF4444" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.hireButton}
                onPress={() => onSendOffer(application)}
                disabled={isProcessing}
                activeOpacity={0.8}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Send size={18} color="#FFFFFF" />
                    <Text style={styles.hireButtonText}>Send Offer</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}

          {isShortlisted && (
            <>
              <View style={styles.shortlistedIndicator}>
                <BookmarkCheck size={18} color="#8B5CF6" />
                <Text style={styles.shortlistedText}>Shortlisted</Text>
              </View>

              <TouchableOpacity
                style={styles.rejectButton}
                onPress={() => onReject(application)}
                disabled={isProcessing}
                activeOpacity={0.7}
              >
                <XCircle size={18} color="#EF4444" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.hireButton}
                onPress={() => onSendOffer(application)}
                disabled={isProcessing}
                activeOpacity={0.8}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Send size={18} color="#FFFFFF" />
                    <Text style={styles.hireButtonText}>Send Offer</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}

          {isOffered && (
            <View style={styles.offerSentContainer}>
              <View style={styles.offerSentBadge}>
                <Send size={16} color="#3B82F6" />
                <Text style={styles.offerSentText}>Offer Sent - Awaiting Response</Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Accepted State */}
      {isAccepted && (
        <View style={styles.hiredBanner}>
          <CheckCircle2 size={20} color="#22C55E" />
          <Text style={styles.hiredBannerText}>Hired for this job</Text>
        </View>
      )}

      {/* View Profile Arrow */}
      <View style={styles.viewProfileArrow}>
        <ChevronRight size={20} color="#CBD5E1" />
      </View>
    </TouchableOpacity>
  );
};

// Inspector Detail Modal
interface InspectorDetailModalProps {
  visible: boolean;
  application: Application | null;
  onClose: () => void;
  onShortlist: () => void;
  onSendOffer: () => void;
  onReject: () => void;
  isProcessing: boolean;
}

const InspectorDetailModal: React.FC<InspectorDetailModalProps> = ({
  visible,
  application,
  onClose,
  onShortlist,
  onSendOffer,
  onReject,
  isProcessing,
}) => {
  if (!application) return null;

  const statusConfig = STATUS_CONFIG[application.application_status];
  const isPending = application.application_status === 'pending';
  const isShortlisted = application.application_status === 'shortlisted';
  const isOffered = application.application_status === 'offered';
  const canTakeAction = isPending || isShortlisted;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.modalContainer}>
        {/* Header */}
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
            <X size={24} color="#0F172A" />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Inspector Profile</Text>
          <View style={styles.modalCloseBtn} />
        </View>

        <ScrollView
          style={styles.modalContent}
          contentContainerStyle={styles.modalScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Profile Header */}
          <View style={styles.modalProfileHeader}>
            <View style={styles.modalAvatarContainer}>
              {application.inspector_avatar ? (
                <Image source={{ uri: application.inspector_avatar }} style={styles.modalAvatar} />
              ) : (
                <View style={[styles.modalAvatar, styles.avatarPlaceholder]}>
                  <User size={40} color="#64748B" />
                </View>
              )}
              {application.inspector_is_verified && (
                <View style={styles.modalVerifiedBadge}>
                  <CheckCircle2 size={24} color="#3B82F6" fill="#FFFFFF" />
                </View>
              )}
            </View>

            <Text style={styles.modalName}>{application.inspector_full_name}</Text>

            <View style={styles.modalRatingRow}>
              <Star size={18} color="#FBBF24" fill="#FBBF24" />
              <Text style={styles.modalRatingValue}>
                {(application.inspector_rating || 0).toFixed(1)}
              </Text>
              <Text style={styles.modalRatingCount}>
                ({application.inspector_review_count} reviews)
              </Text>
            </View>

            <View style={styles.modalLocationRow}>
              <MapPin size={14} color="#64748B" />
              <Text style={styles.modalLocationText}>{application.inspector_location}</Text>
            </View>

            {/* Status Badge */}
            <View style={[styles.modalStatusBadge, { backgroundColor: statusConfig.bgColor }]}>
              <Text style={[styles.modalStatusText, { color: statusConfig.color }]}>
                {statusConfig.label}
              </Text>
            </View>
          </View>

          {/* Stats Grid */}
          <View style={styles.modalStatsGrid}>
            <View style={styles.modalStatCard}>
              <Briefcase size={24} color="#3B82F6" />
              <Text style={styles.modalStatValue}>{application.inspector_completed_jobs}</Text>
              <Text style={styles.modalStatLabel}>Jobs Done</Text>
            </View>
            <View style={styles.modalStatCard}>
              <Award size={24} color="#8B5CF6" />
              <Text style={styles.modalStatValue}>{application.inspector_years_experience}</Text>
              <Text style={styles.modalStatLabel}>Years Exp</Text>
            </View>
            <View style={styles.modalStatCard}>
              <Clock size={24} color="#F59E0B" />
              <Text style={styles.modalStatValue}>{application.inspector_response_time}h</Text>
              <Text style={styles.modalStatLabel}>Response</Text>
            </View>
            <View style={styles.modalStatCard}>
              <ThumbsUp size={24} color="#22C55E" />
              <Text style={styles.modalStatValue}>
                {application.inspector_recommend_percent?.toFixed(0) || 0}%
              </Text>
              <Text style={styles.modalStatLabel}>Recommend</Text>
            </View>
          </View>

          {/* Bio */}
          {application.inspector_bio && (
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>About</Text>
              <Text style={styles.modalBioText}>{application.inspector_bio}</Text>
            </View>
          )}

          {/* NDT Methods */}
          {application.inspector_ndt_methods && application.inspector_ndt_methods.length > 0 && (
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>NDT Methods</Text>
              <View style={styles.modalBadgesGrid}>
                {application.inspector_ndt_methods.map((method) => (
                  <View
                    key={method}
                    style={[
                      styles.modalBadge,
                      { backgroundColor: (NDT_COLORS[method] || '#64748B') + '20' },
                    ]}
                  >
                    <Text
                      style={[styles.modalBadgeText, { color: NDT_COLORS[method] || '#64748B' }]}
                    >
                      {method}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Skills/Specialties */}
          {application.inspector_skills && application.inspector_skills.length > 0 && (
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>Specialties</Text>
              <View style={styles.modalBadgesGrid}>
                {application.inspector_skills.map((skill, index) => (
                  <View key={index} style={styles.modalSkillBadge}>
                    <Text style={styles.modalSkillText}>{skill}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Certifications */}
          {application.inspector_certifications && application.inspector_certifications.length > 0 && (
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>Certifications</Text>
              <View style={styles.modalBadgesGrid}>
                {application.inspector_certifications.map((cert, index) => (
                  <View key={index} style={styles.modalCertBadge}>
                    <Award size={14} color="#8B5CF6" />
                    <Text style={styles.modalCertText}>{cert}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Cover Letter */}
          {application.cover_letter && (
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>Cover Letter</Text>
              <View style={styles.modalCoverLetter}>
                <Text style={styles.modalCoverLetterText}>{application.cover_letter}</Text>
              </View>
            </View>
          )}

          {/* Application Details */}
          <View style={styles.modalSection}>
            <Text style={styles.modalSectionTitle}>Application Details</Text>
            <View style={styles.modalDetailsCard}>
              <View style={styles.modalDetailRow}>
                <Text style={styles.modalDetailLabel}>Applied</Text>
                <Text style={styles.modalDetailValue}>{formatDate(application.applied_at)}</Text>
              </View>
              {application.proposed_price && (
                <View style={styles.modalDetailRow}>
                  <Text style={styles.modalDetailLabel}>Proposed Price</Text>
                  <Text style={[styles.modalDetailValue, { color: '#22C55E', fontWeight: '700' }]}>
                    {formatCurrency(application.proposed_price)}
                  </Text>
                </View>
              )}
              {application.availability_date && (
                <View style={styles.modalDetailRow}>
                  <Text style={styles.modalDetailLabel}>Available From</Text>
                  <Text style={styles.modalDetailValue}>
                    {new Date(application.availability_date).toLocaleDateString()}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Spacer for footer */}
          <View style={{ height: 120 }} />
        </ScrollView>

        {/* Action Footer */}
        {canTakeAction && (
          <View style={styles.modalFooter}>
            <View style={styles.modalFooterButtons}>
              {isPending && (
                <TouchableOpacity
                  style={styles.modalShortlistBtn}
                  onPress={onShortlist}
                  disabled={isProcessing}
                  activeOpacity={0.7}
                >
                  <Bookmark size={20} color="#8B5CF6" />
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.modalRejectBtn}
                onPress={onReject}
                disabled={isProcessing}
                activeOpacity={0.7}
              >
                <XCircle size={20} color="#EF4444" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalHireBtn, isProcessing && styles.modalHireBtnDisabled]}
                onPress={onSendOffer}
                disabled={isProcessing}
                activeOpacity={0.8}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Send size={20} color="#FFFFFF" />
                    <Text style={styles.modalHireBtnText}>Send Offer</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {isOffered && (
          <View style={styles.modalFooter}>
            <View style={styles.offerSentFooter}>
              <Send size={20} color="#3B82F6" />
              <Text style={styles.offerSentFooterText}>Offer Sent - Awaiting Response</Text>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
};

// Empty State Component
interface EmptyStateProps {
  filter: FilterOption;
}

const EmptyState: React.FC<EmptyStateProps> = ({ filter }) => {
  const messages: Record<FilterOption, { title: string; subtitle: string }> = {
    all: {
      title: 'No Applications Yet',
      subtitle: 'Inspectors will appear here once they apply for your job',
    },
    pending: {
      title: 'No Pending Applications',
      subtitle: 'All applications have been reviewed',
    },
    shortlisted: {
      title: 'No Shortlisted Inspectors',
      subtitle: 'Shortlist candidates to review them later',
    },
    offered: {
      title: 'No Offers Sent',
      subtitle: 'Send offers to inspectors you want to hire',
    },
  };

  const { title, subtitle } = messages[filter];

  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyStateIcon}>
        <Users size={48} color="#CBD5E1" />
      </View>
      <Text style={styles.emptyStateTitle}>{title}</Text>
      <Text style={styles.emptyStateSubtitle}>{subtitle}</Text>
    </View>
  );
};

// Loading State
const LoadingState: React.FC = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#3B82F6" />
    <Text style={styles.loadingText}>Loading applications...</Text>
  </View>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ApplicationsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // ✅ FIX: Convert id to string (handle array case from useLocalSearchParams)
  const jobId = id ? (Array.isArray(id) ? id[0] : id) : null;
  const router = useRouter();

  // State
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterOption>('all');
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState('Applications');

  // ========================================
  // DATA FETCHING
  // ========================================

  const fetchApplications = useCallback(async () => {
    try {
      // Try RPC function first, fallback to direct query
      let query = supabase
        .from('applications')
        .select(`
          id,
          job_id,
          applicant_id,
          status,
          cover_letter,
          proposed_price,
          availability_date,
          created_at,
          jobs (
            id,
            title,
            price,
            status,
            escrow_status
          ),
          applicant:profiles (
            id,
            first_name,
            last_name,
            avatar_url,
            bio,
            is_verified,
            hourly_rate,
            years_experience,
            skills,
            ndt_methods,
            certifications,
            location_city,
            location_province,
            completed_jobs_count,
            response_time_hours,
            rating_average,
            rating_count,
            is_available,
            availability_status,
            recommend_percent
          )
        `)
        .eq('job_id', jobId);

      const { data, error } = await query;

      if (error) throw error;

      const formattedData = (data || []).map((app: any) => {
        const job = app.jobs as any;
        const applicant = app.applicant as any;
        
        return {
          application_id: app.id,
          job_id: app.job_id,
          applicant_id: app.applicant_id,
          application_status: app.status,
          cover_letter: app.cover_letter,
          proposed_price: app.proposed_price,
          availability_date: app.availability_date,
          applied_at: app.created_at,
          job_title: job?.title || 'Job',
          job_price: job?.price || 0,
          job_status: job?.status || 'unknown',
          escrow_status: job?.escrow_status || 'unknown',
          inspector_full_name: `${applicant?.first_name || ''} ${applicant?.last_name || ''}`.trim() || 'Inspector',
          inspector_avatar: applicant?.avatar_url,
          inspector_bio: applicant?.bio,
          inspector_is_verified: applicant?.is_verified || false,
          inspector_hourly_rate: applicant?.hourly_rate,
          inspector_years_experience: applicant?.years_experience || 0,
          inspector_skills: applicant?.skills || [],
          inspector_ndt_methods: applicant?.ndt_methods || [],
          inspector_certifications: applicant?.certifications || [],
          inspector_location: applicant?.location_city
            ? `${applicant.location_city}${applicant.location_province ? `, ${applicant.location_province}` : ''}`
            : 'Location not set',
          inspector_completed_jobs: applicant?.completed_jobs_count || 0,
          inspector_response_time: applicant?.response_time_hours || 24,
          inspector_rating: applicant?.rating_average || 0,
          inspector_review_count: applicant?.rating_count || 0,
          inspector_is_available: applicant?.is_available || false,
          inspector_availability_status: applicant?.availability_status || 'offline',
          inspector_recommend_percent: applicant?.recommend_percent || 0,
        };
      }) as Application[];

      setApplications(formattedData);
      
      if (formattedData.length > 0) {
        setJobTitle(formattedData[0].job_title);
      }
    } catch (err: any) {
      console.error('Fetch applications error:', err);
      showAlert('Error', err.message || 'Failed to load applications');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchApplications();
  };

  // ========================================
  // FILTER COUNTS
  // ========================================

  const filterCounts: Record<FilterOption, number> = {
    all: applications.length,
    pending: applications.filter((a) => a.application_status === 'pending').length,
    shortlisted: applications.filter((a) => a.application_status === 'shortlisted').length,
    offered: applications.filter((a) => a.application_status === 'offered').length,
  };

  const filteredApplications = applications.filter((app) => {
    if (activeFilter === 'all') return true;
    return app.application_status === activeFilter;
  });

  // ========================================
  // ACTION HANDLERS
  // ========================================

  const handleShortlist = async (application: Application) => {
    setProcessingId(application.application_id);

    try {
      const { error } = await supabase
        .from('applications')
        .update({ status: 'shortlisted' })
        .eq('id', application.application_id);

      if (error) throw error;

      // Update local state
      setApplications((prev) =>
        prev.map((app) =>
          app.application_id === application.application_id
            ? { ...app, application_status: 'shortlisted' }
            : app
        )
      );

      showAlert('Success', `${application.inspector_full_name} has been shortlisted`);
    } catch (err: any) {
      console.error('Shortlist error:', err);
      showAlert('Error', err.message || 'Failed to shortlist application');
    } finally {
      setProcessingId(null);
    }
  };

  const handleSendOffer = async (application: Application) => {
    showConfirm(
      'Send Offer',
      `Send an offer to ${application.inspector_full_name}?\n\nThis will lock the job price (${formatCurrency(application.job_price)}) in escrow when they accept.`,
      async () => {
        setProcessingId(application.application_id);

        try {
          const { error } = await supabase
            .from('applications')
            .update({ status: 'offered' })
            .eq('id', application.application_id);

          if (error) throw error;

          // Update local state
          setApplications((prev) =>
            prev.map((app) =>
              app.application_id === application.application_id
                ? { ...app, application_status: 'offered' }
                : app
            )
          );

          setShowDetailModal(false);

          showAlert(
            'Offer Sent! 🎉',
            `Your offer has been sent to ${application.inspector_full_name}. You'll be notified when they respond.`
          );
        } catch (err: any) {
          console.error('Send offer error:', err);
          showAlert('Error', err.message || 'Failed to send offer');
        } finally {
          setProcessingId(null);
        }
      }
    );
  };

  const handleReject = async (application: Application) => {
    showConfirm(
      'Reject Application',
      `Are you sure you want to reject ${application.inspector_full_name}'s application?`,
      async () => {
        setProcessingId(application.application_id);

        try {
          const { error } = await supabase
            .from('applications')
            .update({ status: 'rejected' })
            .eq('id', application.application_id);

          if (error) throw error;

          // Update local state
          setApplications((prev) =>
            prev.map((app) =>
              app.application_id === application.application_id
                ? { ...app, application_status: 'rejected' }
                : app
            )
          );

          setShowDetailModal(false);
        } catch (err: any) {
          console.error('Reject error:', err);
          showAlert('Error', err.message || 'Failed to reject application');
        } finally {
          setProcessingId(null);
        }
      }
    );
  };

  const handleViewProfile = (application: Application) => {
    setSelectedApplication(application);
    setShowDetailModal(true);
  };

  // ========================================
  // RENDER
  // ========================================

  const renderApplication = ({ item }: { item: Application }) => (
    <ApplicationCard
      application={item}
      onViewProfile={handleViewProfile}
      onShortlist={handleShortlist}
      onSendOffer={handleSendOffer}
      onReject={handleReject}
      isProcessing={processingId === item.application_id}
    />
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header onBack={() => router.back()} title="Applications" applicationCount={0} />
        <LoadingState />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header
        onBack={() => router.back()}
        title={jobTitle}
        applicationCount={applications.length}
      />

      <FilterTabs
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        counts={filterCounts}
      />

      {filteredApplications.length === 0 ? (
        <EmptyState filter={activeFilter} />
      ) : (
        <FlatList
          data={filteredApplications}
          keyExtractor={(item) => item.application_id}
          renderItem={renderApplication}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#3B82F6"
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        />
      )}

      <InspectorDetailModal
        visible={showDetailModal}
        application={selectedApplication}
        onClose={() => setShowDetailModal(false)}
        onShortlist={() => selectedApplication && handleShortlist(selectedApplication)}
        onSendOffer={() => selectedApplication && handleSendOffer(selectedApplication)}
        onReject={() => selectedApplication && handleReject(selectedApplication)}
        isProcessing={processingId === selectedApplication?.application_id}
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
  headerButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },

  // Filter Tabs
  filterTabs: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  filterTabsContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    marginRight: 8,
    gap: 8,
  },
  filterTabActive: {
    backgroundColor: '#3B82F6',
  },
  filterTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  filterTabTextActive: {
    color: '#FFFFFF',
  },
  filterTabBadge: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 24,
    alignItems: 'center',
  },
  filterTabBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  filterTabBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  filterTabBadgeTextActive: {
    color: '#FFFFFF',
  },

  // List
  listContent: {
    padding: 16,
  },

  // Application Card
  applicationCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
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
    width: 14,
    height: 14,
    borderRadius: 7,
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
    gap: 6,
    marginBottom: 4,
  },
  inspectorName: {
    fontSize: 17,
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
  dotDivider: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#CBD5E1',
    marginHorizontal: 6,
  },
  recommendText: {
    fontSize: 12,
    color: '#22C55E',
    fontWeight: '600',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {
    fontSize: 13,
    color: '#64748B',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },

  // NDT Methods
  ndtContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 14,
  },
  ndtBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  ndtBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  ndtBadgeMore: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  ndtBadgeMoreText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },

  // Skills
  skillsText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 10,
  },

  // Stats Row
  statsRow: {
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

  // Cover Letter
  coverLetterPreview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
    gap: 10,
  },
  coverLetterText: {
    flex: 1,
    fontSize: 13,
    color: '#475569',
    fontStyle: 'italic',
    lineHeight: 18,
  },

  // Meta Row
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  proposedPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: '#22C55E',
  },

  // Actions Row
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 10,
  },
  shortlistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#EDE9FE',
    gap: 6,
  },
  shortlistButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8B5CF6',
  },
  shortlistedIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#EDE9FE',
    gap: 6,
  },
  shortlistedText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8B5CF6',
  },
  rejectButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hireButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#22C55E',
    gap: 8,
  },
  hireButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  offerSentContainer: {
    flex: 1,
  },
  offerSentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DBEAFE',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  offerSentText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3B82F6',
  },
  hiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCFCE7',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
    gap: 8,
  },
  hiredBannerText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#16A34A',
  },
  viewProfileArrow: {
    position: 'absolute',
    right: 16,
    top: 30,
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
  modalCloseBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#0F172A',
  },
  modalContent: {
    flex: 1,
  },
  modalScrollContent: {
    padding: 20,
  },

  // Modal Profile Header
  modalProfileHeader: {
    alignItems: 'center',
    marginBottom: 28,
  },
  modalAvatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  modalAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: '#F1F5F9',
  },
  modalVerifiedBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 2,
  },
  modalName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
  },
  modalRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  modalRatingValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  modalRatingCount: {
    fontSize: 15,
    color: '#64748B',
  },
  modalLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  modalLocationText: {
    fontSize: 15,
    color: '#64748B',
  },
  modalStatusBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  modalStatusText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Modal Stats Grid
  modalStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 28,
  },
  modalStatCard: {
    width: (SCREEN_WIDTH - 64) / 2,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  modalStatValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 8,
  },
  modalStatLabel: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
  },

  // Modal Sections
  modalSection: {
    marginBottom: 24,
  },
  modalSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 12,
  },
  modalBioText: {
    fontSize: 15,
    color: '#475569',
    lineHeight: 24,
  },
  modalBadgesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modalBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  modalBadgeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalSkillBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  modalSkillText: {
    fontSize: 14,
    color: '#475569',
    fontWeight: '500',
  },
  modalCertBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 6,
  },
  modalCertText: {
    fontSize: 14,
    color: '#8B5CF6',
    fontWeight: '500',
  },
  modalCoverLetter: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#3B82F6',
  },
  modalCoverLetterText: {
    fontSize: 15,
    color: '#475569',
    lineHeight: 24,
    fontStyle: 'italic',
  },
  modalDetailsCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  modalDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalDetailLabel: {
    fontSize: 14,
    color: '#64748B',
  },
  modalDetailValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
  },

  // Modal Footer
  modalFooter: {
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 8 : 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  modalFooterButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalShortlistBtn: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#EDE9FE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalRejectBtn: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalHireBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22C55E',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  modalHireBtnDisabled: {
    backgroundColor: '#86EFAC',
  },
  modalHireBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  offerSentFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DBEAFE',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  offerSentFooterText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#3B82F6',
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
  emptyStateSubtitle: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
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

