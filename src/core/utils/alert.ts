import { Alert, Platform } from 'react-native';

export const showAlert = (title: string, message: string, onPress?: () => void) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
    if (onPress) onPress();
  } else {
    Alert.alert(title, message, [
      { text: 'OK', onPress: onPress }
    ]);
  }
};

export const showConfirm = (title: string, message: string, onConfirm: () => void) => {
  if (Platform.OS === 'web') {
    const confirmed = window.confirm(`${title}\n\n${message}`);
    if (confirmed) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes', style: 'destructive', onPress: onConfirm }
    ]);
  }
};

