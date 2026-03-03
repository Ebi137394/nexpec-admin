import { View, Text, StyleSheet } from 'react-native';
import { JobUrgency } from '@/types/job';

type Props = {
  urgency: JobUrgency | null | undefined;
};

// Map JobUrgency to display config
// 'normal' maps to 'medium' for display purposes
const urgencyConfig: Record<JobUrgency, { label: string; bgColor: string; textColor: string }> = {
  low: {
    label: 'Low',
    bgColor: '#dbeafe',
    textColor: '#1e40af',
  },
  normal: {
    label: 'Medium',
    bgColor: '#fef3c7',
    textColor: '#92400e',
  },
  high: {
    label: 'High',
    bgColor: '#fee2e2',
    textColor: '#991b1b',
  },
  urgent: {
    label: 'Urgent',
    bgColor: '#fee2e2',
    textColor: '#991b1b',
  },
};

export default function UrgencyBadge({ urgency }: Props) {
  // Safety check: return null if urgency is not provided or invalid
  if (!urgency || !(urgency in urgencyConfig)) {
    return null;
  }

  const config = urgencyConfig[urgency];

  // ✅ FIX: Double-check config exists (defensive programming)
  if (!config || !config.bgColor || !config.textColor) {
    return null;
  }

  return (
    <View style={[styles.badge, { backgroundColor: config.bgColor }]}>
      <Text style={[styles.text, { color: config.textColor }]}>
        {config.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});
