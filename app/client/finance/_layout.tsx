// app/client/finance/_layout.tsx
import { Stack } from "expo-router";

export default function FinanceLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: {
          backgroundColor: '#020617',
        },
        headerTintColor: '#F1F5F9',
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: 18,
        },
        contentStyle: { backgroundColor: '#020617' },
      }}
    >
      <Stack.Screen 
        name="index" 
        options={{ 
          title: 'Financial Hub',
          headerTitleAlign: 'center'
        }} 
      />
      <Stack.Screen 
        name="budget" 
        options={{ 
          title: 'Budget Overview',
          headerTitleAlign: 'center'
        }} 
      />
      <Stack.Screen 
        name="invoices" 
        options={{ 
          title: 'Invoice Approver',
          headerTitleAlign: 'center'
        }} 
      />
      <Stack.Screen 
        name="compliance" 
        options={{ 
          title: 'Compliance Vault',
          headerTitleAlign: 'center'
        }} 
      />
    </Stack>
  );
}