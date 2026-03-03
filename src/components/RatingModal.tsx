// src/components/RatingModal.tsx
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';

interface Project {
  id: string;
  client_id: string;
  inspector_id: string;
  title?: string;
}

interface RatingModalProps {
  project: Project;
  onComplete: () => void;
}

export const RatingModal: React.FC<RatingModalProps> = ({ project, onComplete }) => {
  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const submitReview = async () => {
    if (!project.id || !project.client_id || !project.inspector_id) {
      Alert.alert("Error", "Invalid project data. Please try again.");
      return;
    }

    if (rating < 1 || rating > 5) {
      Alert.alert("Error", "Please select a rating between 1 and 5 stars.");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.from('reviews').insert({
        project_id: project.id,
        reviewer_id: project.client_id,
        reviewee_id: project.inspector_id,
        rating,
        comment: comment.trim(),
        created_at: new Date().toISOString()
      });

      if (error) {
        if (error.code === '23505') {
          Alert.alert("Already Rated", "You have already submitted a review for this project.");
        } else {
          throw error;
        }
      } else {
        Alert.alert(
          "Thank you!", 
          "Your feedback helps maintain NEXPEC quality and improves our service.",
          [
            {
              text: "OK",
              onPress: () => {
                onComplete();
              }
            }
          ]
        );
      }
    } catch (error) {
      console.error('Review submission error:', error);
      Alert.alert(
        "Error", 
        error instanceof Error ? error.message : "Failed to submit review. Please check your connection and try again.",
        [{ text: "OK" }]
      );
    } finally {
      setIsLoading(false);
    }
  };

  const getRatingText = (rating: number): string => {
    const ratingTexts = [
      "Poor",
      "Fair", 
      "Good",
      "Very Good",
      "Excellent"
    ];
    return ratingTexts[rating - 1] || "Professional";
  };

  const renderStars = () => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <TouchableOpacity
          key={i}
          style={[styles.starContainer, i <= rating && styles.starSelected]}
          onPress={() => setRating(i)}
        >
          <Text style={[styles.star, i <= rating && styles.starSelectedText]}>
            ★
          </Text>
        </TouchableOpacity>
      );
    }
    return stars;
  };

  return (
    <View style={styles.modalContainer}>
      <Text style={styles.title}>Rate the Inspection</Text>
      
      <Text style={styles.subtitle}>
        How would you rate your experience with this inspector?
      </Text>

      <View style={styles.ratingContainer}>
        <View style={styles.starsContainer}>
          {renderStars()}
        </View>
        <Text style={styles.ratingText}>
          {getRatingText(rating)} ({rating}/5)
        </Text>
      </View>

      <Text style={styles.commentLabel}>Additional Comments</Text>
      <TextInput
        placeholder="Share your experience with this inspector..."
        placeholderTextColor="#9CA3AF"
        multiline
        numberOfLines={4}
        value={comment}
        onChangeText={setComment}
        style={styles.commentInput}
        maxLength={500}
      />
      <Text style={styles.charCount}>{comment.length}/500</Text>

      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          onPress={onComplete}
          style={styles.cancelButton}
          disabled={isLoading}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          onPress={submitReview}
          style={[styles.submitButton, isLoading && styles.disabledButton]}
          disabled={isLoading}
          activeOpacity={0.7}
        >
          <Text style={styles.submitButtonText}>
            {isLoading ? "Submitting..." : "Submit Feedback"}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.note}>
        Your feedback is anonymous and helps us maintain quality standards.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    padding: 24,
    backgroundColor: '#FFF',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 8,
    margin: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  ratingContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  starsContainer: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  starContainer: {
    marginHorizontal: 4,
  },
  star: {
    fontSize: 36,
    color: '#E5E7EB',
  },
  starSelected: {
    transform: [{ scale: 1.2 }],
  },
  starSelectedText: {
    color: '#F59E0B',
    textShadowColor: 'rgba(0, 0, 0, 0.1)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  ratingText: {
    fontSize: 16,
    color: '#374151',
    fontWeight: '600',
  },
  commentLabel: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '600',
    marginBottom: 8,
  },
  commentInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
    textAlignVertical: 'top',
  },
  charCount: {
    textAlign: 'right',
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#6B7280',
    fontWeight: '600',
    fontSize: 16,
  },
  submitButton: {
    flex: 2,
    backgroundColor: '#3B82F6',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#3B82F6',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  disabledButton: {
    backgroundColor: '#9CA3AF',
  },
  submitButtonText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  note: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 18,
    fontStyle: 'italic',
  },
});