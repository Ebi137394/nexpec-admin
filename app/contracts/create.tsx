// app/contracts/create.tsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  NEXPEC — Draft a New Contract
//
//  Client-side flow:
//    1. Pick one of your open / assigned jobs.
//    2. Pick a contractor (the assigned one + any applicants
//       from the proposals table).
//    3. Enter total amount + start/end dates.
//    4. Save as draft → row inserted into `contracts` with
//       status = 'draft'. Hub's realtime subscription picks it up.
//
//  Note: this screen writes `start_date` and `end_date` columns
//  to the contracts row. Run the ALTER TABLE in the post-message
//  notes once before relying on date persistence.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  FlatList,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import RNAnimated, { FadeInDown } from 'react-native-reanimated';
import {
  ArrowLeft,
  X,
  Briefcase,
  User2,
  DollarSign,
  CalendarDays,
  ChevronRight,
  Check,
  Sparkles,
  MapPin,
  AlertCircle,
  PenLine,
  Building2,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { toCents } from '@/lib/money';

// ─────────────────────────────────────────────────────────────
//  BRAND
// ─────────────────────────────────────────────────────────────
const C = {
  bg: '#020420',
  primary: '#7C3AED',
  primaryDeep: '#5B21B6',
  primaryBright: '#9333EA',
  primaryGlow: 'rgba(124, 58, 237, 0.22)',

  cyan: '#00FFFF',
  cyanDeep: '#06B6D4',
  cyanGlow: 'rgba(0, 255, 255, 0.16)',
  cyanBorder: 'rgba(0, 255, 255, 0.30)',

  surface: 'rgba(255, 255, 255, 0.03)',
  surfaceElev: '#0A0E2E',
  surfaceCard: '#0E1438',
  surfaceModal: '#0B0F2C',
  border: 'rgba(255, 255, 255, 0.06)',
  borderStrong: 'rgba(124, 58, 237, 0.32)',

  text: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textDim: '#475569',

  success: '#10F995',
  warning: '#F59E0B',
  danger: '#EF4444',
  pink: '#F472B6',
};

// ─────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────
type JobStatus = 'open' | 'assigned' | 'in_progress' | 'completed';

interface JobLite {
  id: string;
  title: string | null;
  status: JobStatus | string | null;
  location: string | null;
  contractor_id: string | null;
  daily_rate?: number | null;
  duration_days?: number | null;
  total_amount_cents?: number | null;     // ★ Task 4
  budget_cents?: number | null;           // ★ Task 4
}

interface ContractorLite {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string | null;
  company_name: string | null;
  _assigned?: boolean;
}

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────
const initialsFor = (name?: string | null): string => {
  if (!name) return '○';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '○';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const roleColor = (role?: string | null): string => {
  const r = (role || '').toLowerCase();
  if (r.includes('inspector')) return C.primary;
  if (r.includes('client'))    return '#3B82F6';
  if (r.includes('agency'))    return C.success;
  return C.textMuted;
};

const isValidIsoDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  // Round-trip check catches things like 2025-02-31
  const back = d.toISOString().slice(0, 10);
  return back === s;
};

const todayIso = (): string => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

const addDaysIso = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

// ─────────────────────────────────────────────────────────────
//  SCREEN
// ─────────────────────────────────────────────────────────────
export default function CreateContractScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth() as any;
  const userId: string | null = user?.id ?? null;

  // ── State ──
  const [jobs, setJobs] = useState<JobLite[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);

  const [selectedJob, setSelectedJob] = useState<JobLite | null>(null);

  const [contractors, setContractors] = useState<ContractorLite[]>([]);
  const [loadingContractors, setLoadingContractors] = useState(false);
  const [selectedContractor, setSelectedContractor] =
    useState<ContractorLite | null>(null);

  const [amount, setAmount] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [showJobPicker, setShowJobPicker] = useState(false);
  const [showContractorPicker, setShowContractorPicker] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  // ── Fetch the client's open / assigned jobs ──
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!userId) {
        setLoadingJobs(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('jobs')
          .select(
            'id, title, status, location, contractor_id, daily_rate, duration_days, total_amount_cents, budget_cents',
          )
          .eq('client_id', userId)
          .in('status', ['open', 'assigned'])
          .order('created_at', { ascending: false });
        if (!alive) return;
        if (error) throw error;
        setJobs((data ?? []) as JobLite[]);
      } catch (err) {
        console.log('contracts/create — jobs fetch error', err);
      } finally {
        if (alive) setLoadingJobs(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  // ── Whenever the picked job changes, refresh contractor options ──
  const fetchContractorsForJob = useCallback(async (job: JobLite) => {
    setLoadingContractors(true);
    try {
      const list: ContractorLite[] = [];

      // 1) The job's already-assigned contractor (if any) — comes first.
      if (job.contractor_id) {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('id, full_name, avatar_url, role, company_name')
            .eq('id', job.contractor_id)
            .maybeSingle();
          if (data) list.push({ ...(data as ContractorLite), _assigned: true });
        } catch {
          /* tolerate */
        }
      }

      // 2) Anyone who has applied via the proposals table.
      try {
        const { data: proposals } = await supabase
          .from('proposals')
          .select(
            'contractor_id, status, contractor:contractor_id ( id, full_name, avatar_url, role, company_name )',
          )
          .eq('job_id', job.id);

        for (const p of (proposals ?? []) as any[]) {
          const profile = Array.isArray(p.contractor)
            ? p.contractor[0]
            : p.contractor;
          if (profile && !list.find((c) => c.id === profile.id)) {
            list.push(profile as ContractorLite);
          }
        }
      } catch {
        /* proposals table might be named differently — not fatal */
      }

      setContractors(list);
    } finally {
      setLoadingContractors(false);
    }
  }, []);

  useEffect(() => {
    if (selectedJob) {
      fetchContractorsForJob(selectedJob);
    } else {
      setContractors([]);
    }
    // Reset contractor pick when the job changes.
    setSelectedContractor(null);
  }, [selectedJob, fetchContractorsForJob]);

  // ── Helpful prefills when a job is picked ──
  useEffect(() => {
    if (!selectedJob) return;
    // ★ Task 4: prefill the amount input in dollars (input expects dollars).
    //   total_amount_cents and budget_cents are integer cents → ÷100.
    if (!amount) {
      const computedCents =
        selectedJob.total_amount_cents ??
        (selectedJob.daily_rate && selectedJob.duration_days
          ? Number(selectedJob.daily_rate) * Number(selectedJob.duration_days) * 100
          : selectedJob.budget_cents);
      const computedDollars = computedCents != null ? Number(computedCents) / 100 : null;
      if (computedDollars && Number.isFinite(computedDollars)) {
        setAmount(String(Math.round(computedDollars)));
      }
    }
    // Default start = today, end = +30d, but only if both are blank
    // so we don't clobber what the user has typed.
    if (!startDate && !endDate) {
      const t = todayIso();
      setStartDate(t);
      setEndDate(addDaysIso(t, 30));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJob]);

  // ── Validation ──
  const validation = useMemo(() => {
    const v: { ok: boolean; reason?: string } = { ok: true };
    if (!selectedJob) return { ok: false, reason: 'Pick a job first.' };
    if (!selectedContractor)
      return { ok: false, reason: 'Pick a contractor.' };
    const amt = Number(amount);
    if (!amount || !Number.isFinite(amt) || amt <= 0)
      return { ok: false, reason: 'Enter a valid amount.' };
    if (!isValidIsoDate(startDate))
      return { ok: false, reason: 'Start date must be YYYY-MM-DD.' };
    if (!isValidIsoDate(endDate))
      return { ok: false, reason: 'End date must be YYYY-MM-DD.' };
    if (new Date(endDate) <= new Date(startDate))
      return { ok: false, reason: 'End date must be after start date.' };
    return v;
  }, [selectedJob, selectedContractor, amount, startDate, endDate]);

  // ── Submit: insert row with status = 'draft' ──
  const onDraft = useCallback(async () => {
    if (!validation.ok || submitting || !userId) return;
    if (!selectedJob || !selectedContractor) return;

    setSubmitting(true);
    try {
      const payload = {
        job_id: selectedJob.id,
        client_id: userId,
        contractor_id: selectedContractor.id,
        total_amount_cents: toCents(amount),  // ★ Task 4
        start_date: startDate,
        end_date: endDate,
        status: 'draft',
      };

      const { data, error } = await supabase
        .from('contracts')
        .insert(payload)
        .select('id')
        .single();

      if (error) throw error;

      Alert.alert(
        'Draft saved ✓',
        'Your contract draft is in the Pending tab. Add content and sign when ready.',
        [
          {
            text: 'Open Hub',
            onPress: () => {
              try {
                router.replace('/contracts' as any);
              } catch {
                router.back();
              }
            },
          },
        ],
      );
    } catch (err: any) {
      const msg: string = err?.message ?? 'Could not save the draft.';
      // Friendly hint when the schema is missing the date columns.
      if (
        /column .*start_date|column .*end_date/i.test(msg) ||
        /could not find the .*column/i.test(msg)
      ) {
        Alert.alert(
          'Schema needs updating',
          'Your contracts table is missing start_date / end_date columns. Run the ALTER TABLE migration in the post-message notes, then try again.',
        );
      } else {
        Alert.alert('Save failed', msg);
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    validation,
    submitting,
    userId,
    selectedJob,
    selectedContractor,
    amount,
    startDate,
    endDate,
    router,
  ]);

  // ── Render ──
  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View pointerEvents="none" style={s.glowTopLeft} />
      <View pointerEvents="none" style={s.glowMidRight} />

      <SafeAreaView style={s.flex1} edges={['top']}>
        <KeyboardAvoidingView
          style={s.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
        >
          {/* HEADER */}
          <RNAnimated.View
            entering={FadeInDown.duration(380)}
            style={s.header}
          >
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}
              hitSlop={8}
            >
              <ArrowLeft size={20} color={C.text} />
            </Pressable>
            <View style={s.headerCenter}>
              <Text style={s.headerKicker}>NEW CONTRACT</Text>
              <Text style={s.headerTitle}>Draft an agreement</Text>
            </View>
            <View style={s.iconBtn}>
              <PenLine size={18} color={C.cyan} />
            </View>
          </RNAnimated.View>

          <ScrollView
            contentContainerStyle={[
              s.scrollContent,
              { paddingBottom: insets.bottom + 140 },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* STEP 1 — JOB */}
            <Section
              index={1}
              title="Pick a job"
              subtitle="Only your open and assigned jobs are shown."
              delay={60}
            >
              <PickerField
                placeholder={
                  loadingJobs ? 'Loading your jobs…' : 'Tap to choose a job'
                }
                icon={<Briefcase size={16} color={C.textSecondary} />}
                onPress={() => !loadingJobs && setShowJobPicker(true)}
                value={
                  selectedJob ? (
                    <View style={s.pickerValueRow}>
                      <Text style={s.pickerValueText} numberOfLines={1}>
                        {selectedJob.title || 'Untitled job'}
                      </Text>
                      {selectedJob.location ? (
                        <View style={s.pickerInlineMeta}>
                          <MapPin size={11} color={C.textMuted} />
                          <Text
                            style={s.pickerInlineMetaText}
                            numberOfLines={1}
                          >
                            {selectedJob.location}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null
                }
              />
            </Section>

            {/* STEP 2 — CONTRACTOR */}
            <Section
              index={2}
              title="Choose a contractor"
              subtitle="Pick from the assigned inspector and any applicants."
              delay={120}
              disabled={!selectedJob}
            >
              <PickerField
                placeholder={
                  !selectedJob
                    ? 'Select a job first'
                    : loadingContractors
                    ? 'Loading applicants…'
                    : contractors.length === 0
                    ? 'No applicants yet'
                    : 'Tap to choose a contractor'
                }
                icon={<User2 size={16} color={C.textSecondary} />}
                onPress={() =>
                  selectedJob &&
                  contractors.length > 0 &&
                  setShowContractorPicker(true)
                }
                disabled={
                  !selectedJob || loadingContractors || contractors.length === 0
                }
                value={
                  selectedContractor ? (
                    <ContractorChip contractor={selectedContractor} compact />
                  ) : null
                }
              />
            </Section>

            {/* STEP 3 — AMOUNT */}
            <Section
              index={3}
              title="Total contract amount"
              subtitle="What is the agreed total payout in USD?"
              delay={180}
            >
              <View style={s.inputWrap}>
                <DollarSign size={16} color={C.textSecondary} />
                <TextInput
                  value={amount}
                  onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))}
                  placeholder="0"
                  placeholderTextColor={C.textDim}
                  keyboardType="decimal-pad"
                  style={s.inputText}
                  maxLength={10}
                />
                <Text style={s.inputSuffix}>USD</Text>
              </View>
            </Section>

            {/* STEP 4 — DATES */}
            <Section
              index={4}
              title="Engagement window"
              subtitle="Use the YYYY-MM-DD format. We'll validate it for you."
              delay={240}
            >
              <View style={s.dateRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>START</Text>
                  <View
                    style={[
                      s.inputWrap,
                      startDate && !isValidIsoDate(startDate)
                        ? s.inputWrapErr
                        : null,
                    ]}
                  >
                    <CalendarDays size={16} color={C.textSecondary} />
                    <TextInput
                      value={startDate}
                      onChangeText={setStartDate}
                      placeholder="2025-05-09"
                      placeholderTextColor={C.textDim}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={s.inputText}
                      maxLength={10}
                    />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>END</Text>
                  <View
                    style={[
                      s.inputWrap,
                      endDate && !isValidIsoDate(endDate)
                        ? s.inputWrapErr
                        : null,
                    ]}
                  >
                    <CalendarDays size={16} color={C.textSecondary} />
                    <TextInput
                      value={endDate}
                      onChangeText={setEndDate}
                      placeholder="2025-06-08"
                      placeholderTextColor={C.textDim}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={s.inputText}
                      maxLength={10}
                    />
                  </View>
                </View>
              </View>

              {/* Quick presets */}
              <View style={s.presetsRow}>
                <PresetChip
                  label="Today → +30d"
                  onPress={() => {
                    const t = todayIso();
                    setStartDate(t);
                    setEndDate(addDaysIso(t, 30));
                  }}
                />
                <PresetChip
                  label="+60d"
                  onPress={() => {
                    if (isValidIsoDate(startDate)) {
                      setEndDate(addDaysIso(startDate, 60));
                    }
                  }}
                />
                <PresetChip
                  label="+90d"
                  onPress={() => {
                    if (isValidIsoDate(startDate)) {
                      setEndDate(addDaysIso(startDate, 90));
                    }
                  }}
                />
              </View>
            </Section>

            {/* VALIDATION HINT */}
            {!validation.ok && validation.reason ? (
              <View style={s.hintRow}>
                <AlertCircle size={13} color={C.warning} />
                <Text style={s.hintText}>{validation.reason}</Text>
              </View>
            ) : (
              <View style={s.readyRow}>
                <Sparkles size={13} color={C.success} />
                <Text style={s.readyText}>Ready to save as draft</Text>
              </View>
            )}
          </ScrollView>

          {/* BOTTOM CTA */}
          <View
            style={[
              s.bottomBar,
              { paddingBottom: Math.max(insets.bottom, 12) },
            ]}
          >
            <Pressable
              onPress={onDraft}
              disabled={!validation.ok || submitting}
              style={({ pressed }) => [
                s.cta,
                (!validation.ok || submitting) && s.ctaDisabled,
                pressed && validation.ok && { transform: [{ scale: 0.99 }] },
              ]}
            >
              {validation.ok && !submitting ? (
                <LinearGradient
                  colors={[C.primary, C.primaryBright, C.primaryDeep]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <PenLine size={16} color="#FFFFFF" />
              )}
              <Text style={s.ctaText}>
                {submitting ? 'Saving draft…' : 'Save as Draft'}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* JOB PICKER MODAL */}
      <PickerSheet
        visible={showJobPicker}
        title="Pick a job"
        subtitle={`${jobs.length} open or assigned`}
        onClose={() => setShowJobPicker(false)}
      >
        {loadingJobs ? (
          <View style={s.modalLoading}>
            <ActivityIndicator color={C.primary} />
          </View>
        ) : jobs.length === 0 ? (
          <ModalEmpty
            title="No eligible jobs"
            sub="Only jobs with status open or assigned can become contracts."
          />
        ) : (
          <FlatList
            data={jobs}
            keyExtractor={(j) => j.id}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
            renderItem={({ item }) => (
              <JobOptionRow
                job={item}
                selected={selectedJob?.id === item.id}
                onPress={() => {
                  setSelectedJob(item);
                  setShowJobPicker(false);
                }}
              />
            )}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          />
        )}
      </PickerSheet>

      {/* CONTRACTOR PICKER MODAL */}
      <PickerSheet
        visible={showContractorPicker}
        title="Choose a contractor"
        subtitle={`${contractors.length} option${
          contractors.length === 1 ? '' : 's'
        } for this job`}
        onClose={() => setShowContractorPicker(false)}
      >
        {loadingContractors ? (
          <View style={s.modalLoading}>
            <ActivityIndicator color={C.primary} />
          </View>
        ) : contractors.length === 0 ? (
          <ModalEmpty
            title="No applicants yet"
            sub="Once an inspector or agency applies, they'll appear here."
          />
        ) : (
          <FlatList
            data={contractors}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
            renderItem={({ item }) => (
              <ContractorOptionRow
                contractor={item}
                selected={selectedContractor?.id === item.id}
                onPress={() => {
                  setSelectedContractor(item);
                  setShowContractorPicker(false);
                }}
              />
            )}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          />
        )}
      </PickerSheet>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
//  SUBCOMPONENTS
// ─────────────────────────────────────────────────────────────

const Section = ({
  index,
  title,
  subtitle,
  children,
  delay = 0,
  disabled = false,
}: {
  index: number;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  delay?: number;
  disabled?: boolean;
}) => (
  <RNAnimated.View
    entering={FadeInDown.delay(delay).duration(400)}
    style={[s.section, disabled && { opacity: 0.55 }]}
  >
    <View style={s.sectionTitleRow}>
      <View style={s.sectionStep}>
        <Text style={s.sectionStepText}>{index}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.sectionTitle}>{title}</Text>
        <Text style={s.sectionSubtitle}>{subtitle}</Text>
      </View>
    </View>
    {children}
  </RNAnimated.View>
);

const PickerField = ({
  icon,
  placeholder,
  onPress,
  value,
  disabled,
}: {
  icon: React.ReactNode;
  placeholder: string;
  onPress?: () => void;
  value?: React.ReactNode;
  disabled?: boolean;
}) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => [
      s.pickerField,
      disabled && s.pickerFieldDisabled,
      pressed && !disabled && { opacity: 0.85 },
    ]}
  >
    {icon}
    <View style={{ flex: 1 }}>
      {value ? (
        value
      ) : (
        <Text style={s.pickerPlaceholder} numberOfLines={1}>
          {placeholder}
        </Text>
      )}
    </View>
    <ChevronRight size={16} color={C.textMuted} />
  </Pressable>
);

const PresetChip = ({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [s.presetChip, pressed && { opacity: 0.7 }]}
  >
    <Text style={s.presetChipText}>{label}</Text>
  </Pressable>
);

const PickerSheet = ({
  visible,
  title,
  subtitle,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) => {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={s.modalOverlay}>
        <Pressable style={s.modalBackdrop} onPress={onClose} />
        <View
          style={[
            s.modalSheet,
            { paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          <View style={s.modalHandle} />
          <View style={s.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.modalTitle}>{title}</Text>
              <Text style={s.modalSubtitle}>{subtitle}</Text>
            </View>
            <Pressable
              onPress={onClose}
              style={s.modalClose}
              hitSlop={8}
            >
              <X size={18} color={C.textSecondary} />
            </Pressable>
          </View>
          <View style={{ flex: 1 }}>{children}</View>
        </View>
      </View>
    </Modal>
  );
};

const ModalEmpty = ({ title, sub }: { title: string; sub: string }) => (
  <View style={s.modalEmpty}>
    <View style={s.modalEmptyIcon}>
      <Sparkles size={22} color={C.primary} />
    </View>
    <Text style={s.modalEmptyTitle}>{title}</Text>
    <Text style={s.modalEmptySub}>{sub}</Text>
  </View>
);

const JobOptionRow = ({
  job,
  selected,
  onPress,
}: {
  job: JobLite;
  selected: boolean;
  onPress: () => void;
}) => {
  const status = (job.status || '').toString();
  const statusColor =
    status === 'assigned' ? C.cyan : status === 'open' ? C.primary : C.textMuted;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.optionRow,
        selected && s.optionRowSelected,
        pressed && { transform: [{ scale: 0.997 }] },
      ]}
    >
      <View style={[s.optionIcon, { backgroundColor: statusColor + '22' }]}>
        <Briefcase size={16} color={statusColor} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.optionTitle} numberOfLines={1}>
          {job.title || 'Untitled job'}
        </Text>
        <View style={s.optionMetaRow}>
          <View
            style={[
              s.optionStatusPill,
              {
                backgroundColor: statusColor + '22',
                borderColor: statusColor + '55',
              },
            ]}
          >
            <Text
              style={[s.optionStatusText, { color: statusColor }]}
              numberOfLines={1}
            >
              {status.toUpperCase()}
            </Text>
          </View>
          {job.location ? (
            <Text style={s.optionMetaText} numberOfLines={1}>
              {job.location}
            </Text>
          ) : null}
        </View>
      </View>
      {selected ? (
        <View style={s.optionCheck}>
          <Check size={14} color="#FFFFFF" />
        </View>
      ) : (
        <ChevronRight size={14} color={C.textMuted} />
      )}
    </Pressable>
  );
};

const ContractorOptionRow = ({
  contractor,
  selected,
  onPress,
}: {
  contractor: ContractorLite;
  selected: boolean;
  onPress: () => void;
}) => {
  const color = roleColor(contractor.role);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.optionRow,
        selected && s.optionRowSelected,
        pressed && { transform: [{ scale: 0.997 }] },
      ]}
    >
      {contractor.avatar_url ? (
        <Image
          source={{ uri: contractor.avatar_url }}
          style={s.optionAvatar}
        />
      ) : (
        <View
          style={[
            s.optionAvatar,
            s.optionAvatarFallback,
            { backgroundColor: color + '33' },
          ]}
        >
          <Text style={s.optionAvatarText}>
            {initialsFor(contractor.full_name)}
          </Text>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.optionTitle} numberOfLines={1}>
          {contractor.full_name ||
            contractor.company_name ||
            'Unnamed contractor'}
        </Text>
        <View style={s.optionMetaRow}>
          <View
            style={[
              s.optionStatusPill,
              {
                backgroundColor: color + '22',
                borderColor: color + '55',
              },
            ]}
          >
            <Text
              style={[s.optionStatusText, { color }]}
              numberOfLines={1}
            >
              {(contractor.role || 'CONTRACTOR').toUpperCase()}
            </Text>
          </View>
          {contractor._assigned ? (
            <View style={s.optionAssignedPill}>
              <Text style={s.optionAssignedText}>ASSIGNED</Text>
            </View>
          ) : null}
        </View>
      </View>
      {selected ? (
        <View style={s.optionCheck}>
          <Check size={14} color="#FFFFFF" />
        </View>
      ) : (
        <ChevronRight size={14} color={C.textMuted} />
      )}
    </Pressable>
  );
};

const ContractorChip = ({
  contractor,
  compact = false,
}: {
  contractor: ContractorLite;
  compact?: boolean;
}) => {
  const color = roleColor(contractor.role);
  return (
    <View style={s.contractorChip}>
      {contractor.avatar_url ? (
        <Image
          source={{ uri: contractor.avatar_url }}
          style={s.contractorChipAvatar}
        />
      ) : (
        <View
          style={[
            s.contractorChipAvatar,
            s.optionAvatarFallback,
            { backgroundColor: color + '33' },
          ]}
        >
          <Text style={s.contractorChipInitials}>
            {initialsFor(contractor.full_name)}
          </Text>
        </View>
      )}
      <Text style={s.pickerValueText} numberOfLines={1}>
        {contractor.full_name || contractor.company_name || 'Contractor'}
      </Text>
      {contractor._assigned ? (
        <View style={s.optionAssignedPillSm}>
          <Text style={s.optionAssignedTextSm}>ASSIGNED</Text>
        </View>
      ) : null}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
//  STYLES
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  flex1: { flex: 1 },

  glowTopLeft: {
    position: 'absolute',
    top: -160,
    left: -120,
    width: 360,
    height: 360,
    borderRadius: 200,
    backgroundColor: C.primary,
    opacity: 0.20,
  },
  glowMidRight: {
    position: 'absolute',
    top: 280,
    right: -140,
    width: 320,
    height: 320,
    borderRadius: 200,
    backgroundColor: C.cyan,
    opacity: 0.06,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerKicker: {
    color: C.cyan,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: 2,
  },
  headerTitle: {
    color: C.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.surfaceElev,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },

  // Body
  scrollContent: { paddingHorizontal: 20, paddingTop: 6 },

  section: { marginBottom: 22 },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  sectionStep: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: C.primaryGlow,
    borderWidth: 1,
    borderColor: C.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionStepText: {
    color: C.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  sectionTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  sectionSubtitle: {
    color: C.textMuted,
    fontSize: 12,
    marginTop: 2,
  },

  // Picker / input fields (glassmorphic)
  pickerField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: C.surfaceElev,
    borderWidth: 1,
    borderColor: C.border,
  },
  pickerFieldDisabled: {
    opacity: 0.55,
  },
  pickerPlaceholder: {
    color: C.textDim,
    fontSize: 13.5,
  },
  pickerValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  pickerValueText: {
    color: C.text,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  pickerInlineMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  pickerInlineMetaText: {
    color: C.textMuted,
    fontSize: 10.5,
    fontWeight: '600',
    flexShrink: 1,
  },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    borderRadius: 14,
    backgroundColor: C.surfaceElev,
    borderWidth: 1,
    borderColor: C.border,
  },
  inputWrapErr: {
    borderColor: 'rgba(239, 68, 68, 0.5)',
    backgroundColor: 'rgba(239, 68, 68, 0.06)',
  },
  inputText: {
    flex: 1,
    color: C.text,
    fontSize: 15,
    fontWeight: '600',
    padding: 0,
  },
  inputSuffix: {
    color: C.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  fieldLabel: {
    color: C.textMuted,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 6,
  },

  dateRow: {
    flexDirection: 'row',
    gap: 10,
  },

  // Date presets
  presetsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(0,255,255,0.06)',
    borderWidth: 1,
    borderColor: C.cyanBorder,
  },
  presetChipText: {
    color: C.cyan,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  // Validation hint rows
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.30)',
    marginBottom: 12,
  },
  hintText: {
    color: C.warning,
    fontSize: 12,
    fontWeight: '600',
  },
  readyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 249, 149, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(16, 249, 149, 0.30)',
    marginBottom: 12,
  },
  readyText: {
    color: C.success,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // Bottom CTA bar
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: C.bg,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 15,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 8,
  },
  ctaDisabled: {
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    shadowOpacity: 0,
    elevation: 0,
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // Modal sheet
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 4, 32, 0.7)',
  },
  modalSheet: {
    height: '70%',
    backgroundColor: C.surfaceModal,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderTopColor: C.borderStrong,
    overflow: 'hidden',
  },
  modalHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginTop: 8,
    marginBottom: 4,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  modalTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  modalSubtitle: {
    color: C.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  modalClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  modalEmptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: C.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  modalEmptyTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  modalEmptySub: {
    color: C.textMuted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },

  // Option rows inside modals
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: C.surfaceElev,
    borderWidth: 1,
    borderColor: C.border,
  },
  optionRowSelected: {
    borderColor: C.primary,
    backgroundColor: 'rgba(124, 58, 237, 0.10)',
  },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  optionAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionAvatarText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  optionTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  optionMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  optionStatusPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  optionStatusText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  optionMetaText: {
    color: C.textMuted,
    fontSize: 11,
    flexShrink: 1,
  },
  optionAssignedPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    backgroundColor: C.cyanGlow,
    borderColor: C.cyanBorder,
  },
  optionAssignedText: {
    color: C.cyan,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  optionAssignedPillSm: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
    borderWidth: 1,
    backgroundColor: C.cyanGlow,
    borderColor: C.cyanBorder,
  },
  optionAssignedTextSm: {
    color: C.cyan,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  optionCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Contractor chip (in selected picker field)
  contractorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  contractorChipAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  contractorChipInitials: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
});
