// lib/imageDiagnostics.ts

/**
 * Comprehensive image URL diagnostic tool
 */
export async function diagnoseImageUrl(imageUrl: string) {
  console.log('════════════════════════════════════════');
  console.log('🔍 IMAGE URL DIAGNOSTICS');
  console.log('════════════════════════════════════════');
  console.log('URL:', imageUrl);
  console.log('════════════════════════════════════════');

  const results = {
    urlValid: false,
    accessible: false,
    statusCode: 0,
    contentType: '',
    contentLength: '',
    corsHeader: '',
    error: '',
  };

  try {
    // Test 1: Validate URL format
    console.log('1️⃣ Validating URL format...');
    try {
      new URL(imageUrl);
      results.urlValid = true;
      console.log('✅ URL format is valid');
    } catch (e) {
      results.error = 'Invalid URL format';
      console.error('❌ Invalid URL format');
      return results;
    }

    // Test 2: Fetch with HEAD request
    console.log('2️⃣ Testing URL accessibility (HEAD request)...');
    try {
      const headResponse = await fetch(imageUrl, { 
        method: 'HEAD',
        mode: 'no-cors', // Try without CORS first
      });
      
      // With no-cors, we can't read status, so try with cors
      console.log('   Trying with CORS...');
    } catch (headError) {
      console.log('   HEAD with no-cors failed, trying GET...');
    }

    // Test 3: Fetch with GET request
    console.log('3️⃣ Testing URL accessibility (GET request)...');
    try {
      const response = await fetch(imageUrl, {
        method: 'GET',
        headers: {
          'Accept': 'image/*',
        },
      });

      results.statusCode = response.status;
      results.contentType = response.headers.get('content-type') || '';
      results.contentLength = response.headers.get('content-length') || '';
      results.corsHeader = response.headers.get('access-control-allow-origin') || '';

      console.log('📊 Response Status:', response.status, response.statusText);
      console.log('📋 Content-Type:', results.contentType);
      console.log('📋 Content-Length:', results.contentLength);
      console.log('📋 CORS Header:', results.corsHeader);

      if (response.ok) {
        results.accessible = true;
        console.log('✅ URL is accessible!');
        
        // Try to read as blob
        const blob = await response.blob();
        console.log('✅ Blob created:', blob.size, 'bytes');
        console.log('✅ Blob type:', blob.type);
      } else {
        results.error = `HTTP ${response.status}: ${response.statusText}`;
        console.error('❌ URL returned status:', response.status);
        
        if (response.status === 403) {
          console.error('   → This indicates RLS policy issue');
          console.error('   → Bucket might not be public');
          console.error('   → SELECT policy might be missing for anon role');
        } else if (response.status === 404) {
          console.error('   → File not found at this path');
          console.error('   → Check if file exists in Storage dashboard');
        }
      }
    } catch (fetchError: any) {
      results.error = fetchError.message || 'Network error';
      console.error('❌ Fetch failed:', fetchError);
      console.error('   This might be a CORS or network issue');
    }

    // Test 4: Extract components from URL
    console.log('4️⃣ Extracting URL components...');
    const urlMatch = imageUrl.match(/https:\/\/([^.]+)\.supabase\.co\/storage\/v1\/object\/public\/([^/]+)\/(.+)/);
    if (urlMatch) {
      const [, projectRef, bucketName, filePath] = urlMatch;
      console.log('   Project Ref:', projectRef);
      console.log('   Bucket:', bucketName);
      console.log('   File Path:', filePath);
    }

  } catch (error: any) {
    results.error = error.message || 'Unknown error';
    console.error('💥 Diagnostic failed:', error);
  }

  console.log('════════════════════════════════════════');
  console.log('📋 DIAGNOSTIC SUMMARY:');
  console.log('   URL Valid:', results.urlValid ? '✅' : '❌');
  console.log('   Accessible:', results.accessible ? '✅' : '❌');
  console.log('   Status Code:', results.statusCode || 'N/A');
  console.log('   Content-Type:', results.contentType || 'N/A');
  console.log('   Error:', results.error || 'None');
  console.log('════════════════════════════════════════');

  return results;
}

/**
 * Quick test function
 */
export async function quickTestUrl(imageUrl: string): Promise<boolean> {
  try {
    const response = await fetch(imageUrl, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

