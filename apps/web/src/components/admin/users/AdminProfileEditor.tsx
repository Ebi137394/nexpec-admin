// ════════════════════════════════════════════════════════════════════════════
//  components/admin/users/AdminProfileEditor.tsx
//
//  Section-by-section profile editing for users who send their details by
//  email, phone or Help & Support instead of entering them in the app, plus
//  admin-assisted document filing.
//
//  Each section posts INDEPENDENTLY. That is deliberate: a single giant form
//  would send every field on every save, so an untouched-but-empty input
//  would silently blank a value the user had set. Posting one section at a
//  time keeps the blast radius of a save equal to what the admin was looking
//  at, and makes the audit delta legible.
//
//  Nothing here can change verification, role, suspension, balances or
//  payouts — the server action builds its UPDATE from a per-section column
//  allowlist, so those columns are unreachable regardless of what is posted.
//  Those live in the separate Admin actions card.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useActionState } from 'react';
import { Pencil, Upload, Info, Check, AlertCircle } from 'lucide-react';
import {
  adminUpdateUserProfile,
  type AdminEditState,
} from '@/lib/actions/adminEditProfile';
import { adminUploadUserDocument } from '@/lib/actions/adminUploadUserDocument';
import type { AdminUserDetail } from '@/lib/data/adminUserDetail';

const inputClass =
  'w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet/50 focus:outline-none';
const labelClass =
  'mb-1 block text-[10px] font-semibold uppercase tracking-industrial text-zinc-500';
const buttonClass =
  'inline-flex items-center gap-1.5 rounded-full bg-violet px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90';

function Field({
  name,
  label,
  defaultValue,
  placeholder,
  type = 'text',
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className={labelClass} htmlFor={`admin-edit-${name}`}>
        {label}
      </label>
      <input
        id={`admin-edit-${name}`}
        name={name}
        type={type}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        className={inputClass}
      />
    </div>
  );
}

/**
 * Shared trailer for every section: why the change is being made, and whether
 * to tell the user. The reason lands in the audit row.
 */
function SectionFooter({ section, state }: { section: string; state: AdminEditState }) {
  return (
    <>
      <div className="mt-4">
        <label className={labelClass} htmlFor={`reason-${section}`}>
          Reason / source (recorded in the audit trail)
        </label>
        <input
          id={`reason-${section}`}
          name="reason"
          className={inputClass}
          placeholder="e.g. supplied by the user over email, 7 Sep"
        />
        <p className="mt-1 text-[11px] text-zinc-500">
          Optional, but it is what the audit trail shows later.
        </p>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            name="notifyUser"
            value="true"
            defaultChecked
            className="h-3.5 w-3.5 rounded border-white/20 bg-black/40"
          />
          Tell the user in Help &amp; Support
        </label>
        <button type="submit" className={buttonClass}>
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
          Save this section
        </button>
      </div>

      {/* Feedback stays INSIDE the section, beside the inputs that caused it.
          The form is no longer navigated away from on error, so everything the
          admin typed is still on screen to correct. */}
      {state.error && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-950/30 p-2 text-xs text-red-300"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          <span>{state.error}</span>
        </p>
      )}
      {state.ok && (
        <p className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-2 text-xs text-emerald-300">
          <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          Saved. The summary above now shows these values.
        </p>
      )}
    </>
  );
}

function EditSection({
  userId,
  section,
  title,
  children,
}: {
  userId: string;
  section: string;
  title: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState<AdminEditState, FormData>(
    adminUpdateUserProfile,
    {},
  );
  // Keep the section expanded whenever it has something to say, so an error is
  // never hidden behind a collapsed summary the admin has to reopen.
  const open = Boolean(state.error || state.ok);
  return (
    <details
      className="rounded-2xl border border-white/[0.06] bg-black/20 p-4"
      open={open || undefined}
      id={`admin-edit-section-${section}`}
    >
      <summary className="cursor-pointer text-sm font-semibold text-zinc-200">
        {title}
        {state.error && <span className="ml-2 text-xs text-red-400">needs attention</span>}
      </summary>
      <form action={formAction} className="mt-4">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="section" value={section} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
        <SectionFooter section={section} state={state} />
      </form>
    </details>
  );
}

export function AdminProfileEditor({
  profile,
  isInspector,
}: {
  profile: AdminUserDetail;
  isInspector: boolean;
}) {
  const id = profile.id;
  const money = (cents: number | null) =>
    cents === null || cents === undefined ? '' : (cents / 100).toString();

  return (
    <section
      id="admin-profile-editor"
      className="scroll-mt-24 rounded-3xl border border-violet/30 bg-violet/[0.04] p-6 sm:p-8"
    >
      <header className="mb-5">
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          Edit profile on the user&apos;s behalf
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          For details supplied by email, phone, Help &amp; Support or a CV. Each
          section saves on its own and is recorded in the audit trail with the
          before and after values.
        </p>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-zinc-500">
          <Info className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.75} />
          This editor cannot verify a credential, change a role, or touch
          suspension, balances or payouts. Filing a document here marks it
          pending review, never verified.
        </p>
      </header>

      <div className="space-y-3">
        <EditSection userId={id} section="contact" title="Contact">
          <Field name="fullName" label="Full name" defaultValue={profile.full_name} />
          <Field name="phone" label="Phone" defaultValue={profile.phone} />
          <Field name="location" label="Location" defaultValue={profile.location} />
          <Field
            name="locationCity"
            label="City"
            defaultValue={profile.location_city}
          />
          <Field
            name="locationProvince"
            label="Province / state"
            defaultValue={profile.location_province}
          />
          <Field
            name="countryOfResidence"
            label="Country of residence (2-letter)"
            defaultValue={profile.country_of_residence}
            placeholder="CA"
          />
          <Field
            name="contactPersonName"
            label="Contact person"
            defaultValue={profile.contact_person_name}
          />
          <Field
            name="companyName"
            label="Company"
            defaultValue={profile.company_name}
          />
        </EditSection>

        {isInspector && (
          <>
            <EditSection userId={id} section="professional" title="Professional">
              <Field
                name="professionalTitle"
                label="Professional title"
                defaultValue={profile.professional_title_effective}
                placeholder="Senior NDT Inspector"
              />
              <Field
                name="yearsOfExperience"
                label="Years of experience"
                defaultValue={profile.years_of_experience}
              />
              <Field
                name="headline"
                label="Headline"
                defaultValue={profile.headline}
              />
              <Field
                name="homeBaseLabel"
                label="Home base"
                defaultValue={profile.home_base_label}
              />
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="admin-edit-bio">
                  Bio
                </label>
                <textarea
                  id="admin-edit-bio"
                  name="bio"
                  rows={4}
                  defaultValue={profile.bio ?? ''}
                  className={inputClass}
                />
              </div>
            </EditSection>

            <EditSection userId={id} section="skills" title="Specialties & skills">
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="admin-edit-specialtySlugs">
                  Specialties (comma or newline separated)
                </label>
                <textarea
                  id="admin-edit-specialtySlugs"
                  name="specialtySlugs"
                  rows={2}
                  defaultValue={profile.specialty_slugs.join(', ')}
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="admin-edit-ndtMethods">
                  NDT methods
                </label>
                <textarea
                  id="admin-edit-ndtMethods"
                  name="ndtMethods"
                  rows={2}
                  defaultValue={profile.ndt_methods.join(', ')}
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="admin-edit-skills">
                  Skills
                </label>
                <textarea
                  id="admin-edit-skills"
                  name="skills"
                  rows={2}
                  defaultValue={profile.skills.join(', ')}
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  className={labelClass}
                  htmlFor="admin-edit-customSpecialties"
                >
                  Custom specialties
                </label>
                <textarea
                  id="admin-edit-customSpecialties"
                  name="customSpecialties"
                  rows={2}
                  defaultValue={profile.custom_specialties.join(', ')}
                  className={inputClass}
                />
              </div>
            </EditSection>

            <EditSection userId={id} section="rates" title="Rates & availability">
              <Field
                name="hourlyRateDollars"
                label={`Hourly rate (${profile.currency ?? 'USD'})`}
                defaultValue={money(profile.hourly_rate_cents)}
                type="number"
              />
              <Field
                name="travelRateDollars"
                label={`Travel rate (${profile.currency ?? 'USD'})`}
                defaultValue={money(profile.travel_rate_cents)}
                type="number"
              />
              <Field
                name="currency"
                label="Currency"
                defaultValue={profile.currency}
                placeholder="USD"
              />
              <Field
                name="minimumEngagementHours"
                label="Minimum engagement (h)"
                defaultValue={profile.minimum_engagement_hours?.toString()}
                type="number"
              />
              <Field
                name="travelRadiusKm"
                label="Travel radius (km)"
                defaultValue={profile.travel_radius_km?.toString()}
                type="number"
              />
              <div>
                <label className={labelClass} htmlFor="admin-edit-availabilityStatus">
                  Availability
                </label>
                <select
                  id="admin-edit-availabilityStatus"
                  name="availabilityStatus"
                  defaultValue={profile.availability_status ?? 'offline'}
                  className={inputClass}
                >
                  <option value="offline">offline</option>
                  <option value="available">available</option>
                  <option value="busy">busy</option>
                </select>
              </div>
            </EditSection>

            <EditSection userId={id} section="work_auth" title="Work authorisation">
              <div className="sm:col-span-2">
                <label
                  className={labelClass}
                  htmlFor="admin-edit-workAuthorizedCountries"
                >
                  Authorised countries (2-letter codes)
                </label>
                <textarea
                  id="admin-edit-workAuthorizedCountries"
                  name="workAuthorizedCountries"
                  rows={2}
                  defaultValue={profile.work_authorized_countries.join(', ')}
                  className={inputClass}
                  placeholder="CA, US"
                />
              </div>
            </EditSection>

            {/* ── Admin-assisted document filing ───────────────────────── */}
            <details className="rounded-2xl border border-white/[0.06] bg-black/20 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-zinc-200">
                File a document for this user
              </summary>
              <form
                action={adminUploadUserDocument}
                encType="multipart/form-data"
                className="mt-4"
              >
                <input type="hidden" name="userId" value={id} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field
                    name="docName"
                    label="Document name"
                    placeholder="CGSB UT Level II certificate"
                  />
                  <div>
                    <label className={labelClass} htmlFor="admin-doc-kind">
                      Kind
                    </label>
                    <select
                      id="admin-doc-kind"
                      name="kind"
                      defaultValue="certificate"
                      className={inputClass}
                    >
                      <option value="cv">CV / resume</option>
                      <option value="certificate">Certificate</option>
                      <option value="compliance">Compliance document</option>
                      <option value="evidence">Supporting evidence</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <Field name="expiryDate" label="Expiry date" type="date" />
                  <div>
                    <label className={labelClass} htmlFor="admin-doc-file">
                      File (PDF, Word, Excel or image, max 20 MB)
                    </label>
                    <input
                      id="admin-doc-file"
                      name="document"
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
                      className="w-full text-xs text-zinc-400 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:text-zinc-200"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass} htmlFor="admin-doc-reason">
                      Reason / source (recorded in the audit trail)
                    </label>
                    <input
                      id="admin-doc-reason"
                      name="reason"
                      className={inputClass}
                      placeholder="emailed by the user, 7 Sep"
                    />
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <button type="submit" className={buttonClass}>
                    <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
                    File document (pending review)
                  </button>
                </div>
              </form>
            </details>
          </>
        )}
      </div>
    </section>
  );
}
