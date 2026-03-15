// ─── Chat Service Usage Examples ────────────────────────────────────────────

import { 
  fetchMessages, 
  sendMessage, 
  fetchOlderMessages
} from "./chatService";
import { buildRoomId } from "../types/chat";
import type { RoomContext } from "../types/chat";

// Example usage functions demonstrating how to use the chat service

/**
 * Example: Fetch messages for a job room
 */
export async function exampleFetchJobMessages(jobId: string) {
  const roomId = buildRoomId("job", jobId);
  const messages = await fetchMessages(roomId, 50);
  
  console.log(`Fetched ${messages.length} messages for job ${jobId}`);
  return messages;
}

/**
 * Example: Fetch messages for a certificate room
 */
export async function exampleFetchCertificateMessages(certId: string) {
  const roomId = buildRoomId("certificate", certId);
  const messages = await fetchMessages(roomId, 30);
  
  console.log(`Fetched ${messages.length} messages for certificate ${certId}`);
  return messages;
}

/**
 * Example: Send a message to a job room
 */
export async function exampleSendMessage(jobId: string, content: string) {
  const roomId = buildRoomId("job", jobId);
  const message = await sendMessage(roomId, content);
  
  if (message) {
    console.log(`Message sent successfully: ${message.content}`);
  } else {
    console.log("Failed to send message");
  }
  
  return message;
}

/**
 * Example: Load older messages for pagination
 */
export async function exampleLoadOlderMessages(jobId: string, beforeTimestamp: string) {
  const roomId = buildRoomId("job", jobId);
  const olderMessages = await fetchOlderMessages(roomId, beforeTimestamp, 20);
  
  console.log(`Loaded ${olderMessages.length} older messages`);
  return olderMessages;
}

/**
 * Example: Complete chat workflow
 */
export async function exampleCompleteChatWorkflow(jobId: string) {
  // 1. Fetch initial messages
  const initialMessages = await exampleFetchJobMessages(jobId);
  
  // 2. Send a new message
  const newMessage = await exampleSendMessage(jobId, "Hello from the chat!");
  
  // 3. If we need more history, load older messages
  if (initialMessages.length > 0) {
    const oldestMessage = initialMessages[0];
    const olderMessages = await exampleLoadOlderMessages(
      jobId, 
      oldestMessage.created_at
    );
    
    console.log(`Total messages loaded: ${initialMessages.length + olderMessages.length}`);
  }
  
  return { initialMessages, newMessage };
}