import React, { useState, useRef } from 'react';
import { View, TextInput, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ChatInputProps {
  onSendMessage: (content: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  style?: ViewStyle;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  disabled = false,
  placeholder = 'Type a message...',
  style,
}) => {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const handleSend = async () => {
    if (!message.trim() || disabled || isSending) return;

    setIsSending(true);
    try {
      await onSendMessage(message.trim());
      setMessage('');
      inputRef.current?.blur();
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyPress = (event: any) => {
    if (event.nativeEvent.key === 'Enter' && !event.nativeEvent.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <View style={[styles.container, style]}>
      <View style={styles.inputContainer}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          placeholder={placeholder}
          placeholderTextColor="#8E8E93"
          multiline
          maxLength={1000}
          editable={!disabled && !isSending}
          onKeyPress={handleKeyPress}
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            (disabled || isSending || !message.trim()) && styles.sendButtonDisabled,
          ]}
          onPress={handleSend}
          disabled={disabled || isSending || !message.trim()}
        >
          <Ionicons
            name="send"
            size={24}
            color={disabled || isSending || !message.trim() ? '#C7C7CC' : '#007AFF'}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#F2F2F7',
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 44,
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 20,
    color: '#000000',
    maxHeight: 100,
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