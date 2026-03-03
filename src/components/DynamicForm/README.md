# DynamicForm Component

A fully customizable, type-safe form component for React Native applications with comprehensive validation and multiple field types.

## Features

- **Multiple Field Types**: Text, Number, Select, Photo, and Date fields
- **Comprehensive Validation**: Built-in validation with custom error messages
- **Type Safety**: Full TypeScript support with strict type checking
- **Customizable Styling**: Consistent with project design system
- **Accessibility**: Proper labeling and error handling
- **Keyboard Handling**: Automatic keyboard avoidance
- **Image Upload**: Integrated photo field with camera/gallery options

## Installation

The DynamicForm component is part of the project's component library. Import it directly:

```typescript
import { DynamicForm, FormField } from '../components/DynamicForm';
```

## Basic Usage

```typescript
import React from 'react';
import { DynamicForm, FormField } from '../components/DynamicForm';

const MyForm: React.FC = () => {
  const formSchema: FormField[] = [
    {
      name: 'email',
      label: 'Email Address',
      type: 'text',
      required: true,
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
      validation: {
        min: 18,
        max: 100
      }
    }
  ];

  const handleSubmit = async (data: Record<string, any>) => {
    console.log('Form data:', data);
    // Handle form submission
  };

  return (
    <DynamicForm
      schema={formSchema}
      onSubmit={handleSubmit}
      submitButtonText="Submit"
    />
  );
};
```

## Field Types

### Text Field
```typescript
{
  name: 'username',
  label: 'Username',
  type: 'text',
  required: true,
  placeholder: 'Enter your username',
  validation: {
    minLength: 3,
    maxLength: 20,
    pattern: '^[a-zA-Z0-9_]+$'
  }
}
```

### Number Field
```typescript
{
  name: 'age',
  label: 'Age',
  type: 'number',
  required: true,
  validation: {
    min: 18,
    max: 100
  }
}
```

### Select Field
```typescript
{
  name: 'country',
  label: 'Country',
  type: 'select',
  required: true,
  options: [
    { label: 'United States', value: 'US' },
    { label: 'Canada', value: 'CA' }
  ]
}
```

### Photo Field
```typescript
{
  name: 'profilePhoto',
  label: 'Profile Photo',
  type: 'photo',
  required: false,
  placeholder: 'Upload your photo'
}
```

### Date Field
```typescript
{
  name: 'birthDate',
  label: 'Date of Birth',
  type: 'date',
  required: true,
  placeholder: 'Select your birth date'
}
```

## Validation Rules

### Common Validation
- `required`: Field is mandatory
- `minLength`: Minimum character length for text fields
- `maxLength`: Maximum character length for text fields
- `min`: Minimum value for number fields
- `max`: Maximum value for number fields
- `pattern`: Regular expression pattern for text validation
- `patternMessage`: Custom error message for pattern validation

### Field-Specific Validation
- **Text Fields**: Support all validation rules
- **Number Fields**: Support `min`, `max`, and `required`
- **Select Fields**: Validate against available options
- **Date Fields**: Must be valid Date objects
- **Photo Fields**: Must be valid image URIs

## Props

### DynamicForm Props
- `schema`: Array of FormField objects defining the form structure
- `onSubmit`: Function called when form is submitted successfully
- `submitButtonText`: Text for the submit button (default: "Submit")
- `isLoading`: Boolean to show loading state (default: false)
- `defaultValues`: Object with initial field values

### FormField Properties
- `name`: Unique identifier for the field
- `label`: Display label for the field
- `type`: Field type ('text' | 'number' | 'select' | 'photo' | 'date')
- `required`: Whether the field is mandatory
- `placeholder`: Placeholder text for the field
- `options`: Array of options for select fields
- `validation`: Validation rules object
- `defaultValue`: Initial value for the field
- `helperText`: Additional help text displayed below the label

## Styling

The component uses the NEXPEC theme with:
- Consistent spacing and padding using theme values
- Proper shadow and border styling with theme colors
- Error state styling with theme error colors
- Responsive layout that works on all screen sizes
- Keyboard avoidance for better UX
- Dark theme with purple primary accents
- Professional industrial design aesthetic

## Error Handling

- Real-time validation on field blur
- Clear error messages with specific feedback
- Visual indicators for required fields
- Form-level validation before submission
- Graceful handling of validation errors

## Best Practices

1. **Field Naming**: Use descriptive, unique field names
2. **Validation**: Always provide meaningful error messages
3. **Required Fields**: Mark only essential fields as required
4. **Helper Text**: Use helper text to guide users
5. **Default Values**: Provide sensible defaults when possible
6. **Accessibility**: Ensure all fields have proper labels

## Example Use Cases

- User registration forms
- Profile editing
- Job application forms
- Inspection reports
- Survey forms
- Settings configuration

## Dependencies

- React Native
- Expo ImagePicker (for photo fields)
- @react-native-community/datetimepicker (for date fields)
- @expo/vector-icons (for icons)
- Project's Button component
- NEXPEC_THEME (for consistent styling)

## Theme Configuration

The component uses the NEXPEC_THEME which includes:

```typescript
import { NEXPEC_THEME } from '../components/DynamicForm/theme';

// Theme structure
{
  colors: {
    background: '#020420',        // Deep navy background
    primary: '#7C3AED',           // Purple primary
    inputBackground: '#0F172A',   // Dark input background
    inputBorder: '#1E293B',       // Input border color
    text: '#FFFFFF',              // White text
    error: '#EF4444',             // Red for errors
    // ... more colors
  },
  spacing: {
    sm: 8, lg: 16, xl: 20,        // Consistent spacing
  },
  borderRadius: {
    lg: 12, xl: 16,               // Rounded corners
  },
  fontSize: {
    md: 16, lg: 18, xl: 20,       // Text sizing
  }
}
```

## Browser Support

- iOS 12+
- Android API 21+
- Expo SDK 52+
