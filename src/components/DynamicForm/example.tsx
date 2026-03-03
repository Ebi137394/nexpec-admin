import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { DynamicForm, FormField } from './index';
import { NEXPEC_THEME } from './theme';

// Example usage of the DynamicForm component
export const DynamicFormExample: React.FC = () => {
  // Define form schema
  const formSchema: FormField[] = [
    {
      name: 'fullName',
      label: 'Full Name',
      type: 'text',
      required: true,
      placeholder: 'Enter your full name',
      validation: {
        minLength: 2,
        maxLength: 50,
        pattern: '^[a-zA-Z\\s]+$',
        patternMessage: 'Name can only contain letters and spaces'
      },
      helperText: 'Please enter your full name as it appears on your ID'
    },
    {
      name: 'email',
      label: 'Email Address',
      type: 'text',
      required: true,
      placeholder: 'Enter your email address',
      validation: {
        pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
        patternMessage: 'Please enter a valid email address'
      }
    },
    {
      name: 'age',
      label: 'Age',
      type: 'number',
      required: true,
      placeholder: 'Enter your age',
      validation: {
        min: 18,
        max: 100
      },
      helperText: 'You must be at least 18 years old'
    },
    {
      name: 'country',
      label: 'Country',
      type: 'select',
      required: true,
      placeholder: 'Select your country',
      options: [
        { label: 'United States', value: 'US' },
        { label: 'Canada', value: 'CA' },
        { label: 'United Kingdom', value: 'UK' },
        { label: 'Australia', value: 'AU' },
        { label: 'Germany', value: 'DE' }
      ]
    },
    {
      name: 'birthDate',
      label: 'Date of Birth',
      type: 'date',
      required: true,
      placeholder: 'Select your date of birth'
    },
    {
      name: 'profilePhoto',
      label: 'Profile Photo',
      type: 'photo',
      required: false,
      placeholder: 'Upload a profile photo (optional)'
    }
  ];

  const handleSubmit = async (data: Record<string, any>) => {
    console.log('Form submitted with data:', data);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    Alert.alert(
      'Success!',
      'Form submitted successfully',
      [{ text: 'OK', onPress: () => console.log('OK Pressed') }]
    );
  };

  const defaultValues = {
    country: 'US',
    age: 25
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Dynamic Form Example</Text>
      <Text style={styles.subtitle}>A fully customizable form with validation</Text>
      
      <DynamicForm
        schema={formSchema}
        onSubmit={handleSubmit}
        submitButtonText="Submit Application"
        defaultValues={defaultValues}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NEXPEC_THEME.colors.background,
  },
  title: {
    fontSize: NEXPEC_THEME.fontSize.xxl,
    fontWeight: 'bold',
    color: NEXPEC_THEME.colors.text,
    textAlign: 'center',
    marginTop: NEXPEC_THEME.spacing.xl,
    marginBottom: NEXPEC_THEME.spacing.sm,
  },
  subtitle: {
    fontSize: NEXPEC_THEME.fontSize.lg,
    color: NEXPEC_THEME.colors.textSecondary,
    textAlign: 'center',
    marginBottom: NEXPEC_THEME.spacing.xxl,
  },
});
