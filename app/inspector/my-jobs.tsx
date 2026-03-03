import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Clock,
  CheckCircle,
  XCircle,
  MessageCircle,
  Briefcase,
  Calendar,
  DollarSign,
  ChevronRight,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { showAlert, showConfirm } from '@/lib/alert';
import {
  ApplicationStatus,
  APPLICATION_STATUS_CONFIG,
  canTransitionTo,
} from '@/types/application';
import { getApplicantName, getApplicantInitials } from '@/types/application';

// ============================================================================
// TYPES
// ============================================================================

interface MyApplication {
  id: string;
  application_id: string;
  created_at: string;
  status: ApplicationStatus;
  job_id: string;
  job_title: string;
  job_status: string;
  price: number | null;
  currency: string;
  client_id: string;
  client_first_name: string | null;
  client_last_name: string | null;
  client_avatar: string | null;
}

type TabKey = 'applied' | 'active' | 'history';

interface TabConfig {
  key: TabKey;
  label: string;
  statuses: ApplicationStatus[];
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const TABS: TabConfig[] = [
  { key: 'applied', label: 'Applied', statuses: ['pending', 'reviewing', 'shortlisted'] },
  { key: 'active', label: 'Active', statuses: ['offered', 'hired'] },
  { key: 'history', label: 'History', statuses: ['rejected', 'withdrawn'] },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatPrice = (price: number | null, currency: string = 'USD'): string => {
  if (price === null || price === undefined) return 'Price TBD';
  
  const symbol = currency === 'CAD' ? 'CA$' : 
                 currency === 'EUR' ? '€' : 
                 currency === 'GBP' ? '£' : '$';
  
  return `${symbol}${price.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// Status Badge Component
const StatusBadge: React.FC<{ status: ApplicationStatus }> = ({ status }) => {
  const config = APPLICATION_STATUS_CONFIG[status] || APPLICATION_STATUS_CONFIG.pending;

  return (
    <View style={[styles.statusBadge, { backgroundColor: config.bgColor }]}>
      <View style={[styles.statusDot, { backgroundColor: config.color }]} />
      <Text style={[styles.statusBadgeText, { color: config.color }]}>
        {config.label}
      </Text>
    </View>
  );
};

// Avatar Component
const Avatar: React.FC<{ uri: string | null; name: string; size?: number }> = ({
  uri,
  name,
  size = 44,
}) => {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const avatarStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  if (uri) {
    return <Image source={{ uri }} style={[styles.avatar, avatarStyle]} />;
  }

  return (
    <View style={[styles.avatar, styles.avatarPlaceholder, avatarStyle]}>
      <Text style={[styles.avatarInitials, { fontSize: size * 0.35 }]}>
        {initials || '?'}
      </Text>
    </View>
  );
};

// Tab Bar Component
interface TabBarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  getTabCount: (tab: TabKey) => number;
}

const TabBar: React.FC<TabBarProps> = ({ activeTab, onTabChange, getTabCount }) => {
  return (
    <View style={styles.tabContainer}>
      {TABS.map((tab) => {
        const count = getTabCount(tab.key);
        const isActive = activeTab === tab.key;

        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, isActive && styles.tabActive]}
            onPress={() => onTabChange(tab.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
              {tab.label}
            </Text>
            {count > 0 && (
              <View style={[styles.tabBadge, isActive && styles.tabBadgeActive]}>
                <Text
                  style={[styles.tabBadgeText, isActive && styles.tabBadgeTextActive]}
                >
                  {count}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

// Action Buttons Component
interface ActionButtonsProps {
  status: ApplicationStatus;
  applicationId: string;
  jobId: string;
  isUpdating: boolean;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  onWithdraw: (id: string) => void;
  onMessage: (id: string, jobId: string) => void;
}

const ActionButtons: React.FC<ActionButtonsProps> = ({
  status,
  applicationId,
  jobId,
  isUpdating,
  onAccept,
  onDecline,
  onWithdraw,
  onMessage,
}) => {
  if (isUpdating) {
    return (
      <View style={styles.loadingButtonContainer}>
        <ActivityIndicator size="small" color="#3B82F6" />
        <Text style={styles.loadingButtonText}>Updating...</Text>
      </View>
    );
  }

  switch (status) {
    case 'offered':
      return (
        <View style={styles.actionButtonsRow}>
          <TouchableOpacity
            style={[styles.actionButton, styles.acceptButton]}
            onPress={() => onAccept(applicationId)}
            activeOpacity={0.8}
          >
            <CheckCircle size={20} color="#FFFFFF" />
            <Text style={styles.acceptButtonText}>Accept Offer</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.declineButton]}
            onPress={() => onDecline(applicationId)}
            activeOpacity={0.8}
          >
            <XCircle size={20} color="#EF4444" />
            <Text style={styles.declineButtonText}>Decline</Text>
          </TouchableOpacity>
        </View>
      );

    case 'pending':
    case 'reviewing':
    case 'shortlisted':
      return (
        <TouchableOpacity
          style={[styles.actionButton, styles.withdrawButton]}
          onPress={() => onWithdraw(applicationId)}
          activeOpacity={0.8}
        >
          <XCircle size={18} color="#64748B" />
          <Text style={styles.withdrawButtonText}>Withdraw Application</Text>
        </TouchableOpacity>
      );

    case 'hired':
      return (
        <TouchableOpacity
          style={[styles.actionButton, styles.messageButton]}
          onPress={() => onMessage(applicationId, jobId)}
          activeOpacity={0.8}
        >
          <MessageCircle size={20} color="#FFFFFF" />
          <Text style={styles.messageButtonText}>Message Client</Text>
          <ChevronRight size={18} color="#FFFFFF" style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>
      );

    default:
      return null;
  }
};

// My Job Card Component
interface MyJobCardProps {
  application: MyApplication;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  onWithdraw: (id: string) => void;
  onMessage: (id: string, jobId: string) => void;
  isUpdating: boolean;
  onPress: () => void;
}

const MyJobCard: React.FC<MyJobCardProps> = ({
  application,
  onAccept,
  onDecline,
  onWithdraw,
  onMessage,
  isUpdating,
  onPress,
}) => {
  const {
    id,
    status,
    job_title,
    price,
    currency,
    client_first_name,
    client_last_name,
    client_avatar,
    created_at,
    job_id,
  } = application;

  const clientName = `${client_first_name || ''} ${client_last_name || ''}`.trim() || 'Client';
  const showActions = ['offered', 'pending', 'reviewing', 'shortlisted', 'hired'].includes(status);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.95}>
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={styles.clientInfo}>
          <Avatar uri={client_avatar} name={clientName} />
          <View style={styles.clientDetails}>
            <Text style={styles.clientName} numberOfLines={1}>
              {clientName}
            </Text>
            <Text style={styles.clientLabel}>Client</Text>
          </View>
        </View>
        <StatusBadge status={status} />
      </View>

      {/* Body */}
      <View style={styles.cardBody}>
        <Text style={styles.jobTitle} numberOfLines={2}>
          {job_title}
        </Text>

        <View style={styles.jobMeta}>
          <View style={styles.metaItem}>
            <DollarSign size={16} color="#10B981" />
            <Text style={styles.priceText}>{formatPrice(price, currency)}</Text>
          </View>
          <View style={styles.metaDivider} />
          <View style={styles.metaItem}>
            <Calendar size={16} color="#64748B" />
            <Text style={styles.dateText}>Applied {formatDate(created_at)}</Text>
          </View>
        </View>
      </View>

      {/* Footer / Actions */}
      {showActions && (
        <View style={styles.cardFooter}>
          <ActionButtons
            status={status}
            applicationId={id}
            jobId={job_id}
            isUpdating={isUpdating}
            onAccept={onAccept}
            onDecline={onDecline}
            onWithdraw={onWithdraw}
            onMessage={onMessage}
          />
        </View>
      )}
    </TouchableOpacity>
  );
};

// Empty State Component
const EmptyState: React.FC<{ tab: TabKey }> = ({ tab }) => {
  const content: Record<TabKey, { icon: React.ReactNode; title: string; subtitle: string }> = {
    applied: {
      icon: <Clock size={72} color="#CBD5E1" strokeWidth={1.5} />,
      title: 'No Pending Applications',
      subtitle: 'Jobs you apply to will appear here while awaiting a response',
    },
    active: {
      icon: <Briefcase size={72} color="#CBD5E1" strokeWidth={1.5} />,
      title: 'No Active Jobs',
      subtitle: 'Once you accept an offer, your active jobs will show here',
    },
    history: {
      icon: <CheckCircle size={72} color="#CBD5E1" strokeWidth={1.5} />,
      title: 'No Job History',
      subtitle: 'Completed and closed jobs will be archived here',
    },
  };

  const { icon, title, subtitle } = content[tab];

  return (
    <View style={styles.emptyState}>
      {icon}
      <Text style={styles.emptyStateTitle}>{title}</Text>
      <Text style={styles.emptyStateSubtitle}>{subtitle}</Text>
    </View>
  );
};

// Loading Screen Component
const LoadingScreen: React.FC = () => (
  <View style={styles.loadingScreen}>
    <ActivityIndicator size="large" color="#3B82F6" />
    <Text style={styles.loadingText}>Loading your jobs...</Text>
  </View>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function InspectorMyJobsScreen() {
  const router = useRouter();

  // State
  const [applications, setApplications] = useState<MyApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('applied');
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  // Fetch applications from Supabase
  const fetchApplications = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        console.error('No authenticated user found');
        setLoading(false);
        return;
      }

      // Fetch applications with job and client details
      const { data, error } = await supabase
        .from('applications')
        .select(`
          id,
          status,
          created_at,
          job_id,
          bid_amount,
          currency,
          job:jobs (
            id,
            title,
            status,
            client_id,
            client:profiles!jobs_client_id_fkey (
              id,
              first_name,
              last_name,
              avatar_url
            )
          )
        `)
        .eq('applicant_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching applications:', error);
        showAlert('Error', 'Failed to load your applications. Please try again.');
        return;
      }

      // Transform data to match MyApplication interface
      const transformedData: MyApplication[] = (data || []).map((app: any) => ({
        id: app.id,
        application_id: app.id,
        created_at: app.created_at,
        status: app.status as ApplicationStatus,
        job_id: app.job_id,
        job_title: app.job?.title || 'Untitled Job',
        job_status: app.job?.status || 'open',
        price: app.bid_amount,
        currency: app.currency || 'USD',
        client_id: app.job?.client_id || '',
        client_first_name: app.job?.client?.first_name || null,
        client_last_name: app.job?.client?.last_name || null,
        client_avatar: app.job?.client?.avatar_url || null,
      }));

      setApplications(transformedData);
    } catch (error) {
      console.error('Unexpected error:', error);
      showAlert('Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  // Refresh handler
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchApplications();
  }, [fetchApplications]);

  // Update application status
  const updateApplicationStatus = async (
    applicationId: string,
    newStatus: ApplicationStatus,
    successMessage?: string
  ) => {
    // Track updating state
    setUpdatingIds((prev) => new Set(prev).add(applicationId));

    // Store previous state for rollback
    const previousApplications = [...applications];

    // Optimistic update
    setApplications((prev) =>
      prev.map((app) =>
        app.id === applicationId ? { ...app, status: newStatus } : app
      )
    );

    try {
      const { error } = await supabase
        .from('applications')
        .update({ status: newStatus })
        .eq('id', applicationId);

      if (error) {
        // Rollback on error
        setApplications(previousApplications);
        showAlert('Error', 'Failed to update application. Please try again.');
        console.error('Update error:', error);
        return;
      }

      // Show success message if provided
      if (successMessage) {
        showAlert('Success', successMessage);
      }

      // Refresh to get latest data
      fetchApplications();
    } catch (error) {
      // Rollback on error
      setApplications(previousApplications);
      showAlert('Error', 'Something went wrong. Please try again.');
      console.error('Unexpected error:', error);
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(applicationId);
        return next;
      });
    }
  };

  // Action Handlers
  const handleAccept = useCallback((applicationId: string) => {
    showConfirm(
      'Accept Offer',
      'Are you sure you want to accept this job offer? This action cannot be undone.',
      async () => {
        // Validate transition
        const app = applications.find(a => a.id === applicationId);
        if (app && !canTransitionTo(app.status, 'hired')) {
          showAlert('Error', 'Cannot accept this application in its current state.');
          return;
        }

        await updateApplicationStatus(
          applicationId,
          'hired',
          'Congratulations! You have accepted the job offer.'
        );
      }
    );
  }, [applications]);

  const handleDecline = useCallback((applicationId: string) => {
    showConfirm(
      'Decline Offer',
      'Are you sure you want to decline this offer? This action cannot be undone.',
      () => {
        const app = applications.find(a => a.id === applicationId);
        if (app && !canTransitionTo(app.status, 'withdrawn')) {
          showAlert('Error', 'Cannot decline this application in its current state.');
          return;
        }
        updateApplicationStatus(applicationId, 'withdrawn', 'Offer declined.');
      }
    );
  }, [applications]);

  const handleWithdraw = useCallback((applicationId: string) => {
    showConfirm(
      'Withdraw Application',
      'Are you sure you want to withdraw your application?',
      () => {
        const app = applications.find(a => a.id === applicationId);
        if (app && !canTransitionTo(app.status, 'withdrawn')) {
          showAlert('Error', 'Cannot withdraw this application in its current state.');
          return;
        }
        updateApplicationStatus(applicationId, 'withdrawn', 'Application withdrawn.');
      }
    );
  }, [applications]);

  const handleMessage = useCallback((applicationId: string, jobId: string) => {
    if (jobId) {
      router.push(`/messages/${jobId}`);
    } else {
      showAlert('Error', 'Job information not available.');
    }
  }, [router]);

  const handleCardPress = useCallback((application: MyApplication) => {
    router.push(`/jobs/${application.job_id}`);
  }, [router]);

  // Filter applications by active tab
  const filteredApplications = applications.filter((app) => {
    const currentTab = TABS.find((t) => t.key === activeTab);
    return currentTab?.statuses.includes(app.status);
  });

  // Get count for each tab
  const getTabCount = useCallback(
    (tabKey: TabKey): number => {
      const tab = TABS.find((t) => t.key === tabKey);
      return applications.filter((app) => tab?.statuses.includes(app.status)).length;
    },
    [applications]
  );

  // Render loading state
  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <LoadingScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Jobs</Text>
        <Text style={styles.headerSubtitle}>
          Track your applications and active jobs
        </Text>
      </View>

      {/* Tab Bar */}
      <TabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        getTabCount={getTabCount}
      />

      {/* Content */}
      {filteredApplications.length === 0 ? (
        <EmptyState tab={activeTab} />
      ) : (
        <FlatList
          data={filteredApplications}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MyJobCard
              application={item}
              onAccept={handleAccept}
              onDecline={handleDecline}
              onWithdraw={handleWithdraw}
              onMessage={handleMessage}
              isUpdating={updatingIds.has(item.id)}
              onPress={() => handleCardPress(item)}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#3B82F6"
              colors={['#3B82F6']}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        />
      )}
    </SafeAreaView>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  // Container
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },

  // Loading
  loadingScreen: {
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

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 15,
    color: '#64748B',
    marginTop: 4,
  },

  // Tabs
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  tabActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  tabLabelActive: {
    color: '#FFFFFF',
  },
  tabBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    minWidth: 24,
    alignItems: 'center',
  },
  tabBadgeActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  tabBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  tabBadgeTextActive: {
    color: '#FFFFFF',
  },

  // List
  listContent: {
    padding: 16,
    paddingTop: 4,
  },

  // Card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  clientInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  clientDetails: {
    marginLeft: 12,
    flex: 1,
  },
  clientName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1E293B',
  },
  clientLabel: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 1,
  },

  // Avatar
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarPlaceholder: {
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    fontSize: 16,
    fontWeight: '700',
    color: '#64748B',
  },

  // Status Badge
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Card Body
  cardBody: {
    padding: 16,
  },
  jobTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  jobMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaDivider: {
    width: 1,
    height: 16,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 14,
  },
  priceText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#10B981',
  },
  dateText: {
    fontSize: 14,
    color: '#64748B',
  },

  // Card Footer
  cardFooter: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 4,
  },

  // Action Buttons
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    gap: 8,
  },
  acceptButton: {
    flex: 1,
    backgroundColor: '#22C55E',
  },
  acceptButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  declineButton: {
    flex: 1,
    backgroundColor: '#FEF2F2',
    borderWidth: 1.5,
    borderColor: '#FECACA',
  },
  declineButtonText: {
    color: '#EF4444',
    fontSize: 15,
    fontWeight: '600',
  },
  withdrawButton: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    alignSelf: 'flex-start',
  },
  withdrawButtonText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600',
  },
  messageButton: {
    flex: 1,
    backgroundColor: '#3B82F6',
  },
  messageButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  // Loading Button
  loadingButtonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 10,
  },
  loadingButtonText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },

  // Empty State
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 48,
    paddingBottom: 80,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 24,
    textAlign: 'center',
  },
  emptyStateSubtitle: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
});

