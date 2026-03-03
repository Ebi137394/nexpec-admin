import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

// کامپوننت ستاره‌ها با استفاده از آیکون‌های حرفه‌ای
interface StarRatingProps {
  rating: number;
  onRatingChange: (rating: number) => void;
  size?: number;
}

const StarRating: React.FC<StarRatingProps> = ({ rating, onRatingChange, size = 44 }) => {
  return (
    <View style={styles.starsContainer}>
      {[1, 2, 3, 4, 5].map((star) => (
        <TouchableOpacity
          key={star}
          onPress={() => onRatingChange(star)}
          activeOpacity={0.7}
          style={styles.starButton}
        >
          <Ionicons 
            name={star <= rating ? 'star' : 'star-outline'} 
            size={size} 
            color="#FFD700" // رنگ طلایی
          />
        </TouchableOpacity>
      ))}
    </View>
  );
};

export default function RateInspector() {
  const { projectId, inspectorId, inspectorName } = useLocalSearchParams<{
    projectId: string;
    inspectorId: string;
    inspectorName?: string;
  }>();
  
  const router = useRouter();

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingExisting, setCheckingExisting] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    initializeReview();
  }, []);

  const initializeReview = async () => {
    try {
      setCheckingExisting(true);

      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) throw sessionError;
      
      if (!session?.user?.id) {
        Alert.alert('Error', 'You must be logged in to submit a review');
        router.back();
        return;
      }

      setUserId(session.user.id);

      // چک کردن اینکه آیا قبلاً نظری ثبت شده یا نه
      const { data: existingReview, error: reviewError } = await supabase
        .from('reviews')
        .select('id, rating, comment')
        .eq('reviewer_id', session.user.id)
        .eq('project_id', projectId)
        .maybeSingle();

      if (reviewError && reviewError.code !== 'PGRST116') {
        throw reviewError;
      }

      if (existingReview) {
        Alert.alert(
          'Already Reviewed',
          'You have already submitted a review for this project. You can update it.',
          [
            {
              text: 'Edit Review',
              onPress: () => {
                setRating(existingReview.rating);
                setComment(existingReview.comment || '');
              },
            },
            {
              text: 'Cancel',
              onPress: () => router.back(),
              style: 'cancel',
            },
          ]
        );
      }
    } catch (error: any) {
      console.error('Initialize review error:', error);
      Alert.alert('Error', error.message || 'Failed to load review data');
    } finally {
      setCheckingExisting(false);
    }
  };

  const handleSubmit = async () => {
    if (rating === 0) {
      Alert.alert('Rating Required', 'Please select a star rating before submitting');
      return;
    }

    if (!userId || !inspectorId) {
      Alert.alert('Error', 'Missing user or inspector information.');
      return;
    }

    setLoading(true);

    try {
      // یک بار دیگر چک می‌کنیم تا از تداخل جلوگیری شود
      const { data: existingReview } = await supabase
        .from('reviews')
        .select('id')
        .eq('reviewer_id', userId)
        .eq('project_id', projectId)
        .maybeSingle();

      if (existingReview) {
        // آپدیت نظر قبلی
        const { error: updateError } = await supabase
          .from('reviews')
          .update({
            rating,
            comment: comment.trim() || null,
          })
          .eq('id', existingReview.id);

        if (updateError) throw updateError;

        Alert.alert('Updated!', 'Your review has been updated successfully.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        // ثبت نظر جدید
        const { error: insertError } = await supabase
          .from('reviews')
          .insert([
            {
              reviewer_id: userId,
              reviewee_id: inspectorId,
              project_id: projectId,
              rating,
              comment: comment.trim() || null,
            },
          ]);

        if (insertError) {
          if (insertError.code === '23505') { // کد ارور تکراری بودن
            Alert.alert('Duplicate', 'You have already reviewed this project.');
            return;
          }
          throw insertError;
        }

        Alert.alert('Thank You!', 'Your review has been submitted.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (error: any) {
      Alert.alert('Submission Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  if (checkingExisting) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <Stack.Screen 
        options={{ 
          title: 'Write a Review',
          headerStyle: { backgroundColor: '#0F172A' },
          headerTintColor: '#fff',
          headerBackTitle: 'Back'
        }} 
      />

      <ScrollView contentContainerStyle={styles.contentContainer}>
        <View style={styles.header}>
            <Text style={styles.title}>Rate Your Experience</Text>
            {inspectorName && <Text style={styles.subtitle}>with {inspectorName}</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Tap stars to rate:</Text>
          <StarRating rating={rating} onRatingChange={setRating} />
          <Text style={styles.ratingText}>
            {rating === 0 && 'Select a rating'}
            {rating === 1 && 'Poor'}
            {rating === 2 && 'Fair'}
            {rating === 3 && 'Good'}
            {rating === 4 && 'Very Good'}
            {rating === 5 && 'Excellent'}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Feedback (Optional)</Text>
          <TextInput
            style={styles.textArea}
            placeholder="Share details about punctuality, quality, etc..."
            placeholderTextColor="#64748B"
            multiline
            numberOfLines={6}
            value={comment}
            onChangeText={setComment}
            textAlignVertical="top"
            maxLength={500}
          />
          <Text style={styles.characterCount}>{comment.length}/500</Text>
        </View>

        <TouchableOpacity
          style={[styles.submitButton, (loading || rating === 0) && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={loading || rating === 0}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>Submit Review</Text>
          )}
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617', // پس‌زمینه سرمه‌ای تیره
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#020617',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#94A3B8',
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
    marginTop: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#94A3B8',
  },
  card: {
    backgroundColor: '#1E293B', // رنگ کارت‌ها
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#334155',
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F1F5F9',
    marginBottom: 12,
  },
  starsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 10,
  },
  starButton: {
    padding: 4,
  },
  ratingText: {
    fontSize: 18,
    color: '#FFD700',
    fontWeight: '600',
    marginTop: 8,
    minHeight: 24,
  },
  textArea: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#334155',
    minHeight: 120,
  },
  characterCount: {
    textAlign: 'right',
    fontSize: 12,
    color: '#64748B',
    marginTop: 8,
  },
  submitButton: {
    backgroundColor: '#3B82F6', // آبی اصلی
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  submitButtonDisabled: {
    backgroundColor: '#334155', // دکمه غیرفعال
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
