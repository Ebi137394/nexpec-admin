// src/screens/FormScreen.tsx

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { ArrowLeft, FileText } from 'lucide-react-native';
import { DynamicForm } from '../components/DynamicForm/DynamicForm';
import { useFormTemplate, supabase } from '../hooks/useFormTemplate';
import { NEXPEC_THEME } from '../components/DynamicForm/theme';

type FormScreenRouteParams = {
  FormScreen: {
    templateId: string;
  };
};

export const FormScreen: React.FC = () => {
  const route = useRoute<RouteProp<FormScreenRouteParams, 'FormScreen'>>();
  const navigation = useNavigation();
  const { templateId } = route.params;

  const { template, schema, isLoading, error } = useFormTemplate(templateId);

  const handleSubmit = async (formData: Record<string, any>) => {
    try {
      // Submit form data to Supabase
      const { data, error: submitError } = await supabase
        .from('form_submissions')
        .insert({
          template_id: templateId,
          data: formData,
          submitted_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (submitError) {
        throw new Error(submitError.message);
      }

      Alert.alert(
        'Success',
        'Form submitted successfully!',
        [
          {
            text: 'OK',
            onPress: () => navigation.goBack(),
          },
        ]
      );

      console.log('Form submitted:', data);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to submit form';
      Alert.alert('Error', errorMessage);
      console.error('Submit error:', err);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator
            size="large"
            color={NEXPEC_THEME.colors.primary}
          />
          <Text style={styles.loadingText}>Loading form...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.retryButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <ArrowLeft size={24} color={NEXPEC_THEME.colors.text} />
        </TouchableOpacity>
        
        <View style={styles.headerTitleContainer}>
          <FileText size={20} color={NEXPEC_THEME.colors.primary} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {template?.name || 'Form'}
          </Text>
        </View>
        
        <View style={styles.headerSpacer} />
      </View>

      {template?.description && (
        <Text style={styles.description}>{template.description}</Text>
      )}

      {/* Form */}
      <DynamicForm
        schema={schema}
        onSubmit={handleSubmit}
        submitButtonText="Submit Form"
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NEXPEC_THEME.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: NEXPEC_THEME.spacing.lg,
    paddingVertical: NEXPEC_THEME.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: NEXPEC_THEME.colors.inputBorder,
  },
  backButton: {
    padding: NEXPEC_THEME.spacing.sm,
    marginLeft: -NEXPEC_THEME.spacing.sm,
  },
  headerTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: NEXPEC_THEME.spacing.sm,
  },
  headerTitle: {
    fontSize: NEXPEC_THEME.fontSize.lg,
    fontWeight: '600',
    color: NEXPEC_THEME.colors.text,
  },
  headerSpacer: {
    width: 40,
  },
  description: {
    fontSize: NEXPEC_THEME.fontSize.sm,
    color: NEXPEC_THEME.colors.textSecondary,
    paddingHorizontal: NEXPEC_THEME.spacing.lg,
    paddingVertical: NEXPEC_THEME.spacing.md,
    backgroundColor: NEXPEC_THEME.colors.cardBackground,
    borderBottomWidth: 1,
    borderBottomColor: NEXPEC_THEME.colors.inputBorder,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: NEXPEC_THEME.spacing.md,
  },
  loadingText: {
    fontSize: NEXPEC_THEME.fontSize.md,
    color: NEXPEC_THEME.colors.textSecondary,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: NEXPEC_THEME.spacing.xl,
    gap: NEXPEC_THEME.spacing.lg,
  },
  errorText: {
    fontSize: NEXPEC_THEME.fontSize.md,
    color: NEXPEC_THEME.colors.error,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: NEXPEC_THEME.colors.primary,
    paddingHorizontal: NEXPEC_THEME.spacing.xl,
    paddingVertical: NEXPEC_THEME.spacing.md,
    borderRadius: NEXPEC_THEME.borderRadius.md,
  },
  retryButtonText: {
    fontSize: NEXPEC_THEME.fontSize.md,
    fontWeight: '600',
    color: NEXPEC_THEME.colors.text,
  },
});

export default FormScreen;