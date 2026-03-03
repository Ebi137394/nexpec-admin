import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { COLORS } from '../../src/constants/theme';

interface PdfViewerProps {
  uri: string;
  onError?: (error: string) => void;
}

const PdfViewer: React.FC<PdfViewerProps> = ({ uri, onError }) => {
  const [isLoading, setIsLoading] = useState(true);

  // Generate Google Docs viewer URL for Expo Go compatibility
  const getGoogleDocsViewerUrl = (fileUrl: string) => {
    try {
      // Ensure the URL is properly encoded
      const encodedUrl = encodeURIComponent(fileUrl);
      return `https://docs.google.com/viewer?url=${encodedUrl}&embedded=true`;
    } catch (error) {
      console.error('Error encoding URL:', error);
      return '';
    }
  };

  const handleLoadStart = () => {
    setIsLoading(true);
  };

  const handleLoadEnd = () => {
    setIsLoading(false);
  };

  const handleLoadError = (error: any) => {
    setIsLoading(false);
    console.error('PDF Viewer Error:', error);
    if (onError) {
      onError('Failed to load PDF document');
    } else {
      Alert.alert('Error', 'Failed to load PDF document');
    }
  };

  // Validate URI
  if (!uri || typeof uri !== 'string') {
    return (
      <View style={styles.errorContainer}>
        <View style={styles.errorContent}>
          <View style={styles.errorIcon} />
          <View style={styles.errorTextContainer}>
            <Text style={styles.errorTitle}>Invalid Document</Text>
            <Text style={styles.errorSubtitle}>No valid document URL provided</Text>
          </View>
        </View>
      </View>
    );
  }

  // Generate the Google Docs viewer URL
  const viewerUrl = getGoogleDocsViewerUrl(uri);

  if (!viewerUrl) {
    return (
      <View style={styles.errorContainer}>
        <View style={styles.errorContent}>
          <View style={styles.errorIcon} />
          <View style={styles.errorTextContainer}>
            <Text style={styles.errorTitle}>URL Error</Text>
            <Text style={styles.errorSubtitle}>Unable to process document URL</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        source={{ uri: viewerUrl }}
        style={styles.webview}
        onLoadStart={handleLoadStart}
        onLoadEnd={handleLoadEnd}
        onError={handleLoadError}
        onLoadProgress={({ nativeEvent }) => {
          if (nativeEvent.progress === 1) {
            setIsLoading(false);
          }
        }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={styles.loadingContainer}>
            <View style={styles.loadingContent}>
              <View style={styles.loadingIcon} />
              <Text style={styles.loadingText}>Loading Document...</Text>
            </View>
          </View>
        )}
        // Additional props for better compatibility
        scalesPageToFit={Platform.OS === 'android'}
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo={true}
        scrollEnabled={true}
        bounces={true}
        decelerationRate="normal"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  webview: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  loadingContent: {
    alignItems: 'center',
  },
  loadingIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    marginBottom: 16,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '600',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    padding: 24,
  },
  errorContent: {
    alignItems: 'center',
    maxWidth: 300,
  },
  errorIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.error,
    marginBottom: 16,
  },
  errorTextContainer: {
    alignItems: 'center',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  errorSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default PdfViewer;