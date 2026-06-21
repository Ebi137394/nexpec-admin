import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Camera, Save } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
// ★ Specialty taxonomy (Phase 3): inspectors pick which disciplines they
//   cover; written to profiles.specialty_slugs. Used by the inspector
//   job-feed matcher (server-side intersection with jobs.specialty_slugs).
import SpecialtyPicker from '@/src/components/SpecialtyPicker';
// ★ JURISDICTION-002 (Phase 2 / Capture): inspector declares country of
//   residence, the countries they're legally authorised to work in, and
//   whether they accept sponsored work. The Phase-4 matcher reads these
//   to filter the inspector's job feed by legal eligibility.
import CountryPicker from '@/src/components/CountryPicker';
import { normaliseCountryArray } from '@/src/data/countryCodes';

export default function EditProfileScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState(''); // Professional Title
  const [headline, setHeadline] = useState(''); // Bio/Headline
  const [bio, setBio] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  // ★ Specialty taxonomy slugs (Phase 3). Empty array is the legal
  //   "none selected"; we never store NULL.
  const [specialtySlugs, setSpecialtySlugs] = useState<string[]>([]);
  // ★ JURISDICTION-002 capture state. Defaults mirror the database
  //   defaults (NULL COR, empty arrays, sponsorship off).
  const [countryOfResidence, setCountryOfResidence] = useState<string | null>(null);
  const [workAuthorizedCountries, setWorkAuthorizedCountries] = useState<string[]>([]);
  const [openToSponsoredWork, setOpenToSponsoredWork] = useState<boolean>(false);
  const [sponsoredCountries, setSponsoredCountries] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  // Role drives which sections render + persist. The inspector-only
  // professional fields (specialties + work authorization) are hidden and
  // never written for buyer roles (client / agency / enterprise).
  const [role, setRole] = useState<string | null>(null);
  const isInspector = role === 'inspector';

  // Load initial data
  useEffect(() => {
    async function loadData() {
      try {
        if (!user) {
          console.log('No user available');
          return;
        }
        
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        
        if (error) throw error;
        
        if (data) {
          setFullName(data.full_name || '');
          // Load title (Professional Title) and headline (Bio/Headline) separately
          setTitle(data.title || data.professional_title || '');
          setHeadline(data.headline || '');
          setBio(data.bio || '');
          setAvatarUri(data.avatar_url || null);
          setRole((data.role as string) ?? null);
          // Specialty slugs — defensively coerce to a string[]. The
          // migration declares the column NOT NULL DEFAULT '{}', so
          // post-migration we always get an array; before the migration
          // lands we treat missing/NULL as empty.
          const slugs = Array.isArray(data.specialty_slugs)
            ? (data.specialty_slugs as string[])
            : [];
          setSpecialtySlugs(slugs);

          // ★ JURISDICTION-002 hydrate. We accept legacy NULL/missing
          //   and normalise to safe defaults so the screen always
          //   renders deterministically.
          setCountryOfResidence(
            typeof data.country_of_residence === 'string' && data.country_of_residence
              ? data.country_of_residence
              : null,
          );
          setWorkAuthorizedCountries(
            normaliseCountryArray(data.work_authorized_countries),
          );
          setOpenToSponsoredWork(Boolean(data.open_to_sponsored_work));
          setSponsoredCountries(
            normaliseCountryArray(data.sponsored_countries),
          );
        }
      } catch (error) {
        console.error('Error loading profile:', error);
      } finally {
        setFetching(false);
      }
    }
    loadData();
  }, [user]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.5,
      aspect: [1, 1],
    });

    if (!result.canceled) {
      setAvatarUri(result.assets[0].uri);
    }
  };

  /**
   * Upload avatar image to Supabase Storage
   * Using the SAFE publicUrl extraction method
   */
  const uploadAvatar = async (): Promise<string | null> => {
    if (!avatarUri || avatarUri.startsWith('http')) return avatarUri; 

    try {
      const base64 = await FileSystem.readAsStringAsync(avatarUri, { encoding: 'base64' });
      const filePath = `avatars/${user?.id}/${Date.now()}.jpg`;
      
      // We assume bucket 'avatars' exists. If not, create it in Supabase dashboard.
      const { error: uploadError } = await supabase.storage
        .from('avatars') 
        .upload(filePath, decode(base64), { contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      // ✅ SAFE METHOD: Get public URL without destructuring
      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const publicUrl = urlData?.publicUrl;

      if (!publicUrl) {
        throw new Error('Failed to get public URL');
      }

      return publicUrl;
    } catch (error) {
      console.error('Avatar upload failed:', error);
      return null;
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const publicUrl = await uploadAvatar();

      const updates: any = {
        full_name: fullName.trim(),
        bio: bio.trim(),
        updated_at: new Date().toISOString(),
      };

      // Only update avatar_url if we have a new URL
      if (publicUrl) {
        updates.avatar_url = publicUrl;
      }

      // Update title (Professional Title) column
      if (title.trim()) {
        updates.title = title.trim();
      } else {
        updates.title = null;
      }

      // Update headline (Bio/Headline) column
      if (headline.trim()) {
        updates.headline = headline.trim();
      } else {
        updates.headline = null;
      }

      // Inspector-only professional fields. Buyer roles never see these
      // inputs (gated in the render), so we must never persist them —
      // keeps buyer profile rows free of meaningless freelancer /
      // work-authorization data.
      if (isInspector) {
        // ★ Specialty taxonomy slugs (Phase 3). Always write the array —
        //   never NULL. Empty array means the inspector has declared no
        //   specialties, which is a legitimate state.
        updates.specialty_slugs = specialtySlugs;

        // ★ JURISDICTION-002 capture. country_of_residence may legally
        //   be NULL (not declared yet) — pass through. Arrays always
        //   write the actual array; booleans are normalised.
        updates.country_of_residence = countryOfResidence ?? null;
        updates.work_authorized_countries = normaliseCountryArray(workAuthorizedCountries);
        updates.open_to_sponsored_work = Boolean(openToSponsoredWork);
        // If sponsorship is OFF we deliberately clear the preferred-list
        // — preserving it across a toggle-off would create silent state
        // the inspector can't see in the UI when the picker is hidden.
        updates.sponsored_countries = openToSponsoredWork
          ? normaliseCountryArray(sponsoredCountries)
          : [];
      }

      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user?.id);

      if (error) throw error;
      
      Alert.alert('Success', 'Profile updated!');
      router.back();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
     return (
       <SafeAreaView style={styles.container}>
         <View style={styles.loadingContainer}>
           <ActivityIndicator size="large" color="#3b82f6" />
         </View>
       </SafeAreaView>
     );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <TouchableOpacity onPress={handleSave} disabled={loading} style={styles.saveButton}>
           {loading ? <ActivityIndicator color="#fff" /> : <Save size={24} color="#fff" />}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={pickImage} style={styles.avatarContainer}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder} />
            )}
            <View style={styles.cameraIcon}>
              <Camera size={20} color="#fff" />
            </View>
          </TouchableOpacity>
          <Text style={styles.changePhotoText}>Tap to change photo</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="John Doe"
            placeholderTextColor="#64748b"
          />

          <Text style={styles.label}>Professional Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Senior Welding Inspector"
            placeholderTextColor="#64748b"
          />

          <Text style={styles.label}>Headline</Text>
          <TextInput
            style={styles.input}
            value={headline}
            onChangeText={setHeadline}
            placeholder="Brief professional summary"
            placeholderTextColor="#64748b"
          />

          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={bio}
            onChangeText={setBio}
            placeholder="Tell us about your experience..."
            placeholderTextColor="#64748b"
            multiline
            numberOfLines={4}
          />

          {/* Inspector-only professional profile (specialties + work
              authorization). Hidden for buyer roles (client / agency /
              enterprise) — they never see or persist freelancer attributes. */}
          {isInspector && (
          <>
          {/* ★ Specialty taxonomy (Phase 3) — search + chip multi-select. */}
          <View style={styles.specialtySection}>
            <Text style={styles.label}>Specialties</Text>
            <SpecialtyPicker
              value={specialtySlugs}
              onChange={setSpecialtySlugs}
              maxSelections={12}
              helperText="Choose the inspection disciplines you cover. Used to match you with relevant jobs."
            />
          </View>

          {/* ★ JURISDICTION-002 (Phase 2 / Capture) — Work Authorization. */}
          <View style={styles.workAuthSection}>
            <Text style={styles.sectionHeading}>Work Authorization</Text>
            <Text style={styles.sectionHeadingSub}>
              Used to match you with jobs you can legally accept. Required
              for the inspector job feed to filter out ineligible postings.
            </Text>

            <View style={styles.pickerWrap}>
              <CountryPicker
                mode="single"
                value={countryOfResidence}
                onChange={setCountryOfResidence}
                label="Country of residence"
                helperText="Your tax home. Drives 1099 / W-8BEN selection on payouts later."
                searchPlaceholder="Search countries…"
              />
            </View>

            <View style={styles.pickerWrap}>
              <CountryPicker
                mode="multi"
                value={workAuthorizedCountries}
                onChange={setWorkAuthorizedCountries}
                maxSelections={60}
                showRegionBundles
                label="Where can you legally work without sponsorship?"
                helperText="Tap a region bundle to add EU/EEA/GCC/USMCA at once, or pick individual countries."
                searchPlaceholder="Search countries…"
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleRowText}>
                <Text style={styles.toggleLabel}>
                  I'm open to sponsored relocation work
                </Text>
                <Text style={styles.toggleHelper}>
                  Clients can hire you for jobs outside your authorized
                  countries if they cover the visa / relocation.
                </Text>
              </View>
              <Switch
                value={openToSponsoredWork}
                onValueChange={setOpenToSponsoredWork}
                trackColor={{ false: '#334155', true: '#7C3AED' }}
                thumbColor="#FFFFFF"
              />
            </View>

            {openToSponsoredWork ? (
              <View style={styles.pickerWrap}>
                <CountryPicker
                  mode="multi"
                  value={sponsoredCountries}
                  onChange={setSponsoredCountries}
                  maxSelections={60}
                  showRegionBundles
                  label="Preferred sponsored destinations (optional)"
                  helperText="Leave empty to accept sponsorship to any country."
                  searchPlaceholder="Search countries…"
                />
              </View>
            ) : null}
          </View>
          </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020420' },
  loadingContainer: { flex: 1, backgroundColor: '#020420', justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  backButton: { padding: 8 },
  saveButton: { padding: 8, backgroundColor: '#3b82f6', borderRadius: 8 },
  
  content: { padding: 20 },
  avatarSection: { alignItems: 'center', marginBottom: 30 },
  avatarContainer: { position: 'relative' },
  avatar: { width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: '#3b82f6' },
  avatarPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#1e293b', borderWidth: 2, borderColor: '#3b82f6' },
  cameraIcon: { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#3b82f6', padding: 8, borderRadius: 20 },
  changePhotoText: { color: '#94a3b8', marginTop: 12 },
  
  form: { gap: 16 },
  label: { color: '#94a3b8', fontSize: 14, marginBottom: 4 },
  input: { backgroundColor: '#1e293b', color: '#fff', padding: 16, borderRadius: 12, fontSize: 16, borderWidth: 1, borderColor: '#334155' },
  textArea: { height: 120, textAlignVertical: 'top' },
  specialtySection: { marginTop: 8 },
  // ★ JURISDICTION-002 styles
  workAuthSection: { marginTop: 12, gap: 16 },
  sectionHeading: { color: '#F9FAFB', fontSize: 16, fontWeight: '700' },
  sectionHeadingSub: { color: '#94a3b8', fontSize: 12, marginTop: -8 },
  pickerWrap: { paddingTop: 4 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1F2937',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  toggleRowText: { flex: 1 },
  toggleLabel: { color: '#F9FAFB', fontSize: 14, fontWeight: '600' },
  toggleHelper: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
});
