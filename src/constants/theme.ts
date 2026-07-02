// src/constants/theme.ts

// Dark theme colors
const darkColors = {
  // Primary Colors
  primary: '#7C3AED',      // Brand Violet
  secondary: '#8B5CF6',    // Purple
  accent: '#FF006E',       // Accent Pink (optional)
  
  // Background Colors
  background: '#020420',   // Dark Background
  surface: '#1e293b',      // Dark Gray Surface (Card)
  surfaceLight: '#252540', // Lighter Surface
  
  // Text Colors
  text: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  
  // Status Colors
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
  
  // Border & Divider
  border: '#2D2D3A',
  divider: '#1F1F2E',
  
  // Legacy aliases for backward compatibility
  textPrimary: '#FFFFFF',
};

// Light theme colors
const lightColors = {
  // Primary Colors
  primary: '#7C3AED',      // Brand Violet
  secondary: '#8B5CF6',    // Purple (keep same)
  accent: '#FF006E',       // Accent Pink (keep same)
  
  // Background Colors
  background: '#f0f2f5',   // Light Background
  surface: '#ffffff',      // White Card
  surfaceLight: '#f8f9fa', // Lighter Surface
  
  // Text Colors
  text: '#000000',
  textSecondary: '#4B5563',
  textMuted: '#6B7280',
  
  // Status Colors (keep same)
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
  
  // Border & Divider
  border: '#E5E7EB',
  divider: '#D1D5DB',
  
  // Legacy aliases
  textPrimary: '#000000',
};

// Export function to get colors based on theme mode
export const getColors = (isDarkMode: boolean = true) => {
  return isDarkMode ? darkColors : lightColors;
};

// Export default dark colors for backward compatibility
export const COLORS = darkColors;

export const SIZES = {
  // Spacing
  padding: 24,
  margin: 16,
  radius: 16,
  
  // Font Sizes
  h1: 32,
  h2: 24,
  h3: 20,
  body: 16,
  caption: 14,
  small: 12,
  
  // Logo sizes (kept for backward compatibility)
  logoWidth: 200,
  logoHeight: 200,
  
  // Base spacing unit
  base: 8,
  font: 14,
};

export const FONTS = {
  bold: '700',
  semiBold: '600',
  medium: '500',
  regular: '400',
};

export default { COLORS, SIZES, FONTS };
