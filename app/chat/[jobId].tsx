import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
// ✅ COMMENTED OUT: react-native-gifted-chat requires react-native-keyboard-controller (not compatible with Expo Go)
// import { GiftedChat, IMessage, Bubble, InputToolbar, Send, Composer } from 'react-native-gifted-chat';
import { ChevronLeft, User } from 'lucide-react-native';
import { Image } from 'react-native';
import { supabase } from '@/lib/supabase';

// ============================================================================
// TYPES
// ============================================================================

interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

// ✅ COMMENTED OUT: Types and helpers for GiftedChat (not needed for placeholder)
// interface DBMessage {
//   id: string;
//   job_id: string;
//   sender_id: string;
//   content: string;
//   created_at: string;
//   sender: Profile;
// }

// interface ChatUser {
//   _id: string;
//   name: string;
//   avatar?: string;
// }

// const transformMessage = (dbMessage: DBMessage): IMessage => {
//   const senderName = `${dbMessage.sender.first_name || ''} ${dbMessage.sender.last_name || ''}`.trim() || 'Unknown';
//   
//   return {
//     _id: dbMessage.id,
//     text: dbMessage.content,
//     createdAt: new Date(dbMessage.created_at),
//     user: {
//       _id: dbMessage.sender_id,
//       name: senderName,
//       avatar: dbMessage.sender.avatar_url || undefined,
//     },
//   };
// };

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// Custom Header Component
interface ChatHeaderProps {
  name: string;
  avatar: string | null;
  jobTitle: string;
  onBack: () => void;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({ name, avatar, jobTitle, onBack }) => (
  <View style={styles.header}>
    <TouchableOpacity onPress={onBack} style={styles.backButton} activeOpacity={0.7}>
      <ChevronLeft size={28} color="#0F172A" />
    </TouchableOpacity>
    
    <View style={styles.headerCenter}>
      {avatar ? (
        <Image source={{ uri: avatar }} style={styles.headerAvatar} />
      ) : (
        <View style={[styles.headerAvatar, styles.headerAvatarPlaceholder]}>
          <User size={20} color="#64748B" />
        </View>
      )}
      <View style={styles.headerText}>
        <Text style={styles.headerName} numberOfLines={1}>{name}</Text>
        <Text style={styles.headerJob} numberOfLines={1}>{jobTitle}</Text>
      </View>
    </View>
    
    <View style={styles.headerRight} />
  </View>
);

// Loading Screen
const LoadingScreen: React.FC = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#3B82F6" />
    <Text style={styles.loadingText}>Loading conversation...</Text>
  </View>
);

// Error Screen
interface ErrorScreenProps {
  message: string;
  onRetry: () => void;
}

const ErrorScreen: React.FC<ErrorScreenProps> = ({ message, onRetry }) => (
  <View style={styles.errorContainer}>
    <Text style={styles.errorText}>{message}</Text>
    <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
      <Text style={styles.retryButtonText}>Retry</Text>
    </TouchableOpacity>
  </View>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ChatScreen() {
  const { jobId: jobIdParam } = useLocalSearchParams<{ jobId: string }>();
  const jobId = typeof jobIdParam === 'string' ? jobIdParam : jobIdParam[0];
  const router = useRouter();
  
  // ✅ SIMPLIFIED STATE: Removed GiftedChat-related state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [otherUser, setOtherUser] = useState<{ name: string; avatar: string | null } | null>(null);
  const [jobTitle, setJobTitle] = useState('');
  
  // ✅ COMMENTED OUT: GiftedChat-related state and refs
  // const [messages, setMessages] = useState<IMessage[]>([]);
  // const [currentUser, setCurrentUser] = useState<ChatUser | null>(null);
  // const [isSending, setIsSending] = useState(false);
  // const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ✅ SIMPLIFIED: Fetch only job title and other user name for header
  const fetchJobParticipants = useCallback(async (userId: string) => {
    // Fetch job with client info
    const { data: jobData, error: jobError } = await supabase
      .from('jobs')
      .select(`
        id,
        title,
        client_id,
        client:profiles!jobs_client_id_fkey (
          id,
          first_name,
          last_name,
          avatar_url
        )
      `)
      .eq('id', jobId)
      .single();

    if (jobError || !jobData) {
      throw new Error('Failed to load job details');
    }

    // Fetch hired inspector for this job (status = 'hired', not 'accepted')
    const { data: applicationData } = await supabase
      .from('applications')
      .select(`
        applicant_id,
        applicant:profiles!applications_applicant_id_fkey (
          id,
          first_name,
          last_name,
          avatar_url
        )
      `)
      .eq('job_id', jobId)
      .eq('status', 'hired')
      .single();

    const client = jobData.client as unknown as Profile;
    const inspector = applicationData?.applicant as unknown as Profile | null;

    // Determine other user for header display
    const isClient = userId === jobData.client_id;
    
    if (isClient) {
      if (inspector) {
        setOtherUser({
          name: `${inspector.first_name || ''} ${inspector.last_name || ''}`.trim() || 'Inspector',
          avatar: inspector.avatar_url,
        });
      } else {
        setOtherUser({
          name: 'No Inspector Assigned',
          avatar: null,
        });
      }
    } else {
      setOtherUser({
        name: `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client',
        avatar: client.avatar_url,
      });
    }

    setJobTitle(jobData.title);
  }, [jobId]);

  // ✅ COMMENTED OUT: Message fetching and subscription (not needed for placeholder)
  // const fetchMessages = useCallback(async () => {
  //   // ... message fetching logic
  // }, [jobId]);

  // const subscribeToMessages = useCallback(() => {
  //   // ... subscription logic
  // }, [jobId]);

  // ✅ SIMPLIFIED: Initialize chat (only fetch job participants for header)
  const initializeChat = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setError('Please sign in to access chat');
        return;
      }

      await fetchJobParticipants(user.id);
    } catch (err) {
      console.error('Chat initialization error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load chat');
    } finally {
      setLoading(false);
    }
  }, [fetchJobParticipants]);

  // Effect: Initialize
  useEffect(() => {
    initializeChat();
  }, [initializeChat]);

  // ✅ COMMENTED OUT: All GiftedChat-related handlers and render functions
  // const onSend = useCallback(async (newMessages: IMessage[] = []) => {
  //   // ... send message logic
  // }, [currentUser, jobId, isSending]);

  // const renderBubble = (props: any) => { ... };
  // const renderInputToolbar = (props: any) => { ... };
  // const renderComposer = (props: any) => { ... };
  // const renderSend = (props: any) => { ... };
  // const renderAvatar = (props: any) => { ... };

  // Handle back navigation
  const handleBack = () => {
    router.back();
  };

  // Render states
  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ChatHeader
          name="Loading..."
          avatar={null}
          jobTitle=""
          onBack={handleBack}
        />
        <LoadingScreen />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ChatHeader
          name="Chat"
          avatar={null}
          jobTitle=""
          onBack={handleBack}
        />
        <ErrorScreen message={error} onRetry={initializeChat} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ChatHeader
        name={otherUser?.name || 'Chat'}
        avatar={otherUser?.avatar || null}
        jobTitle={jobTitle}
        onBack={handleBack}
      />
      
      {/* ✅ PLACEHOLDER: Simple text instead of GiftedChat component */}
      <View style={styles.placeholderContainer}>
        <Text style={styles.placeholderText}>Chat coming soon...</Text>
        <Text style={styles.placeholderSubtext}>
          This feature will be available in a future update.
        </Text>
      </View>
    </SafeAreaView>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
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
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  headerAvatarPlaceholder: {
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    marginLeft: 12,
    flex: 1,
  },
  headerName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerJob: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 1,
  },
  headerRight: {
    width: 40,
  },
  
  // ✅ PLACEHOLDER STYLES: Replaced GiftedChat styles with simple placeholder
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#FFFFFF',
  },
  placeholderText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1E293B',
    marginBottom: 8,
    textAlign: 'center',
  },
  placeholderSubtext: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
  },
  
  // ✅ COMMENTED OUT: GiftedChat-related styles (not needed)
  // chatContainer: { ... },
  // messagesContainer: { ... },
  // inputToolbar: { ... },
  // composer: { ... },
  // sendContainer: { ... },
  // sendButton: { ... },
  // messageAvatar: { ... },
  // scrollToBottom: { ... },
  
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
  
  // Error
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    textAlign: 'center',
    lineHeight: 24,
  },
  retryButton: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});

