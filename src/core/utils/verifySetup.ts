// lib/verifySetup.ts
import { supabase } from '@/src/core/supabase/supabase';

export async function verifyCompleteSetup() {
  console.log('════════════════════════════════════════');
  console.log('🔍 VERIFYING COMPLETE SETUP');
  console.log('════════════════════════════════════════');

  try {
    // Test 1: Check messages table structure
    console.log('1️⃣ Testing messages table...');
    const { data: messageTest, error: msgError } = await supabase
      .from('messages')
      .select('id, project_id, user_id, text, created_at')
      .limit(1);
    
    if (msgError) {
      console.error('❌ Messages table error:', msgError);
    } else {
      console.log('✅ Messages table OK');
    }

    // Test 2: Check storage bucket
    console.log('2️⃣ Testing storage bucket...');
    const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
    
    if (bucketError) {
      console.error('❌ Bucket list error:', bucketError);
    } else {
      const reportBucket = buckets?.find(b => b.id === 'report-images');
      
      if (reportBucket) {
        console.log('✅ Bucket exists');
        console.log('   Public:', reportBucket.public);
        console.log('   Name:', reportBucket.name);
      } else {
        console.error('❌ Bucket not found');
      }
    }

    // Test 3: List files
    console.log('3️⃣ Listing files...');
    const { data: files, error: filesError } = await supabase.storage
      .from('report-images')
      .list('reports', { limit: 5 });
    
    if (filesError) {
      console.error('❌ Files list error:', filesError);
    } else {
      console.log('✅ Files found:', files?.length || 0);
      
      if (files && files.length > 0) {
        console.log('Sample file:', files[0].name);
        
        // Test 4: Generate public URL
        const { data: urlData } = supabase.storage
          .from('report-images')
          .getPublicUrl(`reports/${files[0].name}`);
        
        console.log('✅ Sample public URL:', urlData?.publicUrl);
        
        // Test 5: Verify URL is accessible
        try {
          const response = await fetch(urlData.publicUrl, { method: 'HEAD' });
          console.log('✅ URL status:', response.status);
          
          if (response.ok) {
            console.log('✅✅✅ SETUP VERIFIED - ALL TESTS PASSED!');
            console.log('   Content-Type:', response.headers.get('content-type'));
            console.log('   Content-Length:', response.headers.get('content-length'));
          } else {
            console.error('❌ URL returned', response.status);
            console.error('   This might indicate RLS policy issues');
          }
        } catch (fetchError) {
          console.error('❌ Failed to fetch URL:', fetchError);
        }
      } else {
        console.log('⚠️  No files found in bucket (this is OK if you haven\'t uploaded yet)');
      }
    }

    // Test 6: Check authentication
    console.log('4️⃣ Testing authentication...');
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError) {
      console.error('❌ Auth error:', authError);
    } else if (user) {
      // ★ CONSOLE-NOISE-001(A): PII-stripped (was: user.id).
      console.log('✅ User authenticated');
    } else {
      console.log('⚠️  No user logged in (this is OK for public bucket tests)');
    }

  } catch (error: any) {
    console.error('💥 Verification failed:', error);
    console.error('Error message:', error.message);
  }
  
  console.log('════════════════════════════════════════');
}

/**
 * Quick verification function for storage only
 */
export async function verifyStorageSetup() {
  console.log('🔍 Verifying Storage Setup...');
  
  try {
    // Check bucket
    const { data: buckets } = await supabase.storage.listBuckets();
    const bucket = buckets?.find(b => b.id === 'report-images');
    
    if (!bucket) {
      console.error('❌ report-images bucket not found');
      return false;
    }
    
    if (!bucket.public) {
      console.error('❌ Bucket is not public');
      return false;
    }
    
    console.log('✅ Bucket exists and is public');
    
    // Try to list files
    const { data: files, error } = await supabase.storage
      .from('report-images')
      .list('reports', { limit: 1 });
    
    if (error) {
      console.error('❌ Cannot list files:', error.message);
      return false;
    }
    
    console.log('✅ Storage setup verified');
    return true;
  } catch (error: any) {
    console.error('❌ Storage verification failed:', error.message);
    return false;
  }
}

