import React, { useState, useRef } from "react";
import { View, TextInput, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface ChatInputProps {
  onSend: (content: string) => void;
  sending: boolean;
}

export default function ChatInput({ onSend, sending }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const inputRef = useRef<TextInput>(null);

  const handleSend = () => {
    if (message.trim() && !sending) {
      onSend(message);
      setMessage("");
      inputRef.current?.blur();
    }
  };

  const handleKeyPress = (e: any) => {
    if (e.nativeEvent.key === "Enter" && !e.nativeEvent.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.inputContainer}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          onKeyPress={handleKeyPress}
          placeholder="Type a message..."
          placeholderTextColor="#9CA3AF"
          multiline
          maxLength={500}
          editable={!sending}
        />
        <TouchableOpacity
          style={[styles.sendButton, sending && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={sending || !message.trim()}
        >
          <Ionicons
            name="send"
            size={20}
            color={message.trim() && !sending ? "#6C63FF" : "#4B5563"}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#0F172A",
    borderTopWidth: 1,
    borderTopColor: "#1F2937",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: "#111827",
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#374151",
  },
  input: {
    flex: 1,
    color: "#E5E7EB",
    fontSize: 16,
    lineHeight: 20,
    maxHeight: 100,
    padding: 0,
  },
  sendButton: {
    marginLeft: 8,
    padding: 8,
    borderRadius: 20,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});