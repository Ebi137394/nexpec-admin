# Chat Components

This directory contains the UI components for the headless chat engine implementation.

## Components

### MessageBubble
A customizable message bubble component that displays chat messages with status indicators.

**Features:**
- Own vs other message styling
- Pending message indicators (⏳)
- Failed message indicators with retry capability (⚠️)
- Timestamp display
- Failed message styling with red border

**Props:**
```typescript
interface MessageBubbleProps {
  message: Message;           // The message object
  isOwnMessage: boolean;      // Whether this is the current user's message
  style?: ViewStyle;          // Custom container style
  textStyle?: TextStyle;      // Custom text style
}
```

### ChatInput
A text input component for composing and sending messages.

**Features:**
- Multiline text input
- Send button with state management
- Disabled state handling
- Enter key to send (without shift)
- Character limit (1000 chars)
- Loading state during message sending

**Props:**
```typescript
interface ChatInputProps {
  onSendMessage: (content: string) => Promise<void>;
  disabled?: boolean;         // Disable input
  placeholder?: string;       // Input placeholder text
  style?: ViewStyle;          // Custom container style
}
```

## Usage Example

```typescript
import { MessageBubble, ChatInput } from '../components/chat';
import { useChatEngine } from '../src/hooks/useChatEngine';

function ChatScreen({ conversationId, currentUserId }) {
  const {
    messages,
    sendMessage,
    pendingCount,
    isLoading
  } = useChatEngine({
    conversationId,
    currentUserId,
    enableRealtime: true
  });

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={messages}
        renderItem={({ item }) => (
          <MessageBubble
            message={item}
            isOwnMessage={item.sender_id === currentUserId}
          />
        )}
        inverted
      />
      
      <ChatInput
        onSendMessage={sendMessage}
        disabled={isLoading}
        placeholder="Type a message..."
      />
    </View>
  );
}
```

## Integration with useChatEngine

These components are designed to work seamlessly with the `useChatEngine` hook:

- **MessageBubble** uses the `_isPending` and `_isFailed` flags to show status indicators
- **ChatInput** handles the async `sendMessage` function with proper loading states
- Both components respect the disabled state when the chat engine is loading

## Styling

The components use a clean, modern design with:
- iOS-style message bubbles
- Proper spacing and typography
- Status indicators for message states
- Disabled state styling
- Responsive layout for different message lengths