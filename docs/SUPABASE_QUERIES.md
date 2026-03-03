# Supabase Query Patterns - NEXPEC

## ✅ Correct Query Examples

### 1. Job Application Submission

```typescript
// ✅ CORRECT: Insert job application
const { data, error } = await supabase
  .from('job_applications')
  .insert({
    job_id: 'your-job-id', // Make sure this ID exists in 'jobs' table
    inspector_id: user.id, // This MUST be the logged-in user's ID
    status: 'pending',     // Matches the allowed status list
    cover_letter: 'Test application', // Optional
    proposed_price: 2000,  // Optional
  });

// Error handling
if (error) {
  if (error.code === '23505') {
    // Duplicate application (unique constraint violation)
    console.error('Already applied to this job');
  } else {
    throw error;
  }
}
```

**Key Points:**
- `job_id` must exist in `jobs` table
- `inspector_id` must be the logged-in user's ID
- `status` must be one of: `'pending' | 'offered' | 'accepted' | 'rejected'`
- `cover_letter` and `proposed_price` are optional

---

### 2. Dashboard Stats RPC

```typescript
// ❌ OLD WAY (Will cause PGRST202 error)
const { data, error } = await supabase.rpc('get_inspector_dashboard_stats', {
  inspector_id: user.id // ❌ Don't pass this anymore
});

// ✅ NEW WAY (Correct)
const { data, error } = await supabase.rpc('get_inspector_dashboard_stats');

if (error) {
  console.error('Dashboard stats error:', error);
} else {
  console.log('Stats:', data);
  // data is typed as DashboardStats
}

// Returns DashboardStats:
// {
//   active_jobs: number;
//   completed_jobs: number;
//   pending_offers: number;
//   total_reviews: number;
//   average_rating: number;
//   total_earned: number;
//   available_balance: number;
// }
```

**Key Points:**
- ❌ **DO NOT** pass any arguments to this RPC (will cause PGRST202 error)
- ✅ The function automatically gets the user ID from the auth session
- Returns stats for the currently authenticated inspector
- `data` is automatically typed as `DashboardStats`

---

### 3. Job Listing

```typescript
// ✅ CORRECT: Query open jobs
const { data: jobs, error: jobsError } = await supabase
  .from('jobs')
  .select('*')
  .eq('status', 'open');

// With joins for client info
const { data: jobsWithClient, error } = await supabase
  .from('jobs')
  .select(`
    *,
    client:profiles!jobs_client_id_fkey(full_name, avatar_url, company_name)
  `)
  .eq('status', 'open')
  .order('created_at', { ascending: false });
```

**Key Points:**
- Use `status = 'open'` for available jobs
- Join with `profiles` table using foreign key: `jobs_client_id_fkey`
- Order by `created_at` for newest first

---

## Common Patterns

### Query My Applications

```typescript
const { data: applications, error } = await supabase
  .from('job_applications')
  .select(`
    *,
    job:jobs(
      *,
      client:profiles!jobs_client_id_fkey(full_name, avatar_url, company_name)
    )
  `)
  .eq('inspector_id', user.id)
  .order('created_at', { ascending: false });
```

### Query My Active Jobs

```typescript
const { data: activeJobs, error } = await supabase
  .from('jobs')
  .select(`
    *,
    client:profiles!jobs_client_id_fkey(full_name, avatar_url, company_name)
  `)
  .eq('hired_inspector_id', user.id)
  .in('status', ['in_progress', 'report_submitted'])
  .order('updated_at', { ascending: false });
```

### Query Pending Offers

```typescript
const { data: offers, error } = await supabase
  .from('job_applications')
  .select(`
    *,
    job:jobs(*)
  `)
  .eq('inspector_id', user.id)
  .eq('status', 'offered')
  .order('updated_at', { ascending: false });
```

---

## ❌ Common Mistakes

### 1. Passing arguments to dashboard stats RPC
```typescript
// ❌ WRONG (Will cause PGRST202 error)
await supabase.rpc('get_inspector_dashboard_stats', { 
  inspector_id: user.id // ❌ Don't pass this
});

// ✅ CORRECT
await supabase.rpc('get_inspector_dashboard_stats');
```

### 2. Using wrong column names
```typescript
// ❌ WRONG
.eq('user_id', user.id)  // Jobs table uses 'client_id', not 'user_id'

// ✅ CORRECT
.eq('client_id', user.id)
```

### 3. Missing required fields
```typescript
// ❌ WRONG - missing required fields
.insert({
  job_id: jobId,
  // inspector_id missing!
})

// ✅ CORRECT
.insert({
  job_id: jobId,
  inspector_id: user.id,  // Required!
  status: 'pending',      // Required!
})
```

---

## Status Values

### Job Status
- `'open'` - Job is open for applications
- `'in_progress'` - Job is active and in progress
- `'completed'` - Job completed
- `'cancelled'` - Job cancelled

### Application Status
- `'pending'` - Application submitted, waiting for review
- `'accepted'` - Client accepted the application (offer made)
- `'rejected'` - Application rejected
- `'withdrawn'` - Application withdrawn by inspector

---

## Foreign Key Relationships

### Jobs → Profiles (Client)
```typescript
client:profiles!jobs_client_id_fkey(full_name, avatar_url, company_name)
```

### Job Applications → Jobs
```typescript
job:jobs(*)
```

### Job Applications → Profiles (Inspector)
```typescript
inspector:profiles!job_applications_inspector_id_fkey(full_name, avatar_url)
```

