import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AudioDiagnose from './audio/AudioDiagnose';
import TimeLapseViewer from './vision/TimeLapseViewer';

const COLORS = {
  bg: '#020617',
  bgCard: '#0a1628',
  bgCardBorder: '#0e2a4d',
  cyan: '#00f0ff',
  cyanDim: '#00f0ff40',
  cyanGlow: '#00f0ff20',
  green: '#00ff88',
  greenDim: '#00ff8830',
  red: '#ff003c',
  redDim: '#ff003c30',
  amber: '#ffaa00',
  amberDim: '#ffaa0030',
  white: '#e0e6f0',
  whiteDim: '#e0e6f060',
};

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

const FrontierScreen: React.FC = () => {
  const [activeModule, setActiveModule] = useState<'audio' | 'vision'>('audio');

  return (
    <View style={styles.container}>
      {/* Module selector tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeModule === 'audio' && styles.tabActive]}
          onPress={() => setActiveModule('audio')}
        >
          <Text style={[styles.tabText, activeModule === 'audio' && styles.tabTextActive]}>
            🎧 AUDIO SHAZAM
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeModule === 'vision' && styles.tabActive]}
          onPress={() => setActiveModule('vision')}
        >
          <Text style={[styles.tabText, activeModule === 'vision' && styles.tabTextActive]}>
            ⏳ CORROSION 4D
          </Text>
        </TouchableOpacity>
      </View>

      {/* Module content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {activeModule === 'audio' ? <AudioDiagnose /> : <TimeLapseViewer />}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: COLORS.bg 
  },
  
  // Tab bar
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgCardBorder,
    paddingTop: 50,
    backgroundColor: COLORS.bg,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { 
    borderBottomColor: COLORS.cyan 
  },
  tabText: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: COLORS.whiteDim,
    letterSpacing: 1.5,
  },
  tabTextActive: { 
    color: COLORS.cyan 
  },
  
  // Content
  content: { 
    flex: 1 
  },
});

export default FrontierScreen;