# NEXPEC - Industrial Inspection Platform

A production-grade React Native app built with Expo for industrial inspection management.

## Stack

- **Framework**: Expo SDK 51 with Expo Router
- **Language**: TypeScript
- **Styling**: NativeWind (Tailwind CSS for React Native)
- **Backend**: Supabase
- **Icons**: Lucide React Native

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Then add your Supabase credentials:

```
EXPO_PUBLIC_SUPABASE_URL=your_supabase_project_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Database Schema

Ensure your Supabase database has the following tables:

#### `profiles` table
```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  verification_status BOOLEAN DEFAULT false,
  avatar_url TEXT,
  job_title TEXT NOT NULL,
  base_location TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### `inspector_skills` table
```sql
CREATE TABLE inspector_skills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  model TEXT NOT NULL,
  years_experience INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 4. Run the App

```bash
# Start the development server
npm start

# Run on iOS
npm run ios

# Run on Android
npm run android
```

## Features

### Inspector Profile Screen (`app/profile.tsx`)

- ✅ **Data Integrity**: Strict TypeScript interfaces matching Supabase schema
- ✅ **Supabase Integration**: Real-time data fetching with proper error handling
- ✅ **Three-State Loading**: Loading spinner, error alert, and success display
- ✅ **Pull-to-Refresh**: Swipe down to update profile data
- ✅ **Dark Industrial Theme**: Deep Navy background (#0F172A) with Orange accents (#F59E0B)
- ✅ **Verification Badge**: Green checkmark for verified inspectors
- ✅ **Stats Cards**: Projects, Hours, and Rating display
- ✅ **Skills Arsenal**: Technical equipment displayed as styled chips
- ✅ **Responsive UI**: Optimized for mobile devices

## Project Structure

```
NEXPEC/
├── app/                    # Expo Router screens
│   ├── _layout.tsx        # Root layout
│   └── profile.tsx        # Inspector profile screen
├── lib/                   # Utilities
│   └── supabase.ts       # Supabase client
├── types/                # TypeScript definitions
│   └── database.types.ts # Database interfaces
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript config
├── tailwind.config.js    # Tailwind configuration
└── global.css           # Global styles
```

## Development Notes

- The app uses Expo Router for file-based routing
- NativeWind provides utility-first styling
- Supabase handles authentication and data persistence
- All components are fully typed with TypeScript

## Next Steps

1. Implement profile editing functionality
2. Add skill management (add/remove skills)
3. Implement project history view
4. Add real-time stats tracking
5. Create authentication flow

---

Built with ❤️ for industrial inspectors

