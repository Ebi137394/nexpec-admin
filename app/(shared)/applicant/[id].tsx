import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform, RefreshControl, type ViewStyle } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ShieldCheck, Briefcase, Award, CheckCircle, MapPin, Calendar, AlertCircle, Layers, Building2, BadgeCheck, Info } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/src/i18n/LanguageProvider';

interface InspectorProfile {
  id: string;
  full_name: string | null;
  bio: string | null;
  skills: string[] | null;
  city: string | null;
  province: string | null;
}

interface WorkExperience {
  id: string;
  user_id: string;
  company: string | null;
  title: string | null;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  is_current: boolean | null;
}

interface Certification {
  id: string;
  user_id: string;
  title: string | null;
  issuing_organization: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  credential_id: string | null;
}

// ★ HIRE-001/008: canonical status enum (uppercase CLIENT_SELECTED).
//   Local lowercase variants kept in the union ONLY for back-compat with
//   any in-flight rows in the AsyncStorage cache during rollout. New
//   writes from this screen go through canonical casing.
type ApplicationStatus = 'pending' | 'applied' | 'shortlisted' | 'CLIENT_SELECTED' | 'client_selected' | 'admin_confirmed' | 'hired' | 'rejected' | 'withdrawn' | string;

const D = {
  bg: '#020420',
  card: '#0F172A',
  border: '#1E293B',
  borderSubtle: 'rgba(30, 41, 59, 0.5)',
  primary: '#7C3AED',
  primaryMuted: 'rgba(124, 58, 237, 0.12)',
  primaryBorder: 'rgba(124, 58, 237, 0.28)',
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  textTertiary: '#64748B',
  success: '#10B981',
  successBg: 'rgba(16, 185, 129, 0.08)',
  successBorder: 'rgba(16, 185, 129, 0.24)',
  amber: '#F59E0B',
  amberBg: 'rgba(245, 158, 11, 0.08)',
  amberBorder: 'rgba(245, 158, 11, 0.24)'
} as const;

function fmtMonth(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function fmtRange(start: string | null, end: string | null, isCurrent: boolean | null, presentLabel: string): string {
  const s = fmtMonth(start);
  if (!s) return '';
  if (isCurrent || !end) return `${s} — ${presentLabel}`;
  return `${s} — ${fmtMonth(end)}`;
}

function calcDuration(start: string | null, end: string | null): string {
  if (!start) return '';
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  let months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  if (months < 1) months = 1;
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y > 0 && m > 0) return `${y}y ${m}mo`;
  if (y > 0) return `${y}y`;
  return `${m}mo`;
}

function initials(name: string | null): string {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  if (p.length === 1) return (p[0][0] ?? '?').toUpperCase();
  return `${p[0][0]}${p[p.length - 1][0]}`.toUpperCase();
}

function totalYears(exp: WorkExperience[]): string {
  if (!exp.length) return '0';
  let total = 0;
  for (const e of exp) {
    if (!e.start_date) continue;
    const s = new Date(e.start_date);
    const end = e.end_date ? new Date(e.end_date) : new Date();
    total += (end.getTime() - s.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  }
  return Math.max(1, Math.round(total)).toString();
}

export default function ApplicantBlindProfileScreen() {
  const { id, job_id } = useLocalSearchParams<{ id: string; job_id: string; }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, isRTL } = useLanguage();

  const row: ViewStyle = useMemo(() => ({ flexDirection: isRTL ? 'row-reverse' : 'row' }), [isRTL]);
  const txtAlign = useMemo(() => (isRTL ? 'right' : 'left'), [isRTL]);

  const [profile, setProfile] = useState<InspectorProfile | null>(null);
  const [experience, setExperience] = useState<WorkExperience[]>([]);
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [appStatus, setAppStatus] = useState<ApplicationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selecting, setSelecting] = useState(false);

  // ★ HIRE-001/008: accept both casings during rollout. New writes are
  //   uppercase 'CLIENT_SELECTED'; any AsyncStorage-cached or in-flight
  //   pre-migration rows might still be lowercase. Both resolve to true.
  const isSelected =
    appStatus === 'CLIENT_SELECTED' ||
    appStatus === 'client_selected' ||
    appStatus === 'admin_confirmed';

  const fetchAll = useCallback(async () => {
    if (!id) return;
    try {
      const [profileRes, expRes, certRes, appRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, bio, skills, city, province').eq('id', id).single(),
        supabase.from('work_experience').select('id, user_id, company, title, start_date, end_date, description, is_current').eq('user_id', id).order('start_date', { ascending: false }),
        supabase.from('certifications').select('id, user_id, title, issuing_organization, issue_date, expiry_date, credential_id').eq('user_id', id).order('issue_date', { ascending: false }),
        // ★ HIRE-008: canonical applications table. Legacy column
        //   name inspector_id → applicant_id renamed in place.
        job_id ? supabase.from('applications').select('status').eq('job_id', job_id).eq('applicant_id', id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ]);
      if (profileRes.error) throw profileRes.error;
      setProfile(profileRes.data as InspectorProfile);
      setExperience((expRes.data as WorkExperience[]) ?? []);
      setCertifications((certRes.data as Certification[]) ?? []);
      setAppStatus((appRes.data as { status: string } | null)?.status ?? null);
    } catch (err: any) {
      Alert.alert(t('blind.error_title', 'Error'), err.message || t('blind.error_load', 'Failed to load profile.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, job_id, t]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAll();
  }, [fetchAll]);

  const handleSelect = useCallback(() => {
    if (!job_id || !id) return;
    const name = profile?.full_name ?? t('blind.this_inspector', 'this inspector');
    Alert.alert(
      t('blind.confirm_title', 'Confirm Selection'),
      t('blind.confirm_body', `You are selecting ${name} for this job.\n\nThis does not finalize the hire — NEXPEC administration will contact the inspector to confirm availability and negotiate terms on your behalf.`),
      [
        { text: t('blind.cancel', 'Cancel'), style: 'cancel' },
        {
          text: t('blind.confirm_btn', 'Select Inspector'),
          onPress: async () => {
            setSelecting(true);
            try {
              // ★ HIRE-001/008: canonical table + uppercase status.
              //   inspector_id → applicant_id; lowercase → uppercase.
              const { error } = await supabase
                .from('applications')
                .update({ status: 'CLIENT_SELECTED' })
                .eq('job_id', job_id)
                .eq('applicant_id', id);
              if (error) throw error;
              setAppStatus('CLIENT_SELECTED');
              Alert.alert(
                t('blind.success_title', 'Inspector Selected'),
                t('blind.success_body', 'NEXPEC administration will now contact the inspector to confirm availability and finalize terms. We will notify you once confirmed.'),
                [{ text: t('blind.ok', 'OK'), onPress: () => router.back() }]
              );
            } catch (err: any) {
              Alert.alert(t('blind.error_title', 'Selection Failed'), err.message ?? t('blind.error_generic', 'Please try again.'));
            } finally {
              setSelecting(false);
            }
          },
        },
      ]
    );
  }, [job_id, id, profile, router, t]);

  const StatsBar = () => {
    const yrs = totalYears(experience);
    const stats = [
      { icon: Calendar, value: yrs, label: t('blind.stat_years', 'Years Exp'), color: D.primary },
      { icon: Briefcase, value: experience.length.toString(), label: t('blind.stat_roles', 'Roles'), color: D.amber },
      { icon: Award, value: certifications.length.toString(), label: t('blind.stat_certs', 'Certs'), color: D.success },
      { icon: Layers, value: (profile?.skills?.length ?? 0).toString(), label: t('blind.stat_skills', 'Skills'), color: '#3B82F6' }
    ];
    return (
      <View style={[styles.statsRow, row]}>
        {stats.map((s, i) => (
          <View key={i} style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: `${s.color}15` }]}>
              <s.icon size={15} color={s.color} strokeWidth={2.2} />
            </View>
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
    );
  };

  const HeroCard = () => {
    const loc = [profile?.city, profile?.province].filter(Boolean).join(', ') || null;
    return (
      <View style={styles.heroCard}>
        <View style={[styles.heroTop, row]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>{initials(profile?.full_name)}</Text>
          </View>
          <View style={[styles.heroInfo, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
            <Text style={[styles.heroName, { textAlign: txtAlign }]} numberOfLines={2}>
              {profile?.full_name ?? t('blind.unknown', 'Inspector Profile')}
            </Text>
            {loc && (
              <View style={[styles.locRow, row]}>
                <MapPin size={13} color={D.textTertiary} strokeWidth={2} />
                <Text style={styles.locTxt}>{loc}</Text>
              </View>
            )}
          </View>
        </View>
        <View style={[styles.trustBadge, row]}>
          <ShieldCheck size={14} color={D.success} strokeWidth={2.2} />
          <Text style={styles.trustTxt}>{t('blind.trust_badge', 'Contact Info Protected · Blind Profile')}</Text>
        </View>
        {profile?.bio ? (
          <View style={styles.bioWrap}>
            <Text style={[styles.bioTxt, { textAlign: txtAlign }]}>{profile.bio}</Text>
          </View>
        ) : null}
        <StatsBar />
      </View>
    );
  };

  const Section = ({ icon: Icon, title, count, children }: any) => (
    <View style={styles.section}>
      <View style={[styles.sectionHdr, row]}>
        <View style={[styles.sectionHdrLeft, row]}>
          <View style={styles.sectionIconWrap}>
            <Icon size={16} color={D.primary} strokeWidth={2.2} />
          </View>
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        <View style={styles.sectionBadge}>
          <Text style={styles.sectionBadgeTxt}>{count}</Text>
        </View>
      </View>
      {children}
    </View>
  );

  const SkillsSection = () => {
    if (!profile?.skills?.length) return null;
    return (
      <Section icon={Layers} title={t('blind.skills', 'Skills & Expertise')} count={profile.skills.length}>
        <View style={styles.skillsGrid}>
          {profile.skills.map((skill, i) => (
            <View key={`${skill}-${i}`} style={styles.chip}>
              <View style={styles.chipDot} />
              <Text style={styles.chipTxt} numberOfLines={1}>{skill}</Text>
            </View>
          ))}
        </View>
      </Section>
    );
  };

  const ExperienceSection = () => {
    if (!experience.length) return null;
    return (
      <Section icon={Briefcase} title={t('blind.experience', 'Work Experience')} count={experience.length}>
        <View style={styles.timeline}>
          {experience.map((exp, idx) => {
            const last = idx === experience.length - 1;
            const range = fmtRange(exp.start_date, exp.end_date, exp.is_current, t('blind.present', 'Present'));
            const dur = calcDuration(exp.start_date, exp.end_date);
            return (
              <View key={exp.id} style={styles.tlItem}>
                <View style={styles.tlTrack}>
                  <View style={[styles.tlDot, idx === 0 && styles.tlDotActive]} />
                  {!last && <View style={styles.tlLine} />}
                </View>
                <View style={[styles.expCard, last && { marginBottom: 0 }]}>
                  <View style={[styles.expHdr, row]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.expTitle, { textAlign: txtAlign }]} numberOfLines={2}>
                        {exp.title ?? t('blind.untitled_role', 'Role')}
                      </Text>
                      {exp.company && (
                        <View style={[styles.expCoRow, row]}>
                          <Building2 size={12} color={D.textTertiary} strokeWidth={2} />
                          <Text style={styles.expCompany} numberOfLines={1}>{exp.company}</Text>
                        </View>
                      )}
                    </View>
                    {exp.is_current && (
                      <View style={styles.curBadge}>
                        <View style={styles.curDot} />
                        <Text style={styles.curTxt}>{t('blind.current', 'Current')}</Text>
                      </View>
                    )}
                  </View>
                  {range ? (
                    <View style={[styles.dateRow, row]}>
                      <Calendar size={12} color={D.textTertiary} strokeWidth={2} />
                      <Text style={styles.dateTxt}>{range}</Text>
                      {dur ? (
                        <>
                          <View style={styles.dotSep} />
                          <Text style={styles.durTxt}>{dur}</Text>
                        </>
                      ) : null}
                    </View>
                  ) : null}
                  {exp.description ? (
                    <Text style={[styles.expDesc, { textAlign: txtAlign }]} numberOfLines={5}>{exp.description}</Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      </Section>
    );
  };

  const CertsSection = () => {
    if (!certifications.length) return null;
    return (
      <Section icon={Award} title={t('blind.certifications', 'Certifications')} count={certifications.length}>
        {certifications.map((cert) => (
          <View key={cert.id} style={styles.certCard}>
            <View style={[styles.certInner, row]}>
              <View style={styles.certIconWrap}>
                <BadgeCheck size={18} color={D.primary} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.certTitle, { textAlign: txtAlign }]} numberOfLines={2}>
                  {cert.title ?? t('blind.untitled_cert', 'Certification')}
                </Text>
                {cert.issuing_organization && (
                  <Text style={[styles.certOrg, { textAlign: txtAlign }]} numberOfLines={1}>
                    {cert.issuing_organization}
                  </Text>
                )}
                <View style={[styles.certMeta, row]}>
                  {cert.issue_date && (
                    <Text style={styles.certDate}>
                      {t('blind.issued', 'Issued')} {fmtMonth(cert.issue_date)}
                    </Text>
                  )}
                  {cert.expiry_date && (
                    <>
                      <View style={styles.dotSep} />
                      <Text style={styles.certDate}>
                        {t('blind.expires', 'Expires')} {fmtMonth(cert.expiry_date)}
                      </Text>
                    </>
                  )}
                </View>
                {cert.credential_id && (
                  <Text style={styles.credId} numberOfLines={1}>
                    {t('blind.credential_id', 'ID:')} {cert.credential_id}
                  </Text>
                )}
              </View>
            </View>
          </View>
        ))}
      </Section>
    );
  };

  const BrokerageNotice = () => (
    <View style={styles.noticeBanner}>
      <View style={[styles.noticeInner, row]}>
        <View style={styles.noticeIconWrap}>
          <Info size={16} color={D.amber} strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.noticeTitle, { textAlign: txtAlign }]}>{t('blind.notice_title', 'Brokerage Workflow')}</Text>
          <Text style={[styles.noticeTxt, { textAlign: txtAlign }]}>
            {t('blind.notice_body', 'Selecting an inspector does not finalize the hire. NEXPEC administration will negotiate terms and confirm availability on your behalf before any assignment is made.')}
          </Text>
        </View>
      </View>
    </View>
  );

  const EmptyState = () => {
    const empty = !profile?.skills?.length && experience.length === 0 && certifications.length === 0;
    if (!empty) return null;
    return (
      <View style={styles.emptyWrap}>
        <View style={styles.emptyIconWrap}>
          <AlertCircle size={40} color={D.textTertiary} strokeWidth={1.5} />
        </View>
        <Text style={styles.emptyTitle}>{t('blind.empty_title', 'Profile Not Yet Completed')}</Text>
        <Text style={styles.emptyBody}>{t('blind.empty_body', 'This inspector has not added their qualifications yet.')}</Text>
      </View>
    );
  };

  if (loading && !refreshing) {
    return (
      <View style={[styles.root, styles.centered]}>
        <ActivityIndicator size="large" color={D.primary} />
        <Text style={styles.loadingTxt}>{t('blind.loading', 'Loading profile…')}</Text>
      </View>
    );
  }

  const showSelectBtn = !!job_id && !isSelected;
  const footerHeight = showSelectBtn || isSelected ? insets.bottom + 110 : insets.bottom + 40;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={[styles.headerInner, row]}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <ArrowLeft size={22} color={D.textPrimary} strokeWidth={2.2} style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerEyebrow}>{t('blind.header_eyebrow', 'Blind Profile')}</Text>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {profile?.full_name ?? t('blind.inspector', 'Inspector')}
            </Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: footerHeight }]}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={D.primary}
            colors={[D.primary]}
            progressBackgroundColor={D.card}
          />
        }
      >
        <HeroCard />
        <SkillsSection />
        <ExperienceSection />
        <CertsSection />
        <BrokerageNotice />
        <EmptyState />
      </ScrollView>

      {showSelectBtn && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
          <TouchableOpacity
            style={[styles.selectBtn, selecting && styles.selectBtnDisabled]}
            onPress={handleSelect}
            disabled={selecting}
            activeOpacity={0.8}
          >
            {selecting ? (
              <ActivityIndicator size="small" color={D.textPrimary} />
            ) : (
              <View style={[styles.selectBtnInner, row]}>
                <CheckCircle size={19} color={D.textPrimary} strokeWidth={2.5} />
                <Text style={styles.selectBtnTxt}>{t('blind.select_button', 'Select This Inspector')}</Text>
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.footerDisclaimer}>
            {t('blind.footer_note', 'NEXPEC admin will negotiate and confirm on your behalf.')}
          </Text>
        </View>
      )}

      {isSelected && (
        <View style={[styles.footer, styles.selectedFooter, { paddingBottom: insets.bottom + 14 }]}>
          <View style={[styles.selectedBanner, row]}>
            <CheckCircle size={18} color={D.success} strokeWidth={2.5} />
            <Text style={styles.selectedTxt}>
              {appStatus === 'admin_confirmed'
                ? t('blind.admin_confirmed', 'Confirmed — Assignment Finalized')
                : t('blind.already_selected', 'Selected — Pending Admin Confirmation')}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: D.bg },
  centered: { justifyContent: 'center', alignItems: 'center' },
  loadingTxt: { color: D.textSecondary, fontSize: 15, fontWeight: '500', marginTop: 14 },

  header: { backgroundColor: D.bg, borderBottomWidth: 1, borderBottomColor: D.border, zIndex: 10 },
  headerInner: { alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 42, height: 42, borderRadius: 12, backgroundColor: D.card, borderWidth: 1, borderColor: D.border, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', marginHorizontal: 12 },
  headerEyebrow: { fontSize: 10, fontWeight: '700', color: D.primary, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 2 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: D.textPrimary, letterSpacing: -0.3 },
  headerSpacer: { width: 42 },

  scrollContent: { paddingHorizontal: 20, paddingTop: 20 },

  heroCard: { backgroundColor: D.card, borderWidth: 1, borderColor: D.border, borderRadius: 16, padding: 18, marginBottom: 24 },
  heroTop: { alignItems: 'center', gap: 14, marginBottom: 14 },
  avatar: { width: 56, height: 56, borderRadius: 16, backgroundColor: D.primaryMuted, borderWidth: 1, borderColor: D.primaryBorder, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 20, fontWeight: '800', color: D.primary },
  heroInfo: { flex: 1 },
  heroName: { fontSize: 20, fontWeight: '800', color: D.textPrimary, letterSpacing: -0.5, marginBottom: 4 },
  locRow: { alignItems: 'center', gap: 4 },
  locTxt: { fontSize: 13, fontWeight: '500', color: D.textTertiary },
  trustBadge: { alignSelf: 'flex-start', alignItems: 'center', gap: 6, backgroundColor: D.successBg, borderWidth: 1, borderColor: D.successBorder, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 14 },
  trustTxt: { fontSize: 11, fontWeight: '700', color: D.success, letterSpacing: 0.3 },

  bioWrap: { borderTopWidth: 1, borderTopColor: D.borderSubtle, paddingTop: 14, marginBottom: 14 },
  bioTxt: { fontSize: 14, fontWeight: '400', color: D.textSecondary, lineHeight: 21 },

  statsRow: { gap: 8 },
  statCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: D.borderSubtle, borderRadius: 12, padding: 10, alignItems: 'center' },
  statIconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  statValue: { fontSize: 18, fontWeight: '800', color: D.textPrimary, marginBottom: 2 },
  statLabel: { fontSize: 9, fontWeight: '600', color: D.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },

  section: { marginBottom: 24 },
  sectionHdr: { alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sectionHdrLeft: { alignItems: 'center', gap: 8 },
  sectionIconWrap: { width: 32, height: 32, borderRadius: 9, backgroundColor: D.primaryMuted, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: D.textPrimary, letterSpacing: -0.2 },
  sectionBadge: { backgroundColor: D.primaryMuted, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderColor: D.primaryBorder },
  sectionBadgeTxt: { fontSize: 12, fontWeight: '700', color: D.primary },

  skillsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: D.card, borderWidth: 1, borderColor: D.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  chipDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: D.primary },
  chipTxt: { fontSize: 13, fontWeight: '600', color: D.textPrimary, letterSpacing: 0.1 },

  timeline: {},
  tlItem: { flexDirection: 'row' },
  tlTrack: { width: 24, alignItems: 'center', paddingTop: 6 },
  tlDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: D.border, borderWidth: 2, borderColor: D.textTertiary, zIndex: 2 },
  tlDotActive: { backgroundColor: D.primary, borderColor: D.primary, ...Platform.select({ ios: { shadowColor: D.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 6 }, android: { elevation: 4 } }) },
  tlLine: { flex: 1, width: 2, backgroundColor: D.border, marginTop: 4, marginBottom: -4 },

  expCard: { flex: 1, backgroundColor: D.card, borderWidth: 1, borderColor: D.border, borderRadius: 14, padding: 14, marginBottom: 12, marginLeft: 10 },
  expHdr: { alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  expTitle: { fontSize: 15, fontWeight: '700', color: D.textPrimary, lineHeight: 20, marginBottom: 4 },
  expCoRow: { alignItems: 'center', gap: 5 },
  expCompany: { fontSize: 13, fontWeight: '500', color: D.textSecondary },
  curBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: D.successBg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  curDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: D.success },
  curTxt: { fontSize: 10, fontWeight: '700', color: D.success, textTransform: 'uppercase', letterSpacing: 0.4 },

  dateRow: { alignItems: 'center', gap: 5, marginBottom: 8 },
  dateTxt: { fontSize: 12, fontWeight: '500', color: D.textTertiary },
  dotSep: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: D.textTertiary, marginHorizontal: 2 },
  durTxt: { fontSize: 12, fontWeight: '600', color: D.primary },
  expDesc: { fontSize: 13, fontWeight: '400', color: D.textSecondary, lineHeight: 19, borderTopWidth: 1, borderTopColor: D.borderSubtle, paddingTop: 10 },

  certCard: { backgroundColor: D.card, borderWidth: 1, borderColor: D.border, borderRadius: 14, padding: 14, marginBottom: 10 },
  certInner: { alignItems: 'flex-start', gap: 12 },
  certIconWrap: { width: 40, height: 40, borderRadius: 11, backgroundColor: D.primaryMuted, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  certTitle: { fontSize: 14, fontWeight: '700', color: D.textPrimary, lineHeight: 19, marginBottom: 2 },
  certOrg: { fontSize: 13, fontWeight: '500', color: D.textSecondary, marginBottom: 4 },
  certMeta: { alignItems: 'center', gap: 5, marginBottom: 2 },
  certDate: { fontSize: 11.5, fontWeight: '500', color: D.textTertiary },
  credId: { fontSize: 11, fontWeight: '500', color: D.textTertiary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 4 },

  noticeBanner: { backgroundColor: D.amberBg, borderWidth: 1, borderColor: D.amberBorder, borderRadius: 14, padding: 14, marginBottom: 24 },
  noticeInner: { alignItems: 'flex-start', gap: 10 },
  noticeIconWrap: { width: 32, height: 32, borderRadius: 9, backgroundColor: 'rgba(245,158,11,0.12)', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  noticeTitle: { fontSize: 13, fontWeight: '700', color: D.amber, letterSpacing: 0.2, marginBottom: 4 },
  noticeTxt: { fontSize: 12.5, fontWeight: '400', color: D.textSecondary, lineHeight: 18 },

  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 32 },
  emptyIconWrap: { width: 80, height: 80, borderRadius: 24, backgroundColor: D.card, borderWidth: 1, borderColor: D.border, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: D.textPrimary, marginBottom: 8, textAlign: 'center' },
  emptyBody: { fontSize: 14, color: D.textSecondary, textAlign: 'center', lineHeight: 20, maxWidth: 280 },

  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: D.bg,
    borderTopWidth: 1,
    borderTopColor: D.border,
    paddingHorizontal: 20,
    paddingTop: 14,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.15, shadowRadius: 16 },
      android: { elevation: 12 }
    })
  },
  selectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: D.primary,
    borderRadius: 14,
    paddingVertical: 16,
    ...Platform.select({
      ios: { shadowColor: D.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 14 },
      android: { elevation: 10 }
    })
  },
  selectBtnDisabled: { backgroundColor: D.textTertiary, shadowOpacity: 0, elevation: 0 },
  selectBtnInner: { alignItems: 'center', gap: 9 },
  selectBtnTxt: { fontSize: 16, fontWeight: '700', color: D.textPrimary, letterSpacing: 0.4 },
  footerDisclaimer: { fontSize: 11, fontWeight: '500', color: D.textTertiary, textAlign: 'center', marginTop: 10, letterSpacing: 0.1 },

  selectedFooter: { borderTopColor: D.successBorder },
  selectedBanner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: D.successBg,
    borderWidth: 1,
    borderColor: D.successBorder,
    borderRadius: 14,
    paddingVertical: 16
  },
  selectedTxt: { fontSize: 14, fontWeight: '700', color: D.success, letterSpacing: 0.3 }
});