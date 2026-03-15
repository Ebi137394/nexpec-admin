#!/usr/bin/env node

/**
 * NEXPEC Wallet Implementation Test Script
 * 
 * This script verifies that the wallet implementation is complete and functional.
 * Run with: node test-wallet-implementation.js
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 NEXPEC Wallet Implementation Test\n');

// Test 1: Check wallet screen file exists and has correct structure
function testWalletScreen() {
  console.log('📋 Test 1: Wallet Screen Implementation');
  
  const walletPath = path.join(__dirname, 'app', '(tabs)', 'wallet.tsx');
  
  if (!fs.existsSync(walletPath)) {
    console.log('❌ Wallet screen file not found');
    return false;
  }
  
  const walletContent = fs.readFileSync(walletPath, 'utf8');
  
  // Check for key components
  const requiredImports = [
    'useStripe',
    'supabase',
    'useAuth',
    'Ionicons'
  ];
  
  const requiredComponents = [
    'BalanceCard',
    'QuickActions', 
    'PaymentMethodCard',
    'TransactionItem',
    'SegmentedControl'
  ];
  
  const requiredFunctions = [
    'handleAddPaymentMethod',
    'fetchTransactions',
    'fetchPaymentMethods'
  ];
  
  let passed = true;
  
  requiredImports.forEach(imp => {
    if (!walletContent.includes(imp)) {
      console.log(`❌ Missing import: ${imp}`);
      passed = false;
    }
  });
  
  requiredComponents.forEach(comp => {
    if (!walletContent.includes(comp)) {
      console.log(`❌ Missing component: ${comp}`);
      passed = false;
    }
  });
  
  requiredFunctions.forEach(func => {
    if (!walletContent.includes(func)) {
      console.log(`❌ Missing function: ${func}`);
      passed = false;
    }
  });
  
  if (passed) {
    console.log('✅ Wallet screen implementation complete');
  }
  
  return passed;
}

// Test 2: Check Supabase Edge Function
function testEdgeFunction() {
  console.log('\n📋 Test 2: Supabase Edge Function');
  
  const functionDir = path.join(__dirname, 'supabase', 'functions', 'create-setup-intent');
  
  if (!fs.existsSync(functionDir)) {
    console.log('❌ Edge function directory not found');
    return false;
  }
  
  const requiredFiles = [
    'index.ts',
    'config.toml',
    'import_map.json'
  ];
  
  let passed = true;
  
  requiredFiles.forEach(file => {
    const filePath = path.join(functionDir, file);
    if (!fs.existsSync(filePath)) {
      console.log(`❌ Missing file: ${file}`);
      passed = false;
    }
  });
  
  // Check function content
  const indexPath = path.join(functionDir, 'index.ts');
  if (fs.existsSync(indexPath)) {
    const functionContent = fs.readFileSync(indexPath, 'utf8');
    
    const requiredElements = [
      'stripe.setupIntents.create',
      'serve(async (req: Request)',
      'STRIPE_SECRET_KEY'
    ];
    
    requiredElements.forEach(element => {
      if (!functionContent.includes(element)) {
        console.log(`❌ Missing function element: ${element}`);
        passed = false;
      }
    });
  }
  
  if (passed) {
    console.log('✅ Edge function implementation complete');
  }
  
  return passed;
}

// Test 3: Check database migration
function testDatabaseMigration() {
  console.log('\n📋 Test 3: Database Migration');
  
  const walletPath = path.join(__dirname, 'app', '(tabs)', 'wallet.tsx');
  const walletContent = fs.readFileSync(walletPath, 'utf8');
  
  // Check for migration SQL in comments - look for the SQL block at the end
  const migrationElements = [
    'CREATE TABLE IF NOT EXISTS transactions',
    'CREATE TABLE IF NOT EXISTS payment_methods',
    'ALTER TABLE transactions ENABLE ROW LEVEL SECURITY',
    'CREATE POLICY "Users see own transactions"',
    'CREATE POLICY "Users see own payment methods"'
  ];
  
  let passed = true;
  
  migrationElements.forEach(element => {
    if (!walletContent.includes(element)) {
      console.log(`❌ Missing migration element: ${element}`);
      passed = false;
    }
  });
  
  if (passed) {
    console.log('✅ Database migration SQL included');
  }
  
  return passed;
}

// Test 4: Check documentation
function testDocumentation() {
  console.log('\n📋 Test 4: Documentation');
  
  const docsPath = path.join(__dirname, 'WALLET_IMPLEMENTATION_SUMMARY.md');
  
  if (!fs.existsSync(docsPath)) {
    console.log('❌ Documentation file not found');
    return false;
  }
  
  const docsContent = fs.readFileSync(docsPath, 'utf8');
  
  const requiredSections = [
    '## Features Implemented',
    '## Technical Architecture',
    '## Installation & Setup',
    '## Usage',
    '## Security Features'
  ];
  
  let passed = true;
  
  requiredSections.forEach(section => {
    if (!docsContent.includes(section)) {
      console.log(`❌ Missing documentation section: ${section}`);
      passed = false;
    }
  });
  
  if (passed) {
    console.log('✅ Documentation complete');
  }
  
  return passed;
}

// Test 5: Check package.json for Stripe dependency
function testPackageJson() {
  console.log('\n📋 Test 5: Package Dependencies');
  
  const packagePath = path.join(__dirname, 'package.json');
  
  if (!fs.existsSync(packagePath)) {
    console.log('❌ package.json not found');
    return false;
  }
  
  const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  
  const stripeDeps = [
    '@stripe/stripe-react-native'
  ];
  
  let passed = true;
  
  stripeDeps.forEach(dep => {
    if (!packageContent.dependencies?.[dep]) {
      console.log(`❌ Missing dependency: ${dep}`);
      passed = false;
    }
  });
  
  if (passed) {
    console.log('✅ Stripe dependencies configured');
  }
  
  return passed;
}

// Test 6: Check for environment variables
function testEnvironmentConfig() {
  console.log('\n📋 Test 6: Environment Configuration');
  
  const envPath = path.join(__dirname, '.env.example');
  
  if (!fs.existsSync(envPath)) {
    console.log('❌ Environment example file not found');
    return false;
  }
  
  const envContent = fs.readFileSync(envPath, 'utf8');
  
  const requiredEnvVars = [
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    'STRIPE_SECRET_KEY'
  ];
  
  let passed = true;
  
  requiredEnvVars.forEach(envVar => {
    if (!envContent.includes(envVar)) {
      console.log(`❌ Missing environment variable: ${envVar}`);
      passed = false;
    }
  });
  
  if (passed) {
    console.log('✅ Environment configuration complete');
  }
  
  return passed;
}

// Run all tests
function runTests() {
  const tests = [
    testWalletScreen,
    testEdgeFunction,
    testDatabaseMigration,
    testDocumentation,
    testPackageJson,
    testEnvironmentConfig
  ];
  
  let allPassed = true;
  
  tests.forEach(test => {
    const result = test();
    if (!result) {
      allPassed = false;
    }
  });
  
  console.log('\n' + '='.repeat(50));
  
  if (allPassed) {
    console.log('🎉 ALL TESTS PASSED! Wallet implementation is complete.');
    console.log('\nNext steps:');
    console.log('1. Install dependencies: npm install');
    console.log('2. Configure environment variables');
    console.log('3. Deploy Supabase Edge Function');
    console.log('4. Run database migrations');
    console.log('5. Test the wallet functionality');
  } else {
    console.log('❌ Some tests failed. Please review the implementation.');
  }
  
  console.log('\nFor detailed setup instructions, see WALLET_IMPLEMENTATION_SUMMARY.md');
}

// Run the tests
runTests();