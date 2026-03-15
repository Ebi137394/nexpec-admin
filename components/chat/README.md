# ChatFAB Component

A floating action button component for opening context-based chat conversations in your React Native application.

## Features

- ✅ Context-based chat navigation (job, certificate)
- ✅ Unread message count badge
- ✅ Green color theme as specified
- ✅ Positioned at bottom-right of screen
- ✅ Smooth navigation to chat screen
- ✅ TypeScript support

## Usage

### Basic Usage

```tsx
import ChatFAB from '@/components/chat/ChatFAB';

// In your component
<ChatFAB 
  context="job" 
  contextId="abc-123" 
  unreadCount={3} 
/>
```

### Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `context` | `RoomContext` | ✅ | - | The context type: "job" or "certificate" |
| `contextId` | `string` | ✅ | - | The ID of the job or certificate |
| `unreadCount` | `number` | ❌ | 0 | Number of unread messages to display |
| `visible` | `boolean` | ❌ | true | Whether the FAB should be visible |

### Context Types

```tsx
type RoomContext = "job" | "certificate";
```

- **job**: For job-related conversations
- **certificate**: For certificate-related conversations

### Example Implementation

```tsx
// app/(tabs)/job-details.tsx
import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import ChatFAB from "@/components/chat/ChatFAB";

export default function JobDetailsScreen() {
  const jobId = "abc-123"; // Replace with your actual job data

  return (
    <View style={styles.container}>
      <ScrollView>
        <Text style={styles.title}>Job Details</Text>
        {/* Your existing job detail UI */}
      </ScrollView>

      {/* Green FAB — opens chat for this job */}
      <ChatFAB context="job" contextId={jobId} unreadCount={3} />
    </View>
  );
}
```

## Navigation

The ChatFAB navigates to `/chat/${roomId}` where `roomId` is constructed as:
```
${context}_${contextId}
```

For example:
- Job with ID "abc-123" → `job_abc-123`
- Certificate with ID "cert-456" → `certificate_cert-456`

## Chat Screen

The component works with the chat screen at `app/chat/[roomId].tsx` which:
- Parses the room ID to extract context and context ID
- Uses the `useChat` hook for job-based messaging
- Displays appropriate headers based on context
- Supports real-time messaging

## Styling

- **Background Color**: `#10B981` (Green)
- **Position**: Absolute, bottom-right
- **Size**: 56x56 pixels
- **Badge**: Red with white text for unread count
- **Shadow**: Subtle elevation for depth

## Integration

1. Import the component: `import ChatFAB from '@/components/chat/ChatFAB';`
2. Add it to your screen with appropriate props
3. Ensure your chat screen at `app/chat/[roomId].tsx` exists
4. Make sure the `useChat` hook is properly configured

## Notes

- The FAB is positioned absolutely, so ensure your screen has proper padding
- The component uses Expo Router for navigation
- Unread count badge only appears when count > 0
- The component is hidden when `visible` prop is false