// ============================================================================
// EXAMPLE USAGE OF ChatFAB COMPONENT
// ============================================================================
// This is an example file showing how to integrate ChatFAB in a tab screen
// Replace this with your actual job details screen implementation

import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import ChatFAB from "@/components/chat/ChatFAB";

export default function JobDetailsScreen() {
  // Replace with your actual job data source
  const jobId = "abc-123";

  return (
    <View style={styles.container}>
      <ScrollView>
        <Text style={styles.title}>Job Details</Text>
        {/* Your existing job detail UI would go here */}
        <View style={styles.content}>
          <Text style={styles.label}>Job ID:</Text>
          <Text style={styles.value}>{jobId}</Text>
          
          <Text style={styles.label}>Description:</Text>
          <Text style={styles.value}>
            This is a sample job description. Replace this with your actual job details.
          </Text>
          
          <Text style={styles.label}>Status:</Text>
          <Text style={styles.value}>Active</Text>
        </View>
      </ScrollView>

      {/* Green FAB — opens chat for this job */}
      <ChatFAB context="job" contextId={jobId} unreadCount={3} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111827" },
  title: { 
    color: "#FFF", 
    fontSize: 22, 
    fontWeight: "700", 
    padding: 20,
    backgroundColor: "#0D1B2A",
    borderBottomWidth: 1,
    borderBottomColor: "#1F2937"
  },
  content: {
    padding: 20,
  },
  label: {
    fontSize: 14,
    color: "#9CA3AF",
    marginBottom: 4,
    marginTop: 12,
  },
  value: {
    fontSize: 16,
    color: "#E5E7EB",
    marginBottom: 16,
    lineHeight: 24,
  },
});