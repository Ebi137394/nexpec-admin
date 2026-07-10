import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  Alert, KeyboardAvoidingView, Platform, ActivityIndicator, Modal,
  Pressable, Animated
} from 'react-native';
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft, Briefcase, FileText, MapPin, Calendar, DollarSign, Award,
  Check, X, Locate, ChevronDown, ChevronRight, AlertCircle, CheckCircle,
  Clock, Shield, Zap, Target, AlignLeft, Navigation,
} from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../src/contexts/AuthContext';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { captureCurrentLocation, type CapturedLocation } from '../src/utils/locationCapture';
import { toCents } from '../lib/money';
// ★ Specialty taxonomy (Phase 3): controlled discipline slugs written to
//    jobs.specialty_slugs. Distinct from required_certifications (formal
//    credentials) — specialties describe the WORK DOMAIN.
import SpecialtyPicker from '../src/components/SpecialtyPicker';
// ★ JURISDICTION-002 (Phase 2 / Capture): client declares where the work
//    will take place and whether sponsorship is offered. The Phase-4
//    matcher reads these to filter the inspector job feed by legal
//    eligibility.
import CountryPicker from '../src/components/CountryPicker';

const C = {
  bg: '#020420', card: '#0A0D2C', cardAlt: '#0F172A', cardBorder: '#1A1D3C',
  border: '#1E293B', borderSubtle: 'rgba(30, 41, 59, 0.5)', primary: '#7C3AED',
  primaryMuted: 'rgba(124, 58, 237, 0.12)', primaryBorder: 'rgba(124, 58, 237, 0.28)',
  text: '#FFFFFF', textSec: '#94A3B8', textMuted: '#64748B', inputBg: '#0A0E2E',
  success: '#10B981', successBg: 'rgba(16, 185, 129, 0.10)', successBorder: 'rgba(16, 185, 129, 0.25)',
  error: '#EF4444', errorBg: 'rgba(239, 68, 68, 0.08)', errorBorder: 'rgba(239, 68, 68, 0.25)',
  warning: '#F59E0B', warningBg: 'rgba(245, 158, 11, 0.10)', blue: '#3B82F6',
};

type BudgetType = 'fixed' | 'hourly' | 'daily';

type SponsorshipOffered = 'none' | 'visa_assist' | 'full_sponsorship';

interface FormData {
  title: string; description: string; location: string; budgetType: BudgetType;
  proposedBudget: string; currency: string; requiredCertifications: string[];
  scheduledDate: Date | null; estimatedDuration: string; urgency: 'standard' | 'urgent' | 'critical';
  // ★ Specialty slugs from the controlled NEXPEC taxonomy. Written to
  //   jobs.specialty_slugs (TEXT[]). Empty array is the legal "none yet".
  specialtySlugs: string[];
  // ★ JURISDICTION-002. job_country is required for Phase-4 matching;
  //   sponsorship_offered defaults to 'none' (client must opt in).
  jobCountry: string | null;
  sponsorshipOffered: SponsorshipOffered;
  // ★ CCI FLAG (Sprint 12 hotfix — mobile parity 2026-05-20).
  //   When ON, only inspectors holding a valid CCI tier credential are
  //   eligible to be dispatched against this job. Writes to
  //   jobs.requires_cci BOOLEAN NOT NULL DEFAULT false. The full
  //   compliance-mode flow at /post-compliance-job remains the
  //   regulator-grade variant; this checkbox is the lightweight
  //   "I just need a credentialed inspector" toggle for the standard
  //   posting lane.
  requiresCci: boolean;
}

interface FormErrors {
  title?: string; description?: string; location?: string; proposedBudget?: string;
  jobCountry?: string;
}

const SPONSORSHIP_OPTIONS: { key: SponsorshipOffered; label: string; desc: string }[] = [
  { key: 'none',             label: 'No sponsorship', desc: 'Inspector must already be authorized in this country.' },
  { key: 'visa_assist',      label: 'Visa assist',     desc: 'You handle permits / paperwork; inspector covers travel.' },
  { key: 'full_sponsorship', label: 'Full sponsorship', desc: 'You cover visa + relocation costs.' },
];

const BUDGET_TYPES: { key: BudgetType; label: string; desc: string }[] = [
  { key: 'fixed', label: 'Fixed Price', desc: 'One-time payment' },
  { key: 'hourly', label: 'Hourly Rate', desc: 'Per hour billing' },
  { key: 'daily', label: 'Daily Rate', desc: 'Per day billing' },
];

const DURATION_OPTIONS = ['1-3 days', '1 week', '2 weeks', '1 month', '2-3 months', '3-6 months', '6+ months', 'Ongoing'];

const URGENCY_OPTIONS = [
  { key: 'standard', label: 'Standard', color: C.success, bg: C.successBg, icon: Clock },
  { key: 'urgent', label: 'Urgent', color: C.warning, bg: C.warningBg, icon: Zap },
  { key: 'critical', label: 'Critical', color: C.error, bg: C.errorBg, icon: AlertCircle },
] as const;

const CERTIFICATIONS = [
  { id: 'aws_cwi', name: 'AWS CWI', category: 'Welding', description: 'Certified Welding Inspector' },
  { id: 'api_510', name: 'API 510', category: 'API', description: 'Pressure Vessel Inspector' },
  { id: 'api_570', name: 'API 570', category: 'API', description: 'Piping Inspector' },
  { id: 'api_653', name: 'API 653', category: 'API', description: 'Aboveground Storage Tank Inspector' },
  { id: 'asnt_level_ii', name: 'ASNT Level II', category: 'NDT', description: 'NDT Level II Certification' },
  { id: 'nace_cip_1', name: 'NACE CIP Level 1', category: 'Coatings', description: 'Coating Inspector Program Level 1' },
];

const CERT_CATEGORIES = [...new Set(CERTIFICATIONS.map((c) => c.category))];

const initialForm: FormData = {
  title: '', description: '', location: '', budgetType: 'fixed', proposedBudget: '',
  currency: 'USD', requiredCertifications: [], scheduledDate: null,
  estimatedDuration: '', urgency: 'standard',
  specialtySlugs: [],
  jobCountry: null,
  sponsorshipOffered: 'none',
  requiresCci: false,
};

function validateForm(form: FormData): FormErrors {
  const e: FormErrors = {};
  if (!form.title.trim() || form.title.trim().length < 8) e.title = 'Title must be at least 8 characters';
  if (!form.description.trim() || form.description.trim().length < 30) e.description = 'Please provide at least 30 characters';
  if (!form.location.trim()) e.location = 'Location is required';
  const price = parseFloat(form.proposedBudget);
  if (!form.proposedBudget.trim() || isNaN(price) || price <= 0) {
    e.proposedBudget =
      form.budgetType === 'hourly'
        ? 'Enter a valid hourly rate'
        : form.budgetType === 'daily'
        ? 'Enter a valid daily rate'
        : 'Enter a valid fixed amount';
  }
  // ★ JURISDICTION-002: job country is required. The DB column is
  //   nullable in Phase 1 to protect legacy rows, but every NEW job
  //   posted via this screen MUST declare its country so the matcher
  //   has the data it needs in Phase 4.
  if (!form.jobCountry || !/^[A-Z]{2}$/.test(form.jobCountry)) {
    e.jobCountry = 'Select the country where the work will take place';
  }
  return e;
}

const SectionHeader: React.FC<{ icon: any; title: string; subtitle?: string; step?: number; }> = ({ icon: Icon, title, subtitle, step }) => (
  <View style={st.sectionHdr}>
    <View style={st.sectionHdrLeft}>
      <View style={st.sectionIconWrap}><Icon size={16} color={C.primary} strokeWidth={2.2} /></View>
      <View>
        <View style={st.sectionTitleRow}>
          {step != null && <View style={st.stepBadge}><Text style={st.stepBadgeTxt}>{step}</Text></View>}
          <Text style={st.sectionTitle}>{title}</Text>
        </View>
        {subtitle && <Text style={st.sectionSub}>{subtitle}</Text>}
      </View>
    </View>
  </View>
);

const Field: React.FC<any> = ({ label, placeholder, value, onChangeText, error, multiline, maxLength, keyboardType, icon: Icon, prefix, suffix, helperText }) => (
  <View style={st.fieldWrap}>
    <Text style={st.fieldLabel}>{label}</Text>
    <View style={[st.inputRow, multiline && st.inputRowMulti, error ? st.inputRowError : null]}>
      {Icon && <Icon size={16} color={error ? C.error : C.textMuted} strokeWidth={2} style={{ marginRight: 8 }} />}
      {prefix && <Text style={st.inputPrefix}>{prefix}</Text>}
      <TextInput style={[st.input, multiline && st.inputMulti]} placeholder={placeholder} placeholderTextColor={C.textMuted} value={value} onChangeText={onChangeText} multiline={multiline} maxLength={maxLength} keyboardType={keyboardType} textAlignVertical={multiline ? 'top' : 'center'} />
      {suffix && <Text style={st.inputSuffix}>{suffix}</Text>}
    </View>
    {error ? <View style={st.errorRow}><AlertCircle size={12} color={C.error} strokeWidth={2} /><Text style={st.errorTxt}>{error}</Text></View> : helperText ? <Text style={st.helperTxt}>{helperText}</Text> : null}
    {maxLength && <Text style={st.charCount}>{value.length}/{maxLength}</Text>}
  </View>
);

const CertModal: React.FC<any> = ({ visible, selected, onToggle, onClose }) => {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = CERTIFICATIONS;
    if (activeCategory) list = list.filter((c) => c.category === activeCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
    }
    return list;
  }, [search, activeCategory]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={st.modalRoot} edges={['top']}>
        <View style={st.modalHdr}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}><X size={24} color={C.text} strokeWidth={2} /></TouchableOpacity>
          <Text style={st.modalTitle}>Required Certifications</Text>
          <View style={st.modalCountBadge}><Text style={st.modalCountTxt}>{selected.length}</Text></View>
        </View>
        <View style={st.modalSearchWrap}>
          <View style={st.modalSearchBar}>
            <Target size={15} color={C.textMuted} strokeWidth={2} />
            <TextInput style={st.modalSearchInput} placeholder="Search certifications..." placeholderTextColor={C.textMuted} value={search} onChangeText={setSearch} />
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.catChipsWrap}>
          <TouchableOpacity style={[st.catChip, !activeCategory && st.catChipOn]} onPress={() => setActiveCategory(null)}><Text style={[st.catChipTxt, !activeCategory && st.catChipTxtOn]}>All</Text></TouchableOpacity>
          {CERT_CATEGORIES.map((cat) => (
            <TouchableOpacity key={cat} style={[st.catChip, activeCategory === cat && st.catChipOn]} onPress={() => setActiveCategory(activeCategory === cat ? null : cat)}>
              <Text style={[st.catChipTxt, activeCategory === cat && st.catChipTxtOn]}>{cat}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <ScrollView style={st.modalScroll} contentContainerStyle={st.modalScrollContent} showsVerticalScrollIndicator={false}>
          {filtered.map((cert) => {
            const isOn = selected.includes(cert.id);
            return (
              <TouchableOpacity key={cert.id} style={[st.certRow, isOn && st.certRowOn]} activeOpacity={0.7} onPress={() => onToggle(cert.id)}>
                <View style={st.certInfo}>
                  <View style={st.certNameRow}><Text style={st.certName}>{cert.name}</Text><View style={st.certCatBadge}><Text style={st.certCatTxt}>{cert.category}</Text></View></View>
                  <Text style={st.certDesc}>{cert.description}</Text>
                </View>
                <View style={[st.certCheck, isOn && st.certCheckOn]}>{isOn && <Check size={14} color={C.text} strokeWidth={3} />}</View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <View style={st.modalFooter}><TouchableOpacity style={st.modalDoneBtn} onPress={onClose} activeOpacity={0.8}><Text style={st.modalDoneTxt}>Done, {selected.length} Selected</Text></TouchableOpacity></View>
      </SafeAreaView>
    </Modal>
  );
};

const DurationModal: React.FC<any> = ({ visible, value, onSelect, onClose }) => (
  <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={st.modalRoot} edges={['top']}>
      <View style={st.modalHdr}><TouchableOpacity onPress={onClose}><X size={24} color={C.text} strokeWidth={2} /></TouchableOpacity><Text style={st.modalTitle}>Estimated Duration</Text><View style={{ width: 24 }} /></View>
      <ScrollView style={st.modalScroll} contentContainerStyle={st.modalScrollContent}>
        {DURATION_OPTIONS.map((d) => {
          const isOn = value === d;
          return (
            <TouchableOpacity key={d} style={[st.durationRow, isOn && st.durationRowOn]} activeOpacity={0.7} onPress={() => { onSelect(d); onClose(); }}>
              <Clock size={16} color={isOn ? C.primary : C.textMuted} strokeWidth={2} /><Text style={[st.durationTxt, isOn && st.durationTxtOn]}>{d}</Text>
              {isOn && <CheckCircle size={18} color={C.primary} strokeWidth={2.5} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  </Modal>
);

export default function CreateJobScreen() {
  const { session } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const [form, setForm] = useState<FormData>({ ...initialForm });
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showCertModal, setShowCertModal] = useState(false);
  const [showDurationModal, setShowDurationModal] = useState(false);
  const [capturingLocation, setCapturingLocation] = useState(false);

  const updateField = useCallback((key: keyof FormData, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value })); setTouched((prev) => new Set(prev).add(key));
    setErrors((prev) => { const next = { ...prev }; delete next[key as keyof FormErrors]; return next; });
  }, []);

  const toggleCert = useCallback((id: string) => {
    setForm((prev) => ({ ...prev, requiredCertifications: prev.requiredCertifications.includes(id) ? prev.requiredCertifications.filter((c) => c !== id) : [...prev.requiredCertifications, id] }));
  }, []);

  const handleCaptureLocation = useCallback(async () => {
    setCapturingLocation(true);
    try {
      const loc = await captureCurrentLocation();
      if (loc) {
        updateField('location', loc.formattedAddress || `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`);
      }
    } catch (err: any) { Alert.alert('Location Error', err.message || 'Could not capture location.'); } finally { setCapturingLocation(false); }
  }, [updateField]);

  const handleDateChange = useCallback((_: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (date) updateField('scheduledDate', date);
  }, [updateField]);

  const handleSubmit = useCallback(async () => {
    const errs = validateForm(form); setErrors(errs);
    setTouched(new Set(['title', 'description', 'location', 'proposedBudget', 'scheduledDate', 'jobCountry']));
    if (Object.keys(errs).length > 0) { scrollRef.current?.scrollTo({ y: 0, animated: true }); return; }
    if (!session?.user?.id) { Alert.alert('Error', 'You must be signed in to post a job.'); return; }
    
    setSubmitting(true);
    try {
      const clientPrice = parseFloat(form.proposedBudget);
      const certNames = form.requiredCertifications.map((id) => { const found = CERTIFICATIONS.find((c) => c.id === id); return found ? found.name : id; });
      
      const payload = {
        client_id: session.user.id,
        title: form.title.trim(),
        description: form.description.trim(),
        location: form.location.trim(),
        client_price_cents: toCents(clientPrice),  // ★ Task 4
        payout_amount_cents: 0,                    // ★ Task 4
        budget_type: form.budgetType,
        currency: 'USD',
        required_certifications: certNames,
        // ★ Specialty taxonomy (Phase 3). Canonical slugs from
        //   src/data/specialties.ts. Empty array is legal and means
        //   "no discipline filter" — clients can choose to leave it
        //   blank to broaden the inspector matching pool.
        specialty_slugs: form.specialtySlugs,
        // ★ JURISDICTION-002 (Phase 2). job_country is validated above
        //   and guaranteed to be a non-null α-2 code at this point.
        //   sponsorship_offered always carries a valid enum string.
        job_country: form.jobCountry,
        sponsorship_offered: form.sponsorshipOffered,
        scheduled_date: form.scheduledDate?.toISOString() ?? null,
        estimated_duration: form.estimatedDuration || null,
        urgency: form.urgency,
        status: 'pending_approval',
        // ★ CCI FLAG — Sprint 12 hotfix mirror. Boolean column on jobs.
        //   When true, the admin matching pool is restricted to inspectors
        //   holding a valid CCI tier credential.
        requires_cci: form.requiresCci,
      };
      
      const { error } = await supabase.from('jobs').insert(payload);
      if (error) throw error;
      
      setSubmitted(true);
      Alert.alert('✅ Job Posted Successfully', 'Your inspection contract has been published and is pending admin approval.', [{ text: 'View Dashboard', onPress: () => router.back() }]);
    } catch (err: any) { 
        Alert.alert('Submission Failed', err.message || 'Could not post the job. Please try again.'); 
    } finally { 
        setSubmitting(false); 
    }
  }, [form, session]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={st.root} edges={['top']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
          <View style={st.header}>
            <TouchableOpacity style={st.backBtn} onPress={() => router.back()} activeOpacity={0.7}><ArrowLeft size={22} color={C.text} strokeWidth={2.2} /></TouchableOpacity>
            <View style={st.headerCenter}><Text style={st.headerTitle}>Post Inspection Job</Text><Text style={st.headerSub}>Create a new inspection contract</Text></View>
            <View style={{ width: 42 }} />
          </View>
          
          <ScrollView ref={scrollRef} style={st.scroll} contentContainerStyle={st.scrollContent} showsVerticalScrollIndicator={false} keyboardDismissMode="on-drag">

            {/* ★ STEP 4 — Inspection-mode chooser. Default lane (Quality)
                continues below; tapping the compliance card routes to
                /post-compliance-job where the schema constraint
                jobs_compliance_requires_template kicks in. */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.push('/post-compliance-job' as any)}
              style={{
                backgroundColor: 'rgba(124,58,237,0.10)',
                borderColor: 'rgba(124,58,237,0.45)',
                borderWidth: 1,
                borderRadius: 14,
                padding: 14,
                marginBottom: 18,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <View style={{
                width: 36, height: 36, borderRadius: 10,
                backgroundColor: 'rgba(124,58,237,0.20)',
                justifyContent: 'center', alignItems: 'center',
              }}>
                <Shield size={18} color="#A78BFA" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800' }}>
                  Need a compliance verification instead?
                </Text>
                <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 2, lineHeight: 15 }}>
                  Regulator-grade affidavit, CCI-only inspectors, tamper-evident GPS evidence
                </Text>
              </View>
              <ChevronRight size={16} color="#A78BFA" />
            </TouchableOpacity>

            {/* ★ CCI FLAG — Sprint 12 hotfix · mobile parity 2026-05-20.
                Lightweight credential gate for the standard posting lane:
                when ON, the inspector matching pool is restricted to
                holders of a valid CCI tier credential. Distinct from
                the full /post-compliance-job flow above (regulator-grade
                affidavit + evidence chain). Writes jobs.requires_cci. */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => updateField('requiresCci', !form.requiresCci)}
              style={{
                backgroundColor: form.requiresCci
                  ? 'rgba(244, 196, 48, 0.10)'
                  : 'rgba(255, 255, 255, 0.02)',
                borderColor: form.requiresCci
                  ? 'rgba(244, 196, 48, 0.45)'
                  : 'rgba(255, 255, 255, 0.08)',
                borderWidth: 1,
                borderRadius: 14,
                paddingHorizontal: 14,
                paddingVertical: 12,
                marginBottom: 18,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  backgroundColor: form.requiresCci
                    ? 'rgba(244, 196, 48, 0.20)'
                    : 'rgba(255, 255, 255, 0.04)',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Shield
                  size={16}
                  color={form.requiresCci ? '#F4C430' : '#94A3B8'}
                  strokeWidth={2}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: '#FFFFFF',
                    fontSize: 12.5,
                    fontWeight: '800',
                    letterSpacing: 0.2,
                  }}
                >
                  Require CCI-certified inspector
                </Text>
                <Text
                  style={{
                    color: '#94A3B8',
                    fontSize: 10.5,
                    marginTop: 2,
                    lineHeight: 14,
                  }}
                >
                  Restrict matching to inspectors holding a valid CCI tier credential.
                </Text>
              </View>
              <View
                style={{
                  width: 36,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: form.requiresCci ? '#F4C430' : 'rgba(255,255,255,0.10)',
                  padding: 2,
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: '#FFFFFF',
                    transform: [{ translateX: form.requiresCci ? 14 : 0 }],
                  }}
                />
              </View>
            </TouchableOpacity>

            <SectionHeader icon={FileText} title="Basic Details" subtitle="Describe the inspection scope" step={1} />
            <View style={st.sectionCard}>
              <Field label="Job Title" placeholder="e.g. API 510 Pressure Vessel Inspection" value={form.title} onChangeText={(t: string) => updateField('title', t)} error={touched.has('title') ? errors.title : undefined} maxLength={120} icon={Briefcase} />
              <Field label="Description" placeholder="Describe the scope of work..." value={form.description} onChangeText={(t: string) => updateField('description', t)} error={touched.has('description') ? errors.description : undefined} multiline maxLength={2000} icon={AlignLeft} helperText="Be detailed, this helps inspectors assess the job quickly." />
              <View style={st.fieldWrap}>
                <Text style={st.fieldLabel}>Priority Level</Text>
                <View style={st.urgencyRow}>
                  {URGENCY_OPTIONS.map((opt) => {
                    const isOn = form.urgency === opt.key;
                    return (
                      <TouchableOpacity key={opt.key} style={[st.urgencyChip, isOn && { backgroundColor: opt.bg, borderColor: opt.color + '40' }]} activeOpacity={0.7} onPress={() => updateField('urgency', opt.key)}>
                        <opt.icon size={14} color={isOn ? opt.color : C.textMuted} strokeWidth={2} />
                        <Text style={[st.urgencyTxt, isOn && { color: opt.color }]}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>

            <SectionHeader icon={Target} title="Specialties" subtitle="Disciplines this job covers" step={2} />
            <View style={st.sectionCard}>
              <SpecialtyPicker
                value={form.specialtySlugs}
                onChange={(next) => setForm((prev) => ({ ...prev, specialtySlugs: next }))}
                maxSelections={8}
                helperText="Pick the inspection disciplines this job requires. Used to surface the job to inspectors with matching specialties."
              />
            </View>

            <SectionHeader icon={Award} title="Requirements" subtitle="Certifications & experience needed" step={3} />
            <View style={st.sectionCard}>
              <View style={st.fieldWrap}>
                <Text style={st.fieldLabel}>Required Certifications</Text>
                <TouchableOpacity style={st.selectorBtn} activeOpacity={0.7} onPress={() => setShowCertModal(true)}>
                  <Award size={16} color={C.primary} strokeWidth={2} />
                  <Text style={st.selectorBtnTxt}>{form.requiredCertifications.length > 0 ? `${form.requiredCertifications.length} selected` : 'Select certifications...'}</Text>
                  <ChevronRight size={16} color={C.textMuted} strokeWidth={2} />
                </TouchableOpacity>
                {form.requiredCertifications.length > 0 && (
                  <View style={st.selectedChipsWrap}>
                    {form.requiredCertifications.map((id) => {
                      const cert = CERTIFICATIONS.find((c) => c.id === id);
                      return (
                        <TouchableOpacity key={id} style={st.selectedChip} activeOpacity={0.7} onPress={() => toggleCert(id)}>
                          <Text style={st.selectedChipTxt}>{cert?.name ?? id}</Text><X size={12} color={C.primary} strokeWidth={2.5} />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
              <View style={st.fieldWrap}>
                <Text style={st.fieldLabel}>Estimated Duration</Text>
                <TouchableOpacity style={st.selectorBtn} activeOpacity={0.7} onPress={() => setShowDurationModal(true)}>
                  <Clock size={16} color={C.primary} strokeWidth={2} />
                  <Text style={st.selectorBtnTxt}>{form.estimatedDuration || 'Select duration...'}</Text>
                  <ChevronDown size={16} color={C.textMuted} strokeWidth={2} />
                </TouchableOpacity>
              </View>
            </View>

            <SectionHeader icon={MapPin} title="Location & Schedule" subtitle="Where and when the inspection takes place" step={4} />
            <View style={st.sectionCard}>
              <View style={st.fieldWrap}>
                <Text style={st.fieldLabel}>Job Site Location</Text>
                <View style={[st.inputRow, touched.has('location') && errors.location ? st.inputRowError : null]}>
                  <MapPin size={16} color={errors.location && touched.has('location') ? C.error : C.textMuted} strokeWidth={2} style={{ marginRight: 8 }} />
                  <TextInput style={st.input} placeholder="Enter address or capture GPS" placeholderTextColor={C.textMuted} value={form.location} onChangeText={(t) => updateField('location', t)} />
                </View>
                <TouchableOpacity style={st.gpsBtn} activeOpacity={0.7} onPress={handleCaptureLocation} disabled={capturingLocation}>
                  {capturingLocation ? <ActivityIndicator size="small" color={C.primary} /> : <Navigation size={14} color={C.primary} strokeWidth={2} />}
                  <Text style={st.gpsBtnTxt}>{capturingLocation ? 'Capturing...' : 'Use Current Location'}</Text>
                </TouchableOpacity>
                {touched.has('location') && errors.location && <View style={st.errorRow}><AlertCircle size={12} color={C.error} strokeWidth={2} /><Text style={st.errorTxt}>{errors.location}</Text></View>}
              </View>
              <View style={st.fieldWrap}>
                <Text style={st.fieldLabel}>Expected Start Date</Text>
                <TouchableOpacity style={st.selectorBtn} activeOpacity={0.7} onPress={() => setShowDatePicker(true)}>
                  <Calendar size={16} color={C.primary} strokeWidth={2} />
                  <Text style={st.selectorBtnTxt}>{form.scheduledDate ? form.scheduledDate.toLocaleDateString() : 'Select start date...'}</Text>
                  <ChevronDown size={16} color={C.textMuted} strokeWidth={2} />
                </TouchableOpacity>
                {form.scheduledDate && <TouchableOpacity style={st.clearDateBtn} onPress={() => updateField('scheduledDate', null)}><X size={12} color={C.textMuted} strokeWidth={2} /><Text style={st.clearDateTxt}>Clear date</Text></TouchableOpacity>}
              </View>
              {showDatePicker && (
                <View style={st.datePickerWrap}>
                  <DateTimePicker value={form.scheduledDate || new Date()} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} minimumDate={new Date()} onChange={handleDateChange} textColor={C.text} themeVariant="dark" />
                  {Platform.OS === 'ios' && <TouchableOpacity style={st.datePickerDone} onPress={() => setShowDatePicker(false)}><Text style={st.datePickerDoneTxt}>Done</Text></TouchableOpacity>}
                </View>
              )}
            </View>

            {/* ★ JURISDICTION-002 (Phase 2) — Jurisdiction & Travel. */}
            <SectionHeader icon={Shield} title="Jurisdiction & Travel" subtitle="Where the work happens & who handles paperwork" step={5} />
            <View style={st.sectionCard}>
              <View style={st.fieldWrap}>
                <CountryPicker
                  mode="single"
                  value={form.jobCountry}
                  onChange={(next) => updateField('jobCountry', next)}
                  label="Job Country"
                  helperText="Where the inspection physically takes place. Required."
                  searchPlaceholder="Search countries…"
                />
                {touched.has('jobCountry') && errors.jobCountry && (
                  <View style={st.errorRow}>
                    <AlertCircle size={12} color={C.error} strokeWidth={2} />
                    <Text style={st.errorTxt}>{errors.jobCountry}</Text>
                  </View>
                )}
              </View>

              <View style={st.fieldWrap}>
                <Text style={st.fieldLabel}>Sponsorship Policy</Text>
                <View style={st.budgetTypeRow}>
                  {SPONSORSHIP_OPTIONS.map((opt) => {
                    const isOn = form.sponsorshipOffered === opt.key;
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        style={[st.budgetTypeBtn, isOn && st.budgetTypeBtnOn]}
                        activeOpacity={0.7}
                        onPress={() => updateField('sponsorshipOffered', opt.key)}
                      >
                        <Text style={[st.budgetTypeLbl, isOn && st.budgetTypeLblOn]}>{opt.label}</Text>
                        <Text style={[st.budgetTypeDesc, isOn && st.budgetTypeDescOn]}>{opt.desc}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>

            <SectionHeader icon={DollarSign} title="Budget & Payment" subtitle="Set your pricing structure" step={6} />
            <View style={st.sectionCard}>
              <View style={st.fieldWrap}>
                <Text style={st.fieldLabel}>Budget Type</Text>
                <View style={st.budgetTypeRow}>
                  {BUDGET_TYPES.map((bt) => {
                    const isOn = form.budgetType === bt.key;
                    return (
                      <TouchableOpacity key={bt.key} style={[st.budgetTypeBtn, isOn && st.budgetTypeBtnOn]} activeOpacity={0.7} onPress={() => updateField('budgetType', bt.key)}>
                        <Text style={[st.budgetTypeLbl, isOn && st.budgetTypeLblOn]}>{bt.label}</Text>
                        <Text style={[st.budgetTypeDesc, isOn && st.budgetTypeDescOn]}>{bt.desc}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* 🔴 THE FIX IS HERE: SINGLE PROPOSED BUDGET FIELD */}
              <View style={st.fieldWrap}>
                <Text style={st.fieldLabel}>
                  {form.budgetType === 'hourly'
                    ? 'Hourly Rate'
                    : form.budgetType === 'daily'
                    ? 'Daily Rate'
                    : 'Proposed Budget (Total)'}
                </Text>
                <View style={[st.inputRow, touched.has('proposedBudget') && errors.proposedBudget ? st.inputRowError : null]}>
                  <Text style={st.inputPrefix}>$</Text>
                  <TextInput 
                    style={st.input} 
                    placeholder="0.00" 
                    placeholderTextColor={C.textMuted} 
                    value={form.proposedBudget} 
                    onChangeText={(t) => updateField('proposedBudget', t)} 
                    keyboardType="decimal-pad" 
                  />
                  <Text style={st.inputSuffix}>
                    {form.budgetType === 'hourly'
                      ? 'USD / hr'
                      : form.budgetType === 'daily'
                      ? 'USD / day'
                      : 'USD'}
                  </Text>
                </View>
                {form.budgetType !== 'fixed' && !(touched.has('proposedBudget') && errors.proposedBudget) ? (
                  <Text style={st.helperTxt}>
                    {form.budgetType === 'hourly' ? 'Rate per hour.' : 'Rate per day.'} NEXPEC estimates the total from your Estimated Duration and finalizes it on review.
                  </Text>
                ) : null}
                {touched.has('proposedBudget') && errors.proposedBudget && (
                  <View style={st.errorRow}>
                    <AlertCircle size={12} color={C.error} strokeWidth={2} />
                    <Text style={st.errorTxt}>{errors.proposedBudget}</Text>
                  </View>
                )}
              </View>

            </View>

            <View style={st.submitSection}>
              <TouchableOpacity style={[st.submitBtn, (submitting || submitted) && st.submitBtnDisabled]} activeOpacity={0.8} onPress={handleSubmit} disabled={submitting || submitted}>
                {submitting ? <ActivityIndicator size="small" color={C.text} /> : submitted ? <><CheckCircle size={20} color={C.text} strokeWidth={2.5} /><Text style={st.submitBtnTxt}>Job Posted</Text></> : <><Briefcase size={18} color={C.text} strokeWidth={2.5} /><Text style={st.submitBtnTxt}>Post Inspection Job</Text></>}
              </TouchableOpacity>
              <Text style={st.submitDisclaimer}>By posting, you agree to NEXPEC's Terms of Service. Your job will be reviewed by admin before publishing.</Text>
            </View>
            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>

        <CertModal visible={showCertModal} selected={form.requiredCertifications} onToggle={toggleCert} onClose={() => setShowCertModal(false)} />
        <DurationModal visible={showDurationModal} value={form.estimatedDuration} onSelect={(d: string) => updateField('estimatedDuration', d)} onClose={() => setShowDurationModal(false)} />
      </SafeAreaView>
    </>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', marginHorizontal: 12 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.text, letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  scroll: { flex: 1 }, scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20 },
  sectionHdr: { flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 12, gap: 10 },
  sectionHdrLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionIconWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.primaryMuted, alignItems: 'center', justifyContent: 'center' },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBadge: { width: 20, height: 20, borderRadius: 6, backgroundColor: C.primaryMuted, borderWidth: 1, borderColor: C.primaryBorder, alignItems: 'center', justifyContent: 'center' },
  stepBadgeTxt: { fontSize: 10, fontWeight: '800', color: C.primary },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text, letterSpacing: -0.2 },
  sectionSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  sectionCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 16 },
  fieldWrap: { marginBottom: 18 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: C.textSec, marginBottom: 8, letterSpacing: 0.1 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, minHeight: 48 },
  inputRowMulti: { minHeight: 120, alignItems: 'flex-start', paddingTop: 12 },
  inputRowError: { borderColor: C.error + '80' },
  input: { flex: 1, fontSize: 14, fontWeight: '500', color: C.text, paddingVertical: Platform.OS === 'ios' ? 12 : 8 },
  inputMulti: { minHeight: 96, textAlignVertical: 'top' },
  inputPrefix: { fontSize: 14, fontWeight: '600', color: C.textMuted, marginRight: 4 },
  inputSuffix: { fontSize: 11, fontWeight: '600', color: C.textMuted, marginLeft: 6 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  errorTxt: { fontSize: 12, fontWeight: '500', color: C.error },
  helperTxt: { fontSize: 11, color: C.textMuted, marginTop: 6, lineHeight: 16 },
  charCount: { fontSize: 10, color: C.textMuted, textAlign: 'right', marginTop: 4, fontVariant: ['tabular-nums'] },
  selectorBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, gap: 10 },
  selectorBtnTxt: { flex: 1, fontSize: 14, fontWeight: '500', color: C.textSec },
  selectedChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  selectedChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primaryMuted, borderWidth: 1, borderColor: C.primaryBorder, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  selectedChipTxt: { fontSize: 12, fontWeight: '600', color: C.primary },
  gpsBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: C.primaryMuted },
  gpsBtnTxt: { fontSize: 12, fontWeight: '600', color: C.primary },
  clearDateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, alignSelf: 'flex-start' },
  clearDateTxt: { fontSize: 12, color: C.textMuted },
  datePickerWrap: { backgroundColor: C.cardAlt, borderRadius: 14, borderWidth: 1, borderColor: C.border, marginTop: 10, overflow: 'hidden' },
  datePickerDone: { alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.border },
  datePickerDoneTxt: { fontSize: 15, fontWeight: '600', color: C.primary },
  urgencyRow: { flexDirection: 'row', gap: 8 },
  urgencyChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border },
  urgencyTxt: { fontSize: 12, fontWeight: '600', color: C.textMuted },
  budgetTypeRow: { gap: 8 },
  budgetTypeBtn: { backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, marginBottom: 8 },
  budgetTypeBtnOn: { backgroundColor: C.primaryMuted, borderColor: C.primaryBorder },
  budgetTypeLbl: { fontSize: 14, fontWeight: '600', color: C.textSec },
  budgetTypeLblOn: { color: C.primary },
  budgetTypeDesc: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  budgetTypeDescOn: { color: C.textSec },
  submitSection: { marginTop: 28, marginBottom: 12 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 18, ...Platform.select({ ios: { shadowColor: C.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 14 }, android: { elevation: 8 } }) },
  submitBtnDisabled: { backgroundColor: C.textMuted, shadowOpacity: 0, elevation: 0 },
  submitBtnTxt: { fontSize: 16, fontWeight: '700', color: C.text, letterSpacing: 0.3 },
  submitDisclaimer: { fontSize: 11, color: C.textMuted, textAlign: 'center', marginTop: 14, lineHeight: 16, paddingHorizontal: 20 },
  modalRoot: { flex: 1, backgroundColor: C.bg },
  modalHdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 17, fontWeight: '700', color: C.text, letterSpacing: -0.3 },
  modalCountBadge: { backgroundColor: C.primaryMuted, borderWidth: 1, borderColor: C.primaryBorder, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  modalCountTxt: { fontSize: 13, fontWeight: '700', color: C.primary },
  modalSearchWrap: { paddingHorizontal: 16, paddingVertical: 10 },
  modalSearchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, height: 44, gap: 10 },
  modalSearchInput: { flex: 1, fontSize: 14, color: C.text },
  catChipsWrap: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  catChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  catChipOn: { backgroundColor: C.primaryMuted, borderColor: C.primaryBorder },
  catChipTxt: { fontSize: 12, fontWeight: '600', color: C.textMuted },
  catChipTxtOn: { color: C.primary },
  modalScroll: { flex: 1 }, modalScrollContent: { padding: 16, paddingBottom: 40 },
  modalFooter: { paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.border },
  modalDoneBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalDoneTxt: { fontSize: 15, fontWeight: '700', color: C.text },
  certRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, marginBottom: 8, gap: 12 },
  certRowOn: { borderColor: C.primaryBorder, backgroundColor: C.primaryMuted },
  certInfo: { flex: 1 }, certNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  certName: { fontSize: 14, fontWeight: '700', color: C.text },
  certCatBadge: { backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  certCatTxt: { fontSize: 9, fontWeight: '600', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  certDesc: { fontSize: 12, color: C.textMuted },
  certCheck: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.inputBg, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  certCheckOn: { backgroundColor: C.primary, borderColor: C.primary },
  durationRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, marginBottom: 8 },
  durationRowOn: { borderColor: C.primaryBorder, backgroundColor: C.primaryMuted },
  durationTxt: { flex: 1, fontSize: 14, fontWeight: '500', color: C.textSec },
  durationTxtOn: { color: C.primary, fontWeight: '600' },
});