import React from 'react';
import { View, StyleSheet } from 'react-native';
import { VideoField } from './fields/VideoField';
import { FieldProps } from './types';

// Simple test component to verify VideoField works
const TestVideoField: React.FC = () => {
  const [videoValue, setVideoValue] = React.useState<any>(null);
  const [error, setError] = React.useState<string>('');

  const field: FieldProps['field'] = {
    name: 'testVideo',
    label: 'Test Video Field',
    type: 'video',
    required: true,
    helperText: 'Record a video for testing'
  };

  const handleVideoChange = (value: any) => {
    setVideoValue(value);
    setError('');
  };

  const handleVideoBlur = () => {
    if (!videoValue?.uri) {
      setError('Video is required');
    }
  };

  return (
    <View style={styles.container}>
      <VideoField
        field={field}
        value={videoValue}
        onChange={handleVideoChange}
        onBlur={handleVideoBlur}
        error={error}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
});

export default TestVideoField;