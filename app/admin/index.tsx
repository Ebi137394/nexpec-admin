// app/admin/index.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Dimensions,
  SafeAreaView,
  StatusBar,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  SlideInRight,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Certification {
  id: string;
  user_id: string;
  title: string;
  organization: string;
  issue_date: string;
  expiry_date: string | null;
  image_url: string | null;
  verified?: boolean; // Legacy field (optional)
  status?: 'pending' | 'verified' | 'rejected'; // ✅ Added status field
  created_at: string;
  profiles: {
    id: string;
    full_name: string;
    avatar_url: string | null;
    email: string;
    is_verified: boolean;
  };
}

interface Stats {
  pending: number;
  verified: number;
  rejected: number;
  total: number;
}

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export default function AdminDashboard() {
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedCert, setSelectedCert] = useState<Certification | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>({
    pending: 0,
    verified: 0,
    rejected: 0,
    total: 0,
  });

  // Animation values
  const headerScale = useSharedValue(1);
  const modalScale = useSharedValue(0);

  useEffect(() => {
    fetchCertifications();
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      // Get total certifications
      const { count: total } = await supabase
        .from('certifications')
        .select('*', { count: 'exact', head: true });

      // ✅ Get pending certifications (using status column)
      const { count: pending } = await supabase
        .from('certifications')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      // ✅ Get verified certifications
      const { count: verified } = await supabase
        .from('certifications')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'verified');

      // ✅ Get rejected certifications
      const { count: rejected } = await supabase
        .from('certifications')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'rejected');

      setStats({
        pending: pending || 0,
        verified: verified || 0,
        rejected: rejected || 0,
        total: total || 0,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchCertifications = async () => {
    try {
      setLoading(true);
      
      // ✅ Use Supabase relationship join with foreign key constraint (certifications.user_id -> profiles.id)
      // ✅ Filter for pending status
      const { data, error } = await supabase
        .from('certifications')
        .select(`
          *,
          profiles:user_id (
            id,
            full_name,
            avatar_url,
            email,
            is_verified
          )
        `)
        .eq('status', 'pending') // ✅ Filter by status = 'pending'
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase query error:', error);
        throw error;
      }

      // Map the data to handle both organization and issuing_org fields
      // ✅ Ensure profiles relation is properly extracted
      const mappedData = (data || []).map((cert: any) => ({
        ...cert,
        organization: cert.organization || cert.issuing_org || cert.issuing_organization || 'Unknown Organization',
        // ✅ Ensure profiles is always an object (Supabase may return array or object)
        profiles: Array.isArray(cert.profiles) ? cert.profiles[0] : cert.profiles || {
          id: cert.user_id,
          full_name: 'Unknown User',
          avatar_url: null,
          email: cert.user_id || 'No email',
          is_verified: false,
        },
      }));

      setCertifications(mappedData);
    } catch (error: any) {
      console.error('Error fetching certifications:', error);
      Alert.alert(
        'Error', 
        error.message || 'Failed to load pending verifications. Please check the database relationship.'
      );
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchCertifications(), fetchStats()]);
    setRefreshing(false);
  }, []);

  const handleVerify = async (cert: Certification) => {
    Alert.alert(
      'Verify Certification',
      `Are you sure you want to verify "${cert.title}" for ${cert.profiles?.full_name || 'Unknown Inspector'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Verify',
          style: 'default',
          onPress: async () => {
            try {
              setProcessingId(cert.id);

              // ✅ Update certification status to 'verified'
              const { error: certError } = await supabase
                .from('certifications')
                .update({ status: 'verified' })
                .eq('id', cert.id);

              if (certError) throw certError;

              // Check if user has any verified certifications now
              const { count } = await supabase
                .from('certifications')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', cert.user_id)
                .eq('status', 'verified');

              // If this is their first verified cert, update their profile
              if (count && count >= 1) {
                await supabase
                  .from('profiles')
                  .update({ is_verified: true })
                  .eq('id', cert.user_id);
              }

              // Remove from list
              setCertifications(prev => prev.filter(c => c.id !== cert.id));
              
              // Update stats
              setStats(prev => ({
                ...prev,
                pending: prev.pending - 1,
                verified: prev.verified + 1,
              }));

              Alert.alert(
                '✅ Certification Verified',
                `${cert.title} has been verified successfully. The inspector now has a "Vetted" badge.`,
                [{ text: 'OK' }]
              );
            } catch (error) {
              console.error('Error verifying:', error);
              Alert.alert('Error', 'Failed to verify certification');
            } finally {
              setProcessingId(null);
            }
          },
        },
      ]
    );
  };

  const handleReject = async (cert: Certification) => {
    Alert.alert(
      'Reject Certification',
      `Are you sure you want to reject "${cert.title}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            try {
              setProcessingId(cert.id);

              // ✅ Update certification status to 'rejected' (instead of deleting)
              const { error } = await supabase
                .from('certifications')
                .update({ status: 'rejected' })
                .eq('id', cert.id);

              if (error) throw error;

              // Remove from pending list
              setCertifications(prev => prev.filter(c => c.id !== cert.id));
              
              // Update stats
              setStats(prev => ({
                ...prev,
                pending: prev.pending - 1,
                rejected: prev.rejected + 1,
              }));

              Alert.alert(
                '❌ Certification Rejected',
                'The certification has been rejected.',
                [{ text: 'OK' }]
              );
            } catch (error) {
              console.error('Error rejecting:', error);
              Alert.alert('Error', 'Failed to reject certification');
            } finally {
              setProcessingId(null);
            }
          },
        },
      ]
    );
  };

  const openImageViewer = (cert: Certification) => {
    if (cert.image_url) {
      setSelectedCert(cert);
      setSelectedImage(cert.image_url);
      modalScale.value = withSpring(1, { damping: 15 });
    }
  };

  const closeImageViewer = () => {
    modalScale.value = withTiming(0, { duration: 200 });
    setTimeout(() => {
      setSelectedImage(null);
      setSelectedCert(null);
    }, 200);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getTimeAgo = (dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const modalAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: modalScale.value }],
    opacity: modalScale.value,
  }));

  const renderStatCard = (
    icon: string,
    label: string,
    value: number,
    color: string,
    index: number
  ) => (
    <Animated.View
      entering={FadeInDown.delay(index * 100).springify()}
      style={[styles.statCard, { borderColor: color + '30' }]}
    >
      <LinearGradient
        colors={[color + '15', 'transparent']}
        style={styles.statCardGradient}
      />
      <View style={[styles.statIconContainer, { backgroundColor: color + '20' }]}>
        <Ionicons name={icon as any} size={20} color={color} />
      </View>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Animated.View>
  );

  const renderCertificationCard = ({ item, index }: { item: Certification; index: number }) => {
    const isProcessing = processingId === item.id;
    const inspector = item.profiles;

    return (
      <Animated.View
        entering={SlideInRight.delay(index * 100).springify()}
        style={styles.certCard}
      >
        <LinearGradient
          colors={['rgba(59, 130, 246, 0.05)', 'transparent']}
          style={styles.certCardGradient}
        />

        {/* Header Row */}
        <View style={styles.certHeader}>
          <View style={styles.inspectorInfo}>
            {inspector?.avatar_url ? (
              <Image source={{ uri: inspector.avatar_url }} style={styles.inspectorAvatar} />
            ) : (
              <View style={styles.inspectorAvatarPlaceholder}>
                <Ionicons name="person" size={20} color="#6B7280" />
              </View>
            )}
            <View style={styles.inspectorDetails}>
              <View style={styles.nameRow}>
                <Text style={styles.inspectorName}>
                  {inspector?.full_name || 'Unknown Inspector'}
                </Text>
                {inspector?.is_verified && (
                  <View style={styles.verifiedBadge}>
                    <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                  </View>
                )}
              </View>
              <Text style={styles.inspectorEmail}>{inspector?.email || 'No email'}</Text>
            </View>
          </View>
          <View style={styles.timeAgo}>
            <Ionicons name="time-outline" size={12} color="#6B7280" />
            <Text style={styles.timeAgoText}>{getTimeAgo(item.created_at)}</Text>
          </View>
        </View>

        {/* Certification Details */}
        <View style={styles.certDetails}>
          <View style={styles.certTitleRow}>
            <Ionicons name="ribbon" size={18} color="#3B82F6" />
            <Text style={styles.certTitle}>{item.title}</Text>
          </View>
          <View style={styles.certOrgRow}>
            <Ionicons name="business-outline" size={16} color="#6B7280" />
            <Text style={styles.certOrg}>{item.organization}</Text>
          </View>
          <View style={styles.certDatesRow}>
            <View style={styles.dateItem}>
              <Text style={styles.dateLabel}>Issued:</Text>
              <Text style={styles.dateValue}>{formatDate(item.issue_date)}</Text>
            </View>
            {item.expiry_date && (
              <View style={styles.dateItem}>
                <Text style={styles.dateLabel}>Expires:</Text>
                <Text style={[
                  styles.dateValue,
                  new Date(item.expiry_date) < new Date() && styles.expiredDate
                ]}>
                  {formatDate(item.expiry_date)}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Certificate Image */}
        {item.image_url && (
          <TouchableOpacity
            style={styles.certImageContainer}
            onPress={() => openImageViewer(item)}
            activeOpacity={0.8}
          >
            <Image source={{ uri: item.image_url }} style={styles.certImage} />
            <View style={styles.imageOverlay}>
              <Ionicons name="expand-outline" size={24} color="#FFF" />
              <Text style={styles.imageOverlayText}>Tap to View Full Size</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.actionButton, styles.rejectButton]}
            onPress={() => handleReject(item)}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <>
                <Ionicons name="close-circle" size={20} color="#EF4444" />
                <Text style={styles.rejectButtonText}>Reject</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.verifyButton]}
            onPress={() => handleVerify(item)}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#FFF" />
                <Text style={styles.verifyButtonText}>Verify</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  };

  const renderEmptyState = () => (
    <Animated.View entering={FadeIn.delay(300)} style={styles.emptyState}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="checkmark-done-circle" size={80} color="#10B981" />
      </View>
      <Text style={styles.emptyTitle}>All Caught Up! 🎉</Text>
      <Text style={styles.emptySubtitle}>
        No pending certifications to review.{'\n'}
        Check back later for new submissions.
      </Text>
      <TouchableOpacity style={styles.refreshButton} onPress={onRefresh}>
        <Ionicons name="refresh" size={20} color="#3B82F6" />
        <Text style={styles.refreshButtonText}>Refresh</Text>
      </TouchableOpacity>
    </Animated.View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Header */}
      <Animated.View entering={FadeInDown.springify()} style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <View style={styles.headerTitleRow}>
            <Ionicons name="shield-checkmark" size={28} color="#3B82F6" />
            <Text style={styles.headerTitle}>Admin Console</Text>
          </View>
          <Text style={styles.headerSubtitle}>Pending Verifications</Text>
        </View>
        <TouchableOpacity style={styles.settingsButton}>
          <Ionicons name="settings-outline" size={24} color="#6B7280" />
        </TouchableOpacity>
      </Animated.View>

      {/* Stats */}
      <View style={styles.statsContainer}>
        {renderStatCard('time', 'Pending', stats.pending, '#F59E0B', 0)}
        {renderStatCard('checkmark-done', 'Verified', stats.verified, '#10B981', 1)}
        {renderStatCard('close-circle', 'Rejected', stats.rejected, '#EF4444', 2)}
        {renderStatCard('documents', 'Total', stats.total, '#3B82F6', 3)}
      </View>

      {/* Certifications List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading pending verifications...</Text>
        </View>
      ) : (
        <FlatList
          data={certifications}
          keyExtractor={(item) => item.id}
          renderItem={renderCertificationCard}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#3B82F6"
              colors={['#3B82F6']}
            />
          }
        />
      )}

      {/* Image Viewer Modal */}
      <Modal
        visible={selectedImage !== null}
        transparent
        animationType="none"
        onRequestClose={closeImageViewer}
      >
        <View style={styles.modalOverlay}>
          <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} />
          
          <Animated.View style={[styles.modalContent, modalAnimatedStyle]}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{selectedCert?.title}</Text>
                <Text style={styles.modalSubtitle}>
                  {selectedCert?.profiles?.full_name} • {selectedCert?.organization}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={closeImageViewer}
              >
                <Ionicons name="close" size={24} color="#FFF" />
              </TouchableOpacity>
            </View>

            {/* Full Size Image */}
            <View style={styles.fullImageContainer}>
              {selectedImage && (
                <Image
                  source={{ uri: selectedImage }}
                  style={styles.fullImage}
                  resizeMode="contain"
                />
              )}
            </View>

            {/* Modal Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalActionButton, styles.modalRejectButton]}
                onPress={() => {
                  closeImageViewer();
                  if (selectedCert) handleReject(selectedCert);
                }}
              >
                <Ionicons name="close-circle" size={22} color="#EF4444" />
                <Text style={styles.modalRejectText}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalActionButton, styles.modalVerifyButton]}
                onPress={() => {
                  closeImageViewer();
                  if (selectedCert) handleVerify(selectedCert);
                }}
              >
                <Ionicons name="checkmark-circle" size={22} color="#FFF" />
                <Text style={styles.modalVerifyText}>Verify</Text>
              </TouchableOpacity>
            </View>

            {/* Verification Checklist */}
            <View style={styles.checklistContainer}>
              <Text style={styles.checklistTitle}>Verification Checklist</Text>
              <View style={styles.checklistItem}>
                <Ionicons name="checkmark-circle-outline" size={18} color="#6B7280" />
                <Text style={styles.checklistText}>Document is clearly visible</Text>
              </View>
              <View style={styles.checklistItem}>
                <Ionicons name="checkmark-circle-outline" size={18} color="#6B7280" />
                <Text style={styles.checklistText}>Certification details match</Text>
              </View>
              <View style={styles.checklistItem}>
                <Ionicons name="checkmark-circle-outline" size={18} color="#6B7280" />
                <Text style={styles.checklistText}>No signs of tampering</Text>
              </View>
              <View style={styles.checklistItem}>
                <Ionicons name="checkmark-circle-outline" size={18} color="#6B7280" />
                <Text style={styles.checklistText}>Expiry date is valid</Text>
              </View>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020420',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerContent: {
    flex: 1,
    marginLeft: 16,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFF',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  statCardGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  statIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#6B7280',
    marginTop: 12,
    fontSize: 14,
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  certCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
  },
  certCardGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  certHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  inspectorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  inspectorAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  inspectorAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  inspectorDetails: {
    marginLeft: 12,
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inspectorName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
  verifiedBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderRadius: 10,
    padding: 2,
  },
  inspectorEmail: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  timeAgo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  timeAgoText: {
    fontSize: 12,
    color: '#6B7280',
  },
  certDetails: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  certTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  certTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
    flex: 1,
  },
  certOrgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  certOrg: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  certDatesRow: {
    flexDirection: 'row',
    gap: 24,
  },
  dateItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  dateValue: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  expiredDate: {
    color: '#EF4444',
  },
  certImageContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    position: 'relative',
  },
  certImage: {
    width: '100%',
    height: 180,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageOverlayText: {
    color: '#FFF',
    fontSize: 13,
    marginTop: 8,
    opacity: 0.8,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  rejectButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  rejectButtonText: {
    color: '#EF4444',
    fontSize: 15,
    fontWeight: '600',
  },
  verifyButton: {
    backgroundColor: '#10B981',
  },
  verifyButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyIconContainer: {
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 12,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  refreshButtonText: {
    color: '#3B82F6',
    fontSize: 15,
    fontWeight: '600',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxHeight: SCREEN_HEIGHT * 0.9,
    backgroundColor: 'rgba(20, 20, 40, 0.95)',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#6B7280',
  },
  modalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImageContainer: {
    width: '100%',
    height: SCREEN_HEIGHT * 0.4,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  modalActions: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  modalRejectButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  modalRejectText: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: '600',
  },
  modalVerifyButton: {
    backgroundColor: '#10B981',
  },
  modalVerifyText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  checklistContainer: {
    padding: 16,
  },
  checklistTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9CA3AF',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  checklistText: {
    fontSize: 14,
    color: '#9CA3AF',
  },
});

