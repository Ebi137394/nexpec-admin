// app/client/jobs/[id]/applicants.tsx

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Platform,
  Animated,
  Dimensions,
  Image,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Search,
  Filter,
  User,
  Star,
  Award,
  Clock,
  DollarSign,
  Briefcase,
  Calendar,
  CheckCircle,
  XCircle,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Send,
  X,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  UserCheck,
  Eye,
  MoreVertical,
  MapPin,
  Shield,
  Zap,
  FileText,
  Phone,
  Mail,
  TrendingUp,
  TrendingDown,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import {
  ApplicationStatus,
  APPLICATION_STATUS_CONFIG,
  canTransitionTo,
  isTerminalStatus,
} from '@/types/application';

// ============================================
// Constants
// ============================================
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const COLORS = {
  background: '#020617',
  card: '#1E293B',
  cardHover: '#273549',
  cardSecondary: '#0F172A',
  text: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  primary: '#3B82F6',
  primaryDark: '#2563EB',
  primaryLight: '#60A5FA',
  border: '#334155',
  borderLight: '#475569',
  error: '#EF4444',
  success: '#22C55E',
  warning: '#F59E0B',
  yellow: '#EAB308',
  purple: '#A855F7',
  cyan: '#06B6D4',
  inputBackground: '#0F172A',
} as const;

// ============================================
// Types
// ============================================
interface ApplicantProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  avatar_url: string | null;
  title: string | null;
  bio: string | null;
  years_experience: number | null;
  hourly_rate: number | null;
  daily_rate: number | null;
  specialties: string[] | null;
}

interface ApplicationWithProfile {
  id: string;
  job_id: string;
  applicant_id: string;
  status: ApplicationStatus;
  cover_note: string | null;
  bid_amount: number | null;
  bid_type: string | null;
  currency: string;
  estimated_duration: string | null;
  available_start_date: string | null;
  created_at: string;
  updated_at: string;
  last_viewed_by_client: string | null;
  applicant: ApplicantProfile;
}

interface JobDetails {
  id: string;
  title: string;
  status: string;
  budget_min: number | null;
  budget_max: number | null;
  budget_type: string;
  currency: string;
  applications_count: number;
}

interface ApplicantCertification {
  id: string;
  name: string;
  status: string;
  issuing_organization: string;
}

// ============================================
// Helper Functions
// ============================================
const getApplicantName = (applicant: ApplicantProfile): string => {
  const firstName = applicant.first_name || '';
  const lastName = applicant.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || 'Anonymous Inspector';
};

const getApplicantInitials = (applicant: ApplicantProfile): string => {
  const firstName = applicant.first_name || '';
  const lastName = applicant.last_name || '';
  
  if (firstName && lastName) {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  }
  if (firstName) {
    return firstName.charAt(0).toUpperCase();
  }
  return '?';
};

const formatTimeAgo = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ============================================
// Helper Components
// ============================================

// Status Badge Component
interface StatusBadgeProps {
  status: ApplicationStatus;
  size?: 'small' | 'medium';
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'small' }) => {
  const config = APPLICATION_STATUS_CONFIG[status];
  
  return (
    <View style={[
      styles.statusBadge,
      { backgroundColor: config.bgColor },
      size === 'medium' && styles.statusBadgeMedium,
    ]}>
      <View style={[styles.statusDot, { backgroundColor: config.color }]} />
      <Text style={[
        styles.statusBadgeText,
        { color: config.color },
        size === 'medium' && styles.statusBadgeTextMedium,
      ]}>
        {config.label}
      </Text>
    </View>
  );
};

// Bid Comparison Component
interface BidComparisonProps {
  bidAmount: number | null;
  bidType: string | null;
  jobBudgetMin: number | null;
  jobBudgetMax: number | null;
  jobBudgetType: string;
  currency: string;
}

const BidComparison: React.FC<BidComparisonProps> = ({
  bidAmount,
  bidType,
  jobBudgetMin,
  jobBudgetMax,
  jobBudgetType,
  currency,
}) => {
  if (bidAmount === null) {
    return <Text style={styles.bidNegotiable}>Open to negotiation</Text>;
  }

  const jobMidpoint = jobBudgetMin && jobBudgetMax 
    ? (jobBudgetMin + jobBudgetMax) / 2 
    : jobBudgetMin || jobBudgetMax || 0;
  
  const difference = jobMidpoint > 0 ? ((bidAmount - jobMidpoint) / jobMidpoint) * 100 : 0;
  const isHigher = difference > 5;
  const isLower = difference < -5;

  const getSymbol = () => {
    switch (currency) {
      case 'CAD': return 'CA$';
      case 'EUR': return '€';
      case 'GBP': return '£';
      default: return '$';
    }
  };

  const getTypeLabel = () => {
    switch (bidType || jobBudgetType) {
      case 'hourly': return '/hr';
      case 'daily': return '/day';
      case 'fixed': return ' fixed';
      default: return '';
    }
  };

  return (
    <View style={styles.bidComparison}>
      <View style={styles.bidAmount}>
        <Text style={[
          styles.bidAmountText,
          isHigher && styles.bidAmountHigher,
          isLower && styles.bidAmountLower,
        ]}>
          {getSymbol()}{bidAmount.toLocaleString()}{getTypeLabel()}
        </Text>
        {(isHigher || isLower) && (
          <View style={[
            styles.bidDifference,
            isHigher ? styles.bidDifferenceHigher : styles.bidDifferenceLower,
          ]}>
            {isHigher ? (
              <TrendingUp size={10} color={COLORS.error} />
            ) : (
              <TrendingDown size={10} color={COLORS.success} />
            )}
            <Text style={[
              styles.bidDifferenceText,
              isHigher ? styles.bidDifferenceTextHigher : styles.bidDifferenceTextLower,
            ]}>
              {Math.abs(Math.round(difference))}%
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

// Stats Row Component
interface StatsRowProps {
  total: number;
  pending: number;
  shortlisted: number;
  offered: number;
}

const StatsRow: React.FC<StatsRowProps> = ({ total, pending, shortlisted, offered }) => (
  <View style={styles.statsRow}>
    <View style={styles.statItem}>
      <Text style={styles.statValue}>{total}</Text>
      <Text style={styles.statLabel}>Total</Text>
    </View>
    <View style={styles.statDivider} />
    <View style={styles.statItem}>
      <Text style={[styles.statValue, { color: COLORS.warning }]}>{pending}</Text>
      <Text style={styles.statLabel}>Pending</Text>
    </View>
    <View style={styles.statDivider} />
    <View style={styles.statItem}>
      <Text style={[styles.statValue, { color: COLORS.purple }]}>{shortlisted}</Text>
      <Text style={styles.statLabel}>Shortlisted</Text>
    </View>
    <View style={styles.statDivider} />
    <View style={styles.statItem}>
      <Text style={[styles.statValue, { color: COLORS.primary }]}>{offered}</Text>
      <Text style={styles.statLabel}>Offered</Text>
    </View>
  </View>
);

// Filter Chip Component
interface FilterChipProps {
  label: string;
  count?: number;
  isActive: boolean;
  onPress: () => void;
  color?: string;
}

const FilterChip: React.FC<FilterChipProps> = ({ label, count, isActive, onPress, color }) => (
  <TouchableOpacity
    style={[
      styles.filterChip,
      isActive && styles.filterChipActive,
      isActive && color && { backgroundColor: color + '20', borderColor: color },
    ]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <Text style={[
      styles.filterChipText,
      isActive && styles.filterChipTextActive,
      isActive && color && { color },
    ]}>
      {label}
    </Text>
    {count !== undefined && count > 0 && (
      <View style={[
        styles.filterChipCount,
        isActive && { backgroundColor: color || COLORS.primary },
      ]}>
        <Text style={styles.filterChipCountText}>{count}</Text>
      </View>
    )}
  </TouchableOpacity>
);

// Applicant Card Component - UPDATED with action buttons
interface ApplicantCardProps {
  application: ApplicationWithProfile;
  job: JobDetails;
  onPress: () => void;
  onStatusChange: (applicationId: string, newStatus: ApplicationStatus) => Promise<void>;
  updating: boolean;
  isNew: boolean;
}

const ApplicantCard: React.FC<ApplicantCardProps> = ({ 
  application, 
  job, 
  onPress, 
  onStatusChange,
  updating,
  isNew,
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const { applicant, status } = application;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  const handleShortlist = () => {
    Alert.alert(
      'Shortlist Applicant',
      `Add ${getApplicantName(applicant)} to your shortlist?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Shortlist', 
          onPress: () => onStatusChange(application.id, 'shortlisted'),
        },
      ]
    );
  };

  const handleOffer = () => {
    Alert.alert(
      'Send Job Offer',
      `Send a job offer to ${getApplicantName(applicant)}? They will be notified immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Send Offer', 
          style: 'default',
          onPress: () => onStatusChange(application.id, 'offered'),
        },
      ]
    );
  };

  const handleReject = () => {
    Alert.alert(
      'Reject Application',
      `Are you sure you want to reject ${getApplicantName(applicant)}'s application? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Reject', 
          style: 'destructive',
          onPress: () => onStatusChange(application.id, 'rejected'),
        },
      ]
    );
  };

  // Render action buttons based on status
  const renderActionButtons = () => {
    if (updating) {
      return (
        <View style={styles.actionLoading}>
          <ActivityIndicator size="small" color={COLORS.primary} />
        </View>
      );
    }

    switch (status) {
      case 'pending':
        return (
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={styles.shortlistButton}
              onPress={handleShortlist}
              activeOpacity={0.7}
            >
              <Star size={16} color={COLORS.yellow} />
              <Text style={styles.shortlistButtonText}>Shortlist</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.rejectButton}
              onPress={handleReject}
              activeOpacity={0.7}
            >
              <XCircle size={16} color={COLORS.error} />
              <Text style={styles.rejectButtonText}>Reject</Text>
            </TouchableOpacity>
          </View>
        );

      case 'shortlisted':
        return (
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={styles.offerButton}
              onPress={handleOffer}
              activeOpacity={0.7}
            >
              <Send size={16} color={COLORS.text} />
              <Text style={styles.offerButtonText}>Offer Job</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.rejectButton}
              onPress={handleReject}
              activeOpacity={0.7}
            >
              <XCircle size={16} color={COLORS.error} />
              <Text style={styles.rejectButtonText}>Reject</Text>
            </TouchableOpacity>
          </View>
        );

      case 'offered':
        return (
          <View style={styles.offerSentContainer}>
            <View style={styles.offerSentBadge}>
              <Clock size={14} color={COLORS.primary} />
              <Text style={styles.offerSentText}>Offer Sent - Waiting for Inspector</Text>
            </View>
          </View>
        );

      case 'hired':
        return (
          <View style={styles.acceptedContainer}>
            <View style={styles.acceptedBadge}>
              <CheckCircle size={14} color={COLORS.success} />
              <Text style={styles.acceptedText}>Hired!</Text>
            </View>
          </View>
        );

      case 'rejected':
        return (
          <View style={styles.rejectedContainer}>
            <View style={styles.rejectedBadge}>
              <XCircle size={14} color={COLORS.error} />
              <Text style={styles.rejectedText}>Rejected</Text>
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Pressable
        style={({ pressed }) => [
          styles.applicantCard,
          isNew && styles.applicantCardNew,
          pressed && styles.applicantCardPressed,
        ]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        {/* New indicator */}
        {isNew && (
          <View style={styles.newIndicator}>
            <View style={styles.newDot} />
          </View>
        )}

        {/* Header Row */}
        <View style={styles.applicantHeader}>
          {/* Avatar */}
          {applicant.avatar_url ? (
            <Image source={{ uri: applicant.avatar_url }} style={styles.applicantAvatar} />
          ) : (
            <View style={styles.applicantAvatarPlaceholder}>
              <Text style={styles.applicantAvatarText}>
                {getApplicantInitials(applicant)}
              </Text>
            </View>
          )}

          {/* Info */}
          <View style={styles.applicantInfo}>
            <View style={styles.applicantNameRow}>
              <Text style={styles.applicantName} numberOfLines={1}>
                {getApplicantName(applicant)}
              </Text>
              <Shield size={14} color={COLORS.success} />
            </View>
            <Text style={styles.applicantTitle} numberOfLines={1}>
              {applicant.title || 'Inspector'}
            </Text>
            {applicant.years_experience && (
              <View style={styles.experienceRow}>
                <Briefcase size={12} color={COLORS.textMuted} />
                <Text style={styles.experienceText}>
                  {applicant.years_experience} years exp
                </Text>
              </View>
            )}
          </View>

          {/* Status Badge */}
          <StatusBadge status={status} />
        </View>

        {/* Cover Note Preview */}
        {application.cover_note && (
          <View style={styles.coverNotePreview}>
            <Text style={styles.coverNoteText} numberOfLines={2}>
              "{application.cover_note}"
            </Text>
          </View>
        )}

        {/* Meta Row */}
        <View style={styles.applicantMeta}>
          {/* Bid Info */}
          <BidComparison
            bidAmount={application.bid_amount}
            bidType={application.bid_type}
            jobBudgetMin={job.budget_min}
            jobBudgetMax={job.budget_max}
            jobBudgetType={job.budget_type}
            currency={job.currency}
          />

          {/* Applied Time */}
          <View style={styles.appliedTime}>
            <Clock size={12} color={COLORS.textMuted} />
            <Text style={styles.appliedTimeText}>
              {formatTimeAgo(application.created_at)}
            </Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionSection}>
          {renderActionButtons()}
        </View>

        {/* View Details Indicator */}
        <TouchableOpacity style={styles.viewDetailsButton} onPress={onPress}>
          <Text style={styles.viewDetailsText}>View Full Profile</Text>
          <ChevronRight size={16} color={COLORS.primary} />
        </TouchableOpacity>
      </Pressable>
    </Animated.View>
  );
};

// Empty State Component
interface EmptyStateProps {
  filter: string;
  onClearFilter: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ filter, onClearFilter }) => (
  <View style={styles.emptyState}>
    <View style={styles.emptyIconContainer}>
      <User size={48} color={COLORS.textMuted} />
    </View>
    <Text style={styles.emptyTitle}>
      {filter === 'all' ? 'No Applications Yet' : `No ${filter} Applications`}
    </Text>
    <Text style={styles.emptyDescription}>
      {filter === 'all'
        ? 'Applications will appear here when inspectors apply to your job.'
        : 'No applications match this filter. Try a different filter.'}
    </Text>
    {filter !== 'all' && (
      <TouchableOpacity style={styles.clearFilterButton} onPress={onClearFilter}>
        <X size={16} color={COLORS.primary} />
        <Text style={styles.clearFilterText}>Clear Filter</Text>
      </TouchableOpacity>
    )}
  </View>
);

// ============================================
// Review Modal Component
// ============================================
interface ReviewModalProps {
  visible: boolean;
  application: ApplicationWithProfile | null;
  job: JobDetails | null;
  certifications: ApplicantCertification[];
  onClose: () => void;
  onStatusChange: (applicationId: string, newStatus: ApplicationStatus) => Promise<void>;
  updating: boolean;
}

const ReviewModal: React.FC<ReviewModalProps> = ({
  visible,
  application,
  job,
  certifications,
  onClose,
  onStatusChange,
  updating,
}) => {
  if (!application || !job) return null;

  const { applicant, status } = application;

  const handleShortlist = () => onStatusChange(application.id, 'shortlisted');
  const handleOffer = () => onStatusChange(application.id, 'offered');
  const handleReject = () => {
    Alert.alert(
      'Reject Application',
      'Are you sure? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reject', style: 'destructive', onPress: () => onStatusChange(application.id, 'rejected') },
      ]
    );
  };

  const renderModalActions = () => {
    if (updating) {
      return (
        <View style={styles.modalActionLoading}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.modalActionLoadingText}>Updating...</Text>
        </View>
      );
    }

    if (isTerminalStatus(status)) {
      return (
        <View style={styles.terminalStatusBanner}>
          {status === 'hired' ? (
            <>
              <CheckCircle size={20} color={COLORS.success} />
              <Text style={styles.terminalStatusText}>This inspector has been hired!</Text>
            </>
          ) : status === 'rejected' ? (
            <>
              <XCircle size={20} color={COLORS.error} />
              <Text style={styles.terminalStatusText}>This application was rejected</Text>
            </>
          ) : (
            <>
              <AlertCircle size={20} color={COLORS.textMuted} />
              <Text style={styles.terminalStatusText}>Application withdrawn by inspector</Text>
            </>
          )}
        </View>
      );
    }

    return (
      <View style={styles.modalActions}>
        {/* Reject Button */}
        {canTransitionTo(status, 'rejected') && (
          <TouchableOpacity
            style={styles.modalRejectButton}
            onPress={handleReject}
          >
            <ThumbsDown size={18} color={COLORS.error} />
          </TouchableOpacity>
        )}

        {/* Shortlist Button */}
        {canTransitionTo(status, 'shortlisted') && (
          <TouchableOpacity
            style={styles.modalShortlistButton}
            onPress={handleShortlist}
          >
            <Star size={18} color={COLORS.yellow} />
            <Text style={styles.modalShortlistButtonText}>Shortlist</Text>
          </TouchableOpacity>
        )}

        {/* Offer Button */}
        {canTransitionTo(status, 'offered') && (
          <TouchableOpacity
            style={styles.modalOfferButton}
            onPress={handleOffer}
          >
            <Send size={18} color={COLORS.text} />
            <Text style={styles.modalOfferButtonText}>Send Offer</Text>
          </TouchableOpacity>
        )}

        {/* Waiting for response */}
        {status === 'offered' && (
          <View style={styles.waitingBanner}>
            <Clock size={18} color={COLORS.primary} />
            <Text style={styles.waitingText}>Waiting for inspector's response...</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalContainer} edges={['top']}>
        {/* Modal Header */}
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} disabled={updating}>
            <X size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Review Application</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Applicant Header */}
          <View style={styles.reviewHeader}>
            {applicant.avatar_url ? (
              <Image source={{ uri: applicant.avatar_url }} style={styles.reviewAvatar} />
            ) : (
              <View style={styles.reviewAvatarPlaceholder}>
                <Text style={styles.reviewAvatarText}>
                  {getApplicantInitials(applicant)}
                </Text>
              </View>
            )}
            <View style={styles.reviewInfo}>
              <Text style={styles.reviewName}>{getApplicantName(applicant)}</Text>
              <Text style={styles.reviewTitle}>{applicant.title || 'Inspector'}</Text>
              <StatusBadge status={status} size="medium" />
            </View>
          </View>

          {/* Quick Stats */}
          <View style={styles.reviewStats}>
            <View style={styles.reviewStatItem}>
              <Briefcase size={18} color={COLORS.primary} />
              <Text style={styles.reviewStatValue}>
                {applicant.years_experience || 0} years
              </Text>
              <Text style={styles.reviewStatLabel}>Experience</Text>
            </View>
            <View style={styles.reviewStatDivider} />
            <View style={styles.reviewStatItem}>
              <DollarSign size={18} color={COLORS.success} />
              <Text style={styles.reviewStatValue}>
                {application.bid_amount 
                  ? `$${application.bid_amount.toLocaleString()}`
                  : 'Negotiable'}
              </Text>
              <Text style={styles.reviewStatLabel}>Bid</Text>
            </View>
            <View style={styles.reviewStatDivider} />
            <View style={styles.reviewStatItem}>
              <Award size={18} color={COLORS.warning} />
              <Text style={styles.reviewStatValue}>{certifications.length}</Text>
              <Text style={styles.reviewStatLabel}>Certs</Text>
            </View>
          </View>

          {/* Cover Note */}
          <View style={styles.reviewSection}>
            <Text style={styles.reviewSectionTitle}>Cover Note</Text>
            <View style={styles.coverNoteCard}>
              <Text style={styles.coverNoteFullText}>
                {application.cover_note || 'No cover note provided.'}
              </Text>
            </View>
          </View>

          {/* Bio */}
          {applicant.bio && (
            <View style={styles.reviewSection}>
              <Text style={styles.reviewSectionTitle}>About</Text>
              <View style={styles.bioCard}>
                <Text style={styles.bioText}>{applicant.bio}</Text>
              </View>
            </View>
          )}

          {/* Certifications */}
          {certifications.length > 0 && (
            <View style={styles.reviewSection}>
              <Text style={styles.reviewSectionTitle}>
                Verified Certifications ({certifications.length})
              </Text>
              <View style={styles.certificationsCard}>
                {certifications.map((cert) => (
                  <View key={cert.id} style={styles.certificationItem}>
                    <Award size={16} color={COLORS.warning} />
                    <View style={styles.certificationInfo}>
                      <Text style={styles.certificationName}>{cert.name}</Text>
                      <Text style={styles.certificationOrg}>
                        {cert.issuing_organization}
                      </Text>
                    </View>
                    <CheckCircle size={16} color={COLORS.success} />
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Specialties */}
          {applicant.specialties && applicant.specialties.length > 0 && (
            <View style={styles.reviewSection}>
              <Text style={styles.reviewSectionTitle}>Specialties</Text>
              <View style={styles.specialtiesContainer}>
                {applicant.specialties.map((specialty, idx) => (
                  <View key={idx} style={styles.specialtyTag}>
                    <Text style={styles.specialtyText}>{specialty}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>

        {/* Modal Footer with Actions */}
        <View style={styles.modalFooter}>
          {renderModalActions()}
        </View>
      </SafeAreaView>
    </Modal>
  );
};

// ============================================
// Main Component
// ============================================
export default function ApplicantsScreen(): React.JSX.Element {
  const router = useRouter();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = typeof idParam === 'string' ? idParam : idParam[0];

  // State
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [job, setJob] = useState<JobDetails | null>(null);
  const [applications, setApplications] = useState<ApplicationWithProfile[]>([]);
  const [filteredApplications, setFilteredApplications] = useState<ApplicationWithProfile[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedApplication, setSelectedApplication] = useState<ApplicationWithProfile | null>(null);
  const [selectedCertifications, setSelectedCertifications] = useState<ApplicantCertification[]>([]);
  const [showReviewModal, setShowReviewModal] = useState<boolean>(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Stats
  const stats = useMemo(() => {
    return {
      total: applications.length,
      pending: applications.filter(a => a.status === 'pending').length,
      shortlisted: applications.filter(a => a.status === 'shortlisted').length,
      offered: applications.filter(a => a.status === 'offered').length,
      hired: applications.filter(a => a.status === 'hired').length,
      rejected: applications.filter(a => a.status === 'rejected').length,
    };
  }, [applications]);

  // ============================================
  // Data Fetching
  // ============================================
  useEffect(() => {
    if (id) {
      fetchData();
    }
  }, [id]);

  useEffect(() => {
    filterApplications();
  }, [applications, activeFilter, searchQuery]);

  const fetchData = async (isRefresh: boolean = false): Promise<void> => {
    try {
      if (!isRefresh) setLoading(true);

      // Fetch job details
      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .select('id, title, status, budget_min, budget_max, budget_type, currency, applications_count')
        .eq('id', id)
        .single();

      if (jobError) throw jobError;
      setJob(jobData as JobDetails);

      // Fetch applications with applicant profiles
      const { data: appsData, error: appsError } = await supabase
        .from('applications')
        .select(`
          *,
          applicant:profiles (
            id,
            first_name,
            last_name,
            email,
            avatar_url,
            title,
            bio,
            years_experience,
            hourly_rate,
            daily_rate,
            specialties
          )
        `)
        .eq('job_id', id)
        .order('created_at', { ascending: false });

      if (appsError) throw appsError;

      setApplications(appsData as ApplicationWithProfile[]);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load data';
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData(true);
  }, [id]);

  const filterApplications = useCallback(() => {
    let result = [...applications];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(app => {
        const name = getApplicantName(app.applicant).toLowerCase();
        const title = (app.applicant.title || '').toLowerCase();
        const coverNote = (app.cover_note || '').toLowerCase();
        return name.includes(query) || title.includes(query) || coverNote.includes(query);
      });
    }

    // Apply status filter
    if (activeFilter !== 'all') {
      result = result.filter(app => app.status === activeFilter);
    }

    // Sort: pending first, then shortlisted, then others by date
    result.sort((a, b) => {
      const statusOrder: Record<string, number> = {
        pending: 0,
        shortlisted: 1,
        offered: 2,
        hired: 3,
        rejected: 4,
        withdrawn: 5,
      };
      
      const orderDiff = (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
      if (orderDiff !== 0) return orderDiff;
      
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    setFilteredApplications(result);
  }, [applications, activeFilter, searchQuery]);

  // ============================================
  // Update Application Status Function
  // ============================================
  const updateApplicationStatus = async (
    applicationId: string,
    newStatus: ApplicationStatus
  ): Promise<void> => {
    try {
      setUpdatingId(applicationId);

      // Find the current application
      const currentApp = applications.find(a => a.id === applicationId);
      if (!currentApp) {
        throw new Error('Application not found');
      }

      // Validate transition
      if (!canTransitionTo(currentApp.status, newStatus)) {
        throw new Error(`Cannot change status from ${currentApp.status} to ${newStatus}`);
      }

      // Update in Supabase
      const { error } = await supabase
        .from('applications')
        .update({ 
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', applicationId);

      if (error) throw error;

      // Update local state immediately
      setApplications(prev => prev.map(app => 
        app.id === applicationId 
          ? { ...app, status: newStatus, updated_at: new Date().toISOString() }
          : app
      ));

      // Update selected application if it's open in the modal
      if (selectedApplication?.id === applicationId) {
        setSelectedApplication(prev => prev 
          ? { ...prev, status: newStatus, updated_at: new Date().toISOString() }
          : null
        );
      }

      // Show success message
      const statusLabel = APPLICATION_STATUS_CONFIG[newStatus].label;
      Alert.alert(
        'Status Updated',
        `Application has been marked as "${statusLabel}".`,
        [{ text: 'OK' }]
      );

      // Close modal if status is terminal
      if (isTerminalStatus(newStatus)) {
        setShowReviewModal(false);
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update status';
      Alert.alert('Error', message);
    } finally {
      setUpdatingId(null);
    }
  };

  // ============================================
  // Actions
  // ============================================
  const handleSelectApplication = async (application: ApplicationWithProfile): Promise<void> => {
    setSelectedApplication(application);

    // Mark as viewed if not already
    if (!application.last_viewed_by_client) {
      await supabase
        .from('applications')
        .update({ last_viewed_by_client: new Date().toISOString() })
        .eq('id', application.id);
    }

    // Fetch certifications
    const { data: certs } = await supabase
      .from('certifications')
      .select('id, name, status, issuing_organization')
      .eq('user_id', application.applicant_id)
      .eq('status', 'verified');

    setSelectedCertifications(certs || []);
    setShowReviewModal(true);
  };

  const handleCloseModal = () => {
    setShowReviewModal(false);
    setSelectedApplication(null);
    setSelectedCertifications([]);
  };

  // ============================================
  // Render
  // ============================================
  const renderApplication = ({ item }: { item: ApplicationWithProfile }) => {
    const isNew = !item.last_viewed_by_client && item.status === 'pending';
    const isUpdating = updatingId === item.id;
    
    return (
      <ApplicantCard
        application={item}
        job={job!}
        onPress={() => handleSelectApplication(item)}
        onStatusChange={updateApplicationStatus}
        updating={isUpdating}
        isNew={isNew}
      />
    );
  };

  const renderHeader = () => (
    <View style={styles.listHeader}>
      <StatsRow
        total={stats.total}
        pending={stats.pending}
        shortlisted={stats.shortlisted}
        offered={stats.offered}
      />

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputContainer}>
          <Search size={18} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search applicants..."
            placeholderTextColor={COLORS.textMuted}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <X size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filter Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterScroll}
      >
        <FilterChip
          label="All"
          count={stats.total}
          isActive={activeFilter === 'all'}
          onPress={() => setActiveFilter('all')}
        />
        <FilterChip
          label="Pending"
          count={stats.pending}
          isActive={activeFilter === 'pending'}
          onPress={() => setActiveFilter('pending')}
          color={COLORS.warning}
        />
        <FilterChip
          label="Shortlisted"
          count={stats.shortlisted}
          isActive={activeFilter === 'shortlisted'}
          onPress={() => setActiveFilter('shortlisted')}
          color={COLORS.purple}
        />
        <FilterChip
          label="Offered"
          count={stats.offered}
          isActive={activeFilter === 'offered'}
          onPress={() => setActiveFilter('offered')}
          color={COLORS.primary}
        />
        <FilterChip
          label="Hired"
          count={stats.hired}
          isActive={activeFilter === 'hired'}
          onPress={() => setActiveFilter('hired')}
          color={COLORS.success}
        />
        <FilterChip
          label="Rejected"
          count={stats.rejected}
          isActive={activeFilter === 'rejected'}
          onPress={() => setActiveFilter('rejected')}
          color={COLORS.error}
        />
      </ScrollView>

      {/* Results Count */}
      <View style={styles.resultsHeader}>
        <Text style={styles.resultsCount}>
          {filteredApplications.length} applicant{filteredApplications.length !== 1 ? 's' : ''}
        </Text>
      </View>
    </View>
  );

  // Loading State
  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['top']}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading applicants...</Text>
      </SafeAreaView>
    );
  }

  // Error State
  if (!job) {
    return (
      <SafeAreaView style={styles.errorContainer} edges={['top']}>
        <AlertCircle size={48} color={COLORS.error} />
        <Text style={styles.errorTitle}>Job Not Found</Text>
        <TouchableOpacity style={styles.errorButton} onPress={() => router.back()}>
          <Text style={styles.errorButtonText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <ArrowLeft size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Manage Applicants</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {job.title}
          </Text>
        </View>
        <TouchableOpacity style={styles.moreButton}>
          <MoreVertical size={24} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Main List */}
      <FlatList
        data={filteredApplications}
        renderItem={renderApplication}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          <EmptyState
            filter={activeFilter}
            onClearFilter={() => setActiveFilter('all')}
          />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
      />

      {/* Review Modal */}
      <ReviewModal
        visible={showReviewModal}
        application={selectedApplication}
        job={job}
        certifications={selectedCertifications}
        onClose={handleCloseModal}
        onStatusChange={updateApplicationStatus}
        updating={updatingId === selectedApplication?.id}
      />
    </SafeAreaView>
  );
}

// ============================================
// Styles
// ============================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 16,
    marginTop: 16,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 24,
  },
  errorButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: COLORS.card,
    borderRadius: 10,
  },
  errorButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
  },
  headerContent: {
    flex: 1,
    marginHorizontal: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  moreButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
  },

  // List
  listContent: {
    paddingBottom: 40,
  },
  listHeader: {
    paddingTop: 16,
  },
  separator: {
    height: 12,
  },

  // Stats Row
  statsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    marginHorizontal: 16,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: COLORS.border,
    marginHorizontal: 8,
  },

  // Search
  searchContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
    paddingVertical: 12,
  },

  // Filters
  filterScroll: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterChipActive: {
    backgroundColor: COLORS.primary + '20',
    borderColor: COLORS.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  filterChipTextActive: {
    color: COLORS.primary,
  },
  filterChipCount: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  filterChipCountText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
  },

  // Results Header
  resultsHeader: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  resultsCount: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },

  // Applicant Card
  applicantCard: {
    backgroundColor: COLORS.card,
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    position: 'relative',
  },
  applicantCardNew: {
    borderColor: COLORS.primary + '60',
  },
  applicantCardPressed: {
    backgroundColor: COLORS.cardHover,
  },
  newIndicator: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  newDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  applicantHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  applicantAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.border,
  },
  applicantAvatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.primary + '30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  applicantAvatarText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.primary,
  },
  applicantInfo: {
    flex: 1,
    marginLeft: 12,
  },
  applicantNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  applicantName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
  },
  applicantTitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  experienceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  experienceText: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  coverNotePreview: {
    backgroundColor: COLORS.inputBackground,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  coverNoteText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  applicantMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  appliedTime: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  appliedTimeText: {
    fontSize: 12,
    color: COLORS.textMuted,
  },

  // Status Badge
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusBadgeMedium: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 8,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusBadgeTextMedium: {
    fontSize: 12,
  },

  // Bid Comparison
  bidComparison: {
    flex: 1,
  },
  bidAmount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bidAmountText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  bidAmountHigher: {
    color: COLORS.error,
  },
  bidAmountLower: {
    color: COLORS.success,
  },
  bidNegotiable: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  bidDifference: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  bidDifferenceHigher: {
    backgroundColor: COLORS.error + '20',
  },
  bidDifferenceLower: {
    backgroundColor: COLORS.success + '20',
  },
  bidDifferenceText: {
    fontSize: 10,
    fontWeight: '600',
  },
  bidDifferenceTextHigher: {
    color: COLORS.error,
  },
  bidDifferenceTextLower: {
    color: COLORS.success,
  },

  // Action Section
  actionSection: {
    marginBottom: 12,
  },
  actionLoading: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  shortlistButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.yellow + '15',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.yellow + '30',
  },
  shortlistButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.yellow,
  },
  rejectButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.error + '15',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.error + '30',
  },
  rejectButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.error,
  },
  offerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.success,
    paddingVertical: 12,
    borderRadius: 10,
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  offerButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  offerSentContainer: {
    alignItems: 'center',
  },
  offerSentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.primary + '15',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.primary + '30',
  },
  offerSentText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  acceptedContainer: {
    alignItems: 'center',
  },
  acceptedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.success + '15',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.success + '30',
  },
  acceptedText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.success,
  },
  rejectedContainer: {
    alignItems: 'center',
  },
  rejectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.error + '15',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.error + '30',
  },
  rejectedText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.error,
  },

  // View Details Button
  viewDetailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  viewDetailsText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.primary,
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.card,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  clearFilterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: COLORS.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  clearFilterText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.primary,
  },

  // Modal Styles
  modalContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  modalScroll: {
    flex: 1,
  },
  modalScrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  // Review Header
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
  },
  reviewAvatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: COLORS.border,
  },
  reviewAvatarPlaceholder: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: COLORS.primary + '30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewAvatarText: {
    fontSize: 26,
    fontWeight: '600',
    color: COLORS.primary,
  },
  reviewInfo: {
    flex: 1,
    marginLeft: 16,
  },
  reviewName: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  reviewTitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },

  // Review Stats
  reviewStats: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  reviewStatItem: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  reviewStatValue: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  reviewStatLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  reviewStatDivider: {
    width: 1,
    backgroundColor: COLORS.border,
    marginHorizontal: 8,
  },

  // Review Sections
  reviewSection: {
    marginBottom: 20,
  },
  reviewSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 10,
  },
  coverNoteCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
  },
  coverNoteFullText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 24,
  },
  bioCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
  },
  bioText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 22,
  },
  certificationsCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    overflow: 'hidden',
  },
  certificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  certificationInfo: {
    flex: 1,
  },
  certificationName: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  certificationOrg: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  specialtiesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  specialtyTag: {
    backgroundColor: COLORS.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  specialtyText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },

  // Modal Footer
  modalFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  modalActionLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  modalActionLoadingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modalRejectButton: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: COLORS.error + '15',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.error + '30',
  },
  modalShortlistButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.yellow + '15',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.yellow + '30',
  },
  modalShortlistButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.yellow,
  },
  modalOfferButton: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.success,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  modalOfferButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  terminalStatusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.card,
    paddingVertical: 16,
    borderRadius: 14,
  },
  terminalStatusText: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  waitingBanner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.primary + '15',
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.primary + '30',
  },
  waitingText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.primary,
  },
});
