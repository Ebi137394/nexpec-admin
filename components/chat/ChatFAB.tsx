import React from "react";
import { TouchableOpacity, StyleSheet, View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

// Possible room context types
export type RoomContext = "job" | "certificate";

interface ChatFABProps {
  context: RoomContext;
  contextId: string;
  unreadCount?: number;
  visible?: boolean;
}

export default function ChatFAB({ 
  context, 
  contextId, 
  unreadCount = 0, 
  visible = true 
}: ChatFABProps) {
  if (!visible) return null;

  // Helper to build deterministic room IDs
  const buildRoomId = (context: RoomContext, contextId: string): string => {
    return `${context}_${contextId}`;
  };

  const handlePress = () => {
    const roomId = buildRoomId(context, contextId);
    router.push(`/chat/${roomId}`);
  };

  return (
    <TouchableOpacity 
      style={styles.fab} 
      onPress={handlePress} 
      activeOpacity={0.8}
    >
      <View style={styles.fabContent}>
        <Ionicons name="chatbubble-ellipses" size={24} color="#FFFFFF" />
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#10B981", // Green color as specified in the task
    justifyContent: "center",
    alignItems: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
  },
  fabContent: {
    justifyContent: "center",
    alignItems: "center",
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: "#EF4444",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 6,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "bold",
  },
});
