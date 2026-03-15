import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface MessageBubbleProps {
  message: {
    id: string;
    content: string;
    created_at: string;
    sender: {
      full_name: string | null;
      avatar_url: string | null;
    };
  };
  isOwn: boolean;
}

export default function MessageBubble({ message, isOwn }: MessageBubbleProps) {
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <View style={[styles.container, isOwn ? styles.ownContainer : styles.otherContainer]}>
      {!isOwn && (
        <View style={styles.avatarContainer}>
          {message.sender.avatar_url ? (
            <Image source={{ uri: message.sender.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person-circle" size={32} color="#9CA3AF" />
            </View>
          )}
        </View>
      )}
      
      <View style={[styles.bubble, isOwn ? styles.ownBubble : styles.otherBubble]}>
        {!isOwn && (
          <Text style={styles.senderName}>
            {message.sender.full_name || "Unknown User"}
          </Text>
        )}
        <Text style={[styles.messageText, isOwn ? styles.ownText : styles.otherText]}>
          {message.content}
        </Text>
        <Text style={[styles.timeText, isOwn ? styles.ownTime : styles.otherTime]}>
          {formatTime(message.created_at)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    marginVertical: 4,
    paddingHorizontal: 16,
  },
  ownContainer: {
    justifyContent: "flex-end",
  },
  otherContainer: {
    justifyContent: "flex-start",
  },
  avatarContainer: {
    marginRight: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1F2937",
    justifyContent: "center",
    alignItems: "center",
  },
  bubble: {
    maxWidth: "75%",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  ownBubble: {
    backgroundColor: "#6C63FF",
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: "#1F2937",
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 20,
  },
  ownText: {
    color: "#FFFFFF",
  },
  otherText: {
    color: "#E5E7EB",
  },
  senderName: {
    fontSize: 12,
    color: "#9CA3AF",
    marginBottom: 4,
    fontWeight: "500",
  },
  timeText: {
    fontSize: 11,
    marginTop: 4,
    opacity: 0.7,
  },
  ownTime: {
    color: "#D1D5DB",
    textAlign: "right",
  },
  otherTime: {
    color: "#9CA3AF",
    textAlign: "left",
  },
});