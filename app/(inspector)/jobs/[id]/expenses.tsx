import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList,
  Image, ActivityIndicator, Alert, KeyboardAvoidingView, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
// #QA — expenses route through the offline outbox (idempotent on the client PK).
import { enqueueExpenseAdd, newClientId } from '@/lib/offline';

const COLORS = {
  background: '#020420', card: '#1e293b', primary: '#7C3AED',
  text: '#FFF', textSec: '#94A3B8', border: '#334155',
  success: '#10B981', error: '#EF4444'
};

export default function ExpensesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); // Job ID
  const router = useRouter();
  const { user } = useAuth();

  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);

  useEffect(() => {
    fetchExpenses();
  }, [id]);

  const fetchExpenses = async () => {
    const { data } = await supabase
      .from('job_expenses')
      .select('*')
      .eq('job_id', id)
      .order('created_at', { ascending: false });

    if (data) setExpenses(data);
    setLoading(false);
  };

  const pickReceipt = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
      base64: true,
    });
    if (!result.canceled) setReceipt(result.assets[0].uri);
  };

  const handleAddExpense = async () => {
    if (!desc || !amount) {
      return Alert.alert('Missing Info', 'Please enter a description and amount.');
    }
    setSubmitting(true);

    try {
      const expenseId = newClientId();
      let receiptUrl: string | null = null;
      let storagePath: string | undefined;

      // Compute the receipt's deterministic storage path + public URL up front
      // (getPublicUrl is a local string build — works offline). The outbox handler
      // uploads the file to that path on drain.
      if (receipt) {
        storagePath = `${user?.id}/${Date.now()}.jpg`;
        receiptUrl = supabase.storage.from('receipts').getPublicUrl(storagePath).data.publicUrl;
      }

      // Route through the outbox — offline-safe, idempotent on the client PK `id`.
      await enqueueExpenseAdd({
        expense: {
          id: expenseId,
          job_id: id,
          inspector_id: user?.id,
          description: desc,
          amount: parseFloat(amount),
          status: 'pending',
          receipt_url: receiptUrl,
        },
        bucket: receipt ? 'receipts' : undefined,
        storagePath,
        localFilePath: receipt ?? undefined,
      });

      // Optimistic local add so the list reflects it immediately (offline too).
      setExpenses((prev) => [
        {
          id: expenseId,
          job_id: id,
          description: desc,
          amount: parseFloat(amount),
          status: 'pending',
          receipt_url: receiptUrl,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);

      setDesc('');
      setAmount('');
      setReceipt(null);
      Alert.alert('Success', 'Expense added.');

    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const renderItem = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={{flex: 1}}>
        <Text style={styles.itemTitle}>{item.description}</Text>
        <Text style={styles.itemDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
      </View>
      <View style={{alignItems: 'flex-end'}}>
        <Text style={styles.itemAmount}>${item.amount}</Text>
        <Text style={[styles.itemStatus, {color: item.status === 'approved' ? COLORS.success : COLORS.textSec}]}>
          {item.status.toUpperCase()}
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex: 1}}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color="#FFF" /></TouchableOpacity>
          <Text style={styles.headerTitle}>Job Expenses</Text>
          <View style={{width: 24}}/>
        </View>

        {/* Expenses List */}
        <FlatList
          data={expenses}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={!loading ? <Text style={styles.emptyText}>No expenses added yet.</Text> : null}
        />

        {/* Add Expense Form */}
        <View style={styles.formContainer}>
          <Text style={styles.formTitle}>Add New Expense</Text>

          <View style={styles.row}>
            <TextInput
              style={[styles.input, {flex: 2}]}
              placeholder="Description (e.g. Travel)"
              placeholderTextColor={COLORS.textSec}
              value={desc} onChangeText={setDesc}
            />
            <TextInput
              style={[styles.input, {flex: 1}]}
              placeholder="$$$"
              keyboardType="numeric"
              placeholderTextColor={COLORS.textSec}
              value={amount} onChangeText={setAmount}
            />
          </View>

          <View style={styles.row}>
            <TouchableOpacity style={styles.receiptBtn} onPress={pickReceipt}>
              <Ionicons name={receipt ? "checkmark-circle" : "camera-outline"} size={20} color={receipt ? COLORS.success : "#FFF"} />
              <Text style={{color: '#FFF', marginLeft: 8}}>{receipt ? 'Receipt Selected' : 'Add Receipt'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.submitBtn} onPress={handleAddExpense} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#FFF"/> : <Ionicons name="add" size={24} color="#FFF" />}
            </TouchableOpacity>
          </View>
        </View>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  listContent: { padding: 16, paddingBottom: 200 },

  card: { flexDirection: 'row', backgroundColor: COLORS.card, padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border },
  itemTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  itemDate: { color: COLORS.textSec, fontSize: 12, marginTop: 4 },
  itemAmount: { color: COLORS.success, fontSize: 16, fontWeight: 'bold' },
  itemStatus: { fontSize: 10, marginTop: 4 },

  emptyText: { color: COLORS.textSec, textAlign: 'center', marginTop: 40 },

  formContainer: { backgroundColor: '#0f172a', padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderTopColor: COLORS.primary },
  formTitle: { color: '#FFF', fontWeight: 'bold', marginBottom: 16 },
  row: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  input: { backgroundColor: COLORS.card, color: '#FFF', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border },

  receiptBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.border, borderRadius: 8, padding: 12 },
  submitBtn: { width: 50, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', borderRadius: 8 }
});
