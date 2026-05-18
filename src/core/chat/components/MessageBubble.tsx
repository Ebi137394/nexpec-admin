import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { Message } from '@/src/types/chat';

interface MessageBubbleProps {
  message: Message;
  isOwnMessage: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isOwnMessage,
  style,
  textStyle,
}) => {
  const isPending = message._isPending;
  const isFailed = message._isFailed;

  return (
    <View
      style={[
        styles.container,
        isOwnMessage ? styles.ownMessage : styles.otherMessage,
        style,
      ]}
    >
      <View
        style={[
          styles.bubble,
          isOwnMessage ? styles.ownBubble : styles.otherBubble,
          isFailed && styles.failedBubble,
        ]}
      >
        <Text
          style={[
            styles.text,
            isOwnMessage ? styles.ownText : styles.otherText,
            textStyle,
          ]}
        >
          {message.content}
        </Text>
        
        {/* Status indicators */}
        <View style={styles.statusContainer}>
          {isPending && (
            <Text style={styles.pendingText}>⏳</Text>
          )}
          {isFailed && (
            <Text style={styles.failedText}>⚠️ Retry</Text>
          )}
          {!isPending && !isFailed && (
            <Text style={styles.timeText}>
              {new Date(message.created_at).toLocaleTimeString()}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  ownMessage: {
    alignItems: 'flex-end',
  },
  otherMessage: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    position: 'relative',
  },
  ownBubble: {
    backgroundColor: '#007AFF',
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: '#E5E5EA',
    borderBottomLeftRadius: 4,
  },
  failedBubble: {
    borderColor: '#FF3B30',
    borderWidth: 1,
    backgroundColor: '#FFE5E5',
  },
  text: {
    fontSize: 16,
    lineHeight: 20,
  },
  ownText: {
    color: 'white',
  },
  otherText: {
    color: '#000000',
  },
  statusContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 4,
  },
  pendingText: {
    fontSize: 12,
    color: '#8E8E93',
  },
  failedText: {
    fontSize: 12,
    color: '#FF3B30',
    fontWeight: 'bold',
  },
  timeText: {
    fontSize: 10,
    color: '#8E8E93',
  },
});