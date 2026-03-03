import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  Alert,
} from 'react-native';
import { DynamicForm, FormField } from './index';

export const InspectionFormExample: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inspectionSchema: FormField[] = [
    {
      name: 'inspectorName',
      label: 'Inspector Name',
      type: 'text',
      required: true,
      placeholder: 'Enter inspector name',
      validation: {
        minLength: 2,
        maxLength: 50,
      },
    },
    {
      name: 'inspectionDate',
      label: 'Inspection Date',
      type: 'date',
      required: true,
    },
    {
      name: 'propertyAddress',
      label: 'Property Address',
      type: 'text',
      required: true,
      placeholder: 'Enter property address',
    },
    {
      name: 'roofCondition',
      label: 'Roof Condition',
      type: 'select',
      required: true,
      options: [
        { label: 'Excellent', value: 'excellent' },
        { label: 'Good', value: 'good' },
        { label: 'Fair', value: 'fair' },
        { label: 'Poor', value: 'poor' },
        { label: 'Needs Replacement', value: 'replacement' },
      ],
    },
    {
      name: 'roofPhotos',
      label: 'Roof Photos',
      type: 'photo',
      required: true,
      helperText: 'Take clear photos of the roof from multiple angles',
    },
    {
      name: 'roofVideo',
      label: 'Roof Video',
      type: 'video',
      required: false,
      helperText: 'Record a short video walkthrough of the roof condition',
    },
    {
      name: 'structuralIssues',
      label: 'Structural Issues Found',
      type: 'text',
      required: false,
      placeholder: 'Describe any structural issues found',
      helperText: 'Optional: Describe any cracks, sagging, or other structural concerns',
    },
    {
      name: 'estimatedRepairCost',
      label: 'Estimated Repair Cost',
      type: 'number',
      required: false,
      placeholder: 'Enter estimated cost in dollars',
      validation: {
        min: 0,
        max: 50000,
      },
      helperText: 'Optional: Provide rough estimate for repairs',
    },
    {
      name: 'inspectorSignature',
      label: 'Inspector Signature',
      type: 'signature',
      required: true,
      helperText: 'Sign to confirm inspection accuracy',
    },
    {
      name: 'notes',
      label: 'Additional Notes',
      type: 'text',
      required: false,
      placeholder: 'Any additional observations or recommendations',
      validation: {
        maxLength: 1000,
      },
      helperText: 'Optional: Add any other relevant information',
    },
  ];

  const handleSubmit = async (data: Record<string, any>) => {
    setIsSubmitting(true);
    
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('Form submitted with data:', data);
      
      Alert.alert(
        'Inspection Complete!',
        'Your inspection report has been successfully submitted.',
        [
          { text: 'OK', onPress: () => console.log('OK Pressed') }
        ]
      );
    } catch (error) {
      console.error('Submission error:', error);
      Alert.alert(
        'Submission Failed',
        'There was an error submitting your inspection. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Property Inspection Form</Text>
        <Text style={styles.subtitle}>
          Complete all required fields to submit your inspection report
        </Text>
      </View>
      
      <DynamicForm
        schema={inspectionSchema}
        onSubmit={handleSubmit}
        submitButtonText="Submit Inspection"
        isLoading={isSubmitting}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  } as ViewStyle,
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  } as ViewStyle,
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 8,
  } as TextStyle,
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 20,
  } as TextStyle,
});