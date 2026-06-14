/**
 * ContextChat — Contextual Messaging & Guidance Engine
 *
 * Provides real-time, context-aware assistance during inspections:
 * - Form field guidance
 * - Safety reminders
 * - Equipment-specific tips
 * - Procedural checklists
 * - Smart suggestions based on current form state
 *
 * Works offline-first with SQLite storage for message history and preferences.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SQLite from 'expo-sqlite';

// ─── Types ───────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  context?: string; // e.g., 'form_field', 'safety_reminder', 'equipment_tip'
  metadata?: {
    fieldKey?: string;
    equipmentType?: string;
    action?: string;
    suggestions?: string[];
    location?: string;
  };
}

interface ContextChatProps {
  isVisible: boolean;
  onClose: () => void;
  currentFormState?: Record<string, any>;
  currentFieldKey?: string;
  equipmentType?: string;
  location?: string;
}

interface MessageSuggestion {
  id: string;
  text: string;
  category: 'form' | 'safety' | 'equipment' | 'procedural';
  action?: () => void;
}

// ─── Database Schema ─────────────────────────────────────────────────

const DB_NAME = 'nexpec_inspector.db';

const ensureChatTables = async (db: SQLite.SQLiteDatabase): Promise<void> => {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      context TEXT,
      metadata TEXT DEFAULT '{}',
      draftId TEXT,
      readAt TEXT
    );
  `);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS chat_preferences (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
};

// ─── Core Logic ──────────────────────────────────────────────────────

/**
 * Generate context-aware suggestions based on current form state
 */
const generateContextSuggestions = (
  formState: Record<string, any> = {},
  fieldKey?: string,
  equipmentType?: string
): MessageSuggestion[] => {
  const suggestions: MessageSuggestion[] = [];

  // Form field guidance
  if (fieldKey) {
    const guidanceMap: Record<string, string> = {
      equipmentType: 'Select the specific type of equipment being inspected.',
      nominalDiameter: 'Enter the nominal pipe diameter in inches or mm.',
      wallThickness: 'Measure the actual wall thickness at multiple locations.',
      operatingTemperature: 'Record the normal operating temperature range.',
      operatingPressure: 'Enter the maximum allowable working pressure.',
      surfaceCondition: 'Describe the surface condition (e.g., pitted, smooth).',
      coatingType: 'Specify the type of protective coating applied.',
      accessMethod: 'Describe how you accessed the inspection area.',
      scaffoldingRequired: 'Indicate if scaffolding was required for access.',
      insulationRemoval: 'Note if insulation was removed for inspection.',
      previousFindings: 'Document any previous inspection findings.',
      riskLevel: 'Assess the risk level based on findings and location.',
      notes: 'Add any additional observations or comments.',
    };

    if (guidanceMap[fieldKey]) {
      suggestions.push({
        id: `guidance_${fieldKey}`,
        text: guidanceMap[fieldKey],
        category: 'form',
      });
    }
  }

  // Equipment-specific tips
  if (equipmentType) {
    const equipmentTips: Record<string, string> = {
      'pressure_vessel': 'Check for corrosion at weld seams and support locations.',
      'pipeline': 'Inspect for external corrosion and coating damage.',
      'storage_tank': 'Focus on bottom plates and shell-to-bottom junctions.',
      'heat_exchanger': 'Pay attention to tube sheets and baffle locations.',
      'boiler': 'Inspect water level controls and safety valves.',
      'reactor': 'Check for thermal fatigue and stress corrosion cracking.',
    };

    if (equipmentTips[equipmentType]) {
      suggestions.push({
        id: `tip_${equipmentType}`,
        text: equipmentTips[equipmentType],
        category: 'equipment',
      });
    }
  }

  // Safety reminders (contextual)
  const hasHazardousConditions = formState.processFluid === 'hazardous' ||
                                 formState.operatingPressure > 100 ||
                                 formState.operatingTemperature > 200;

  if (hasHazardousConditions) {
    suggestions.push({
      id: 'safety_hazardous',
      text: '⚠️ High-risk conditions detected. Ensure proper PPE and permits.',
      category: 'safety',
    });
  }

  // Procedural suggestions
  const requiredFields = ['equipmentType', 'nominalDiameter', 'wallThickness'];
  const missingFields = requiredFields.filter(field => !formState[field]);

  if (missingFields.length > 0) {
    suggestions.push({
      id: 'procedural_missing',
      text: `Complete required fields: ${missingFields.join(', ')}`,
      category: 'procedural',
    });
  }

  // General tips
  suggestions.push({
    id: 'general_tip',
    text: 'Take multiple photos from different angles for better documentation.',
    category: 'equipment',
  });

  return suggestions;
};

/**
 * Generate AI-like responses based on context
 */
const generateResponse = (
  userInput: string,
  formState: Record<string, any> = {},
  fieldKey?: string,
  equipmentType?: string
): string => {
  const lowerInput = userInput.toLowerCase();

  // Form field help
  if (lowerInput.includes('help') || lowerInput.includes('how to')) {
    if (fieldKey) {
      return `For the ${fieldKey} field: ${getFormFieldHelp(fieldKey)}`;
    }
    return 'I can help with specific form fields. Which field do you need assistance with?';
  }

  // Equipment-specific guidance
  if (lowerInput.includes('equipment') || lowerInput.includes('inspect')) {
    if (equipmentType) {
      return getEquipmentGuidance(equipmentType);
    }
    return 'Please specify the equipment type for specific guidance.';
  }

  // Safety questions
  if (lowerInput.includes('safety') || lowerInput.includes('ppe') || lowerInput.includes('permit')) {
    return 'Always follow site safety procedures. Use appropriate PPE, obtain necessary permits, and follow lockout/tagout procedures.';
  }

  // Procedural questions
  if (lowerInput.includes('procedure') || lowerInput.includes('step') || lowerInput.includes('checklist')) {
    return 'Follow the standard inspection procedure: 1) Preparation 2) Visual inspection 3) Measurements 4) Documentation 5) Review.';
  }

  // Default response
  return "I'm here to help with inspection guidance. You can ask about form fields, equipment types, safety procedures, or specific inspection questions.";
};

const getFormFieldHelp = (fieldKey: string): string => {
  const helpText: Record<string, string> = {
    equipmentType: 'Select from common equipment types like pressure vessel, pipeline, storage tank, etc.',
    nominalDiameter: 'Use the manufacturer\'s specifications or measure the outer diameter. Common sizes: 2", 4", 6", 8", 10", 12".',
    wallThickness: 'Use ultrasonic thickness gauge. Measure at multiple locations and record the minimum thickness.',
    operatingTemperature: 'This is the normal operating temperature, not the design temperature. Use °F or °C.',
    operatingPressure: 'This is the normal operating pressure, not the design pressure. Use PSI or kPa.',
    surfaceCondition: 'Describe the condition: smooth, pitted, corroded, scaled, etc.',
    coatingType: 'Examples: epoxy, polyurethane, zinc-rich primer, etc.',
    accessMethod: 'How did you access the inspection area? Scaffold, ladder, platform, etc.',
    scaffoldingRequired: 'Yes if scaffolding was needed, No if not required.',
    insulationRemoval: 'Yes if insulation was removed for inspection, No if left in place.',
    previousFindings: 'Document any previous inspection results, repairs, or issues.',
    riskLevel: 'Low, Medium, or High based on findings and location.',
    notes: 'Any additional observations, concerns, or recommendations.',
  };

  return helpText[fieldKey] || 'Help not available for this field.';
};

const getEquipmentGuidance = (equipmentType: string): string => {
  const guidance: Record<string, string> = {
    'pressure_vessel': 'Focus on weld seams, support locations, and areas with stress concentration. Check for bulging, cracking, or excessive corrosion.',
    'pipeline': 'Inspect for external corrosion, coating damage, and support conditions. Pay attention to elbows, tees, and valves.',
    'storage_tank': 'Check bottom plates, shell-to-bottom junctions, and roof supports. Look for settlement and foundation issues.',
    'heat_exchanger': 'Inspect tube sheets, baffle locations, and shell-side conditions. Check for fouling and corrosion.',
    'boiler': 'Focus on water level controls, safety valves, and pressure relief devices. Check for scale and corrosion.',
    'reactor': 'Look for thermal fatigue, stress corrosion cracking, and erosion in high-velocity areas.',
  };

  return guidance[equipmentType] || 'General inspection guidance: follow standard procedures and document all findings.';
};

// ─── Database Operations ─────────────────────────────────────────────

const saveMessage = async (
  db: SQLite.SQLiteDatabase,
  message: Omit<ChatMessage, 'id' | 'timestamp'>
): Promise<string> => {
  const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const timestamp = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO chat_messages (id, role, content, timestamp, context, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      message.role,
      message.content,
      timestamp,
      message.context || null,
      JSON.stringify(message.metadata || {}),
    ]
  );

  return id;
};

const getRecentMessages = async (
  db: SQLite.SQLiteDatabase,
  limit: number = 50
): Promise<ChatMessage[]> => {
  const rows = await db.getAllAsync<ChatMessage>(
    `SELECT * FROM chat_messages
     ORDER BY timestamp DESC
     LIMIT ?`,
    [limit]
  );

  return rows.reverse(); // Oldest first
};

// ─── Component ───────────────────────────────────────────────────────

const ContextChat: React.FC<ContextChatProps> = ({
  isVisible,
  onClose,
  currentFormState,
  currentFieldKey,
  equipmentType,
  location,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [suggestions, setSuggestions] = useState<MessageSuggestion[]>([]);
  const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  // Initialize database
  useEffect(() => {
    const initDB = async () => {
      try {
        const database = await SQLite.openDatabaseAsync(DB_NAME);
        await ensureChatTables(database);
        setDb(database);

        // Load recent messages
        const recentMessages = await getRecentMessages(database);
        setMessages(recentMessages);

        // Generate initial suggestions
        const initialSuggestions = generateContextSuggestions(
          currentFormState,
          currentFieldKey,
          equipmentType
        );
        setSuggestions(initialSuggestions);
      } catch (error) {
        console.error('Failed to initialize chat database:', error);
      }
    };

    if (isVisible) {
      initDB();
    }
  }, [isVisible, currentFormState, currentFieldKey, equipmentType]);

  // Update suggestions when context changes
  useEffect(() => {
    if (isVisible && currentFormState) {
      const newSuggestions = generateContextSuggestions(
        currentFormState,
        currentFieldKey,
        equipmentType
      );
      setSuggestions(newSuggestions);
    }
  }, [currentFormState, currentFieldKey, equipmentType, isVisible]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (flatListRef.current && messages.length > 0) {
      flatListRef.current.scrollToEnd({ animated: true });
    }
  }, [messages]);

  // Guard the simulated-reply timer so a response landing after unmount doesn't
  // setState on an unmounted component (warning + wasted work).
  const isMountedRef = useRef(true);
  const replyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (replyTimerRef.current) clearTimeout(replyTimerRef.current);
    };
  }, []);

  const sendMessage = useCallback(async () => {
    if (!inputText.trim() || !db) return;

    const userMessage: Omit<ChatMessage, 'id' | 'timestamp'> = {
      role: 'user',
      content: inputText.trim(),
      context: currentFieldKey || 'general',
      metadata: {
        fieldKey: currentFieldKey,
        equipmentType,
        location,
      },
    };

    try {
      const messageId = await saveMessage(db, userMessage);
      const newUserMessage: ChatMessage = {
        ...userMessage,
        id: messageId,
        timestamp: new Date().toISOString(),
      };

      setMessages(prev => [...prev, newUserMessage]);
      setInputText('');
      setIsTyping(true);

      // Generate and save response
      replyTimerRef.current = setTimeout(async () => {
        const responseText = generateResponse(
          inputText,
          currentFormState,
          currentFieldKey,
          equipmentType
        );

        const assistantMessage: Omit<ChatMessage, 'id' | 'timestamp'> = {
          role: 'assistant',
          content: responseText,
          context: 'response',
          metadata: {
            fieldKey: currentFieldKey,
            equipmentType,
            action: 'response',
          },
        };

        const responseId = await saveMessage(db, assistantMessage);
        const newAssistantMessage: ChatMessage = {
          ...assistantMessage,
          id: responseId,
          timestamp: new Date().toISOString(),
        };

        if (!isMountedRef.current) return;
        setMessages(prev => [...prev, newAssistantMessage]);
        setIsTyping(false);
      }, 1000);
    } catch (error) {
      console.error('Failed to send message:', error);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    }
  }, [inputText, db, currentFieldKey, equipmentType, location, currentFormState]);

  const handleSuggestionPress = useCallback((suggestion: MessageSuggestion) => {
    setInputText(suggestion.text);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => (
    <View style={[
      styles.messageContainer,
      item.role === 'user' ? styles.userMessage : styles.assistantMessage
    ]}>
      <View style={[
        styles.messageBubble,
        item.role === 'user' ? styles.userBubble : styles.assistantBubble
      ]}>
        {item.role === 'assistant' && (
          <View style={styles.assistantHeader}>
            <Ionicons name="sparkles" size={16} color="#666" />
            <Text style={styles.assistantLabel}>NEXPEC Assistant</Text>
          </View>
        )}
        <Text style={styles.messageText}>{item.content}</Text>
        <Text style={styles.messageTime}>
          {new Date(item.timestamp).toLocaleTimeString()}
        </Text>
      </View>
    </View>
  ), []);

  const renderSuggestion = useCallback(({ item }: { item: MessageSuggestion }) => (
    <TouchableOpacity
      style={[
        styles.suggestionButton,
        item.category === 'safety' && styles.safetySuggestion,
      ]}
      onPress={() => handleSuggestionPress(item)}
      activeOpacity={0.7}
    >
      <Text style={[
        styles.suggestionText,
        item.category === 'safety' && styles.safetySuggestionText,
      ]}>
        {item.text}
      </Text>
    </TouchableOpacity>
  ), [handleSuggestionPress]);

  if (!isVisible) return null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Inspection Assistant</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={24} color="#666" />
        </TouchableOpacity>
      </View>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <View style={styles.suggestionsContainer}>
          <Text style={styles.suggestionsTitle}>Quick Suggestions</Text>
          <FlatList
            data={suggestions}
            renderItem={renderSuggestion}
            keyExtractor={(item) => item.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.suggestionsList}
          />
        </View>
      )}

      {/* Messages */}
      <View style={styles.messagesContainer}>
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          style={styles.messagesList}
          contentContainerStyle={styles.messagesContent}
        />

        {isTyping && (
          <View style={styles.typingIndicator}>
            <Text style={styles.typingText}>NEXPEC Assistant is typing</Text>
            <View style={styles.typingDots}>
              <View style={styles.dot} />
              <View style={styles.dot} />
              <View style={styles.dot} />
            </View>
          </View>
        )}
      </View>

      {/* Input */}
      <View style={styles.inputContainer}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Ask about inspection guidance..."
          placeholderTextColor="#999"
          multiline
          maxLength={500}
          returnKeyType="send"
          onSubmitEditing={sendMessage}
        />
        <TouchableOpacity
          style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
          onPress={sendMessage}
          disabled={!inputText.trim()}
        >
          <Ionicons name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#fff',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  closeButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
  },
  suggestionsContainer: {
    padding: 16,
    backgroundColor: '#f8f9fa',
  },
  suggestionsTitle: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
    fontWeight: '500',
  },
  suggestionsList: {
    maxHeight: 120,
  },
  suggestionButton: {
    backgroundColor: '#e3f2fd',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    marginRight: 8,
    minWidth: 120,
  },
  safetySuggestion: {
    backgroundColor: '#fff3e0',
    borderColor: '#ffb74d',
    borderWidth: 1,
  },
  suggestionText: {
    fontSize: 12,
    color: '#1976d2',
    lineHeight: 16,
  },
  safetySuggestionText: {
    color: '#f57c00',
    fontWeight: '600',
  },
  messagesContainer: {
    flex: 1,
    padding: 16,
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    paddingBottom: 20,
  },
  messageContainer: {
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  userMessage: {
    alignItems: 'flex-end',
  },
  assistantMessage: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  userBubble: {
    backgroundColor: '#1976d2',
  },
  assistantBubble: {
    backgroundColor: '#f5f5f5',
  },
  assistantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  assistantLabel: {
    fontSize: 10,
    color: '#666',
    marginLeft: 6,
    fontWeight: '600',
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#333',
  },
  messageTime: {
    fontSize: 10,
    color: '#999',
    marginTop: 6,
    textAlign: 'right',
  },
  typingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  typingText: {
    fontSize: 12,
    color: '#666',
    marginRight: 8,
  },
  typingDots: {
    flexDirection: 'row',
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#999',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    maxHeight: 100,
    backgroundColor: '#fafafa',
    marginRight: 12,
  },
  sendButton: {
    backgroundColor: '#1976d2',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#ccc',
  },
});

export default ContextChat;
export type { ContextChatProps, ChatMessage, MessageSuggestion };
