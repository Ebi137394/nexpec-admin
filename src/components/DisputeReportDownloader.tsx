import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from '@/lib/supabase';

interface DisputeReportDownloaderProps {
  dispute: {
    id: string;
    status: string;
    title?: string;
  };
  style?: any;
}

export const DisputeReportDownloader: React.FC<DisputeReportDownloaderProps> = ({ 
  dispute, 
  style 
}) => {
  const [isLoading, setIsLoading] = useState(false);

  const downloadReport = async () => {
    if (dispute.status !== 'resolved') {
      Alert.alert(
        "Report Not Available", 
        "This dispute has not been resolved yet. Official reports are only available for resolved disputes."
      );
      return;
    }

    setIsLoading(true);
    try {
      // ۱. فراخوانی تابع تولید PDF
      const { data, error } = await supabase.functions.invoke('generate-dispute-report', {
        body: { dispute_id: dispute.id }
      });

      if (error) {
        throw new Error(error.message || 'Failed to generate report');
      }

      if (!data || !data.url) {
        throw new Error('No report URL returned from server');
      }

      // ۲. دانلود فایل در حافظه موقت گوشی
      const fileName = dispute.title 
        ? `Dispute_Report_${dispute.title.replace(/\s+/g, '_')}_${dispute.id}.pdf`
        : `Dispute_Report_${dispute.id}.pdf`;
      
      const fileUri = FileSystem.documentDirectory + fileName;
      
      const downloadRes = await FileSystem.downloadAsync(data.url, fileUri);

      if (downloadRes.status !== 200) {
        throw new Error(`Download failed with status: ${downloadRes.status}`);
      }

      // ۳. باز کردن منوی اشتراک‌گذاری/ذخیره فایل
      await Sharing.shareAsync(downloadRes.uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Share Dispute Resolution Report'
      });

    } catch (error) {
      console.error('Error downloading dispute report:', error);
      Alert.alert(
        "Error", 
        error instanceof Error ? error.message : "Could not generate PDF report.",
        [{ text: "OK" }]
      );
    } finally {
      setIsLoading(false);
    }
  };

  // نمایش دکمه فقط اگر اختلاف حل شده باشد
  if (dispute.status !== 'resolved') {
    return null;
  }

  return (
    <View style={[styles.container, style]}>
      <TouchableOpacity 
        style={[styles.downloadBtn, isLoading && styles.disabledBtn]}
        onPress={downloadReport}
        disabled={isLoading}
        activeOpacity={0.7}
      >
        <Ionicons 
          name="document-text" 
          size={20} 
          color="#FFF" 
        />
        <Text style={styles.btnText}>
          {isLoading ? "Generating Report..." : "Download Official Report (PDF)"}
        </Text>
        {isLoading && (
          <View style={styles.loadingOverlay} />
        )}
      </TouchableOpacity>
      
      <Text style={styles.hintText}>
        Download the official dispute resolution report as a PDF document
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 16,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    position: 'relative',
  },
  disabledBtn: {
    backgroundColor: '#9CA3AF',
  },
  btnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 12,
    flex: 1,
  },
  hintText: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 16,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
  },
});

// Usage example component
export const DisputeDetailsWithReport: React.FC<{ dispute: any }> = ({ dispute }) => {
  return (
    <View style={{ flex: 1 }}>
      {/* Other dispute details components */}
      
      {/* Report downloader component */}
      <DisputeReportDownloader 
        dispute={dispute}
        style={{ marginHorizontal: 20 }}
      />
      
      {/* Other components */}
    </View>
  );
};