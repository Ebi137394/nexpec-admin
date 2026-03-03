import React from 'react';
import { WebView } from 'react-native-webview';
import { View, ActivityIndicator, StyleSheet } from 'react-native';

export default function PdfViewer({ uri }: { uri: string }) {
  // استفاده از نمایشگر گوگل برای رندر صحیح PDF در اندروید و iOS
  const viewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(uri)}&embedded=true`;

  return (
    <View style={styles.container}>
      <WebView 
        source={{ uri: viewerUrl }}
        startInLoadingState={true}
        renderLoading={() => <ActivityIndicator color="#00CFD5" size="large" />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020420' }
});
