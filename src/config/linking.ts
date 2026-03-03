import * as Linking from 'expo-linking';

// Deep linking configuration for password reset
export const linking = {
  prefixes: ['nexpec://'],
  config: {
    screens: {
      ResetPassword: 'reset-password',
      ForgotPassword: 'forgot-password',
      SignIn: 'sign-in',
      SignUp: 'sign-up',
    },
  },
};

// Helper function to handle deep links
export const handleDeepLink = (url: string) => {
  const parsedUrl = Linking.parse(url);
  
  if (parsedUrl.path === 'reset-password') {
    return { screen: 'ResetPassword' };
  }
  
  return null;
};

// Get initial URL for deep linking
export const getInitialURL = async () => {
  const url = await Linking.getInitialURL();
  return url;
};

// Listen for deep link events
export const subscribeToDeepLinks = (callback: (url: string) => void) => {
  const subscription = Linking.addEventListener('url', ({ url }) => {
    callback(url);
  });
  
  return subscription;
};