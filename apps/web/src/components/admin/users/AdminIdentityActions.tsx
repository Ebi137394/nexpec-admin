'use client';

// ════════════════════════════════════════════════════════════════════════════
//  AdminIdentityActions — "Edit Profile" and "Change Photo", in the identity
//  header where an admin actually looks for them.
//
//  The editor already existed, but it sat below the moderation, verification,
//  organisation, marketplace and payout sections, and every section was a
//  COLLAPSED <details>. The owner could not find it, which for their purposes
//  is the same as it not existing.
//
//  This adds no second editor and duplicates no persistence: "Edit Profile"
//  scrolls to and opens the existing AdminProfileEditor. Only the photo control
//  is new, because there was no admin avatar path at all.
// ════════════════════════════════════════════════════════════════════════════

import { useActionState, useRef, useState } from 'react';
import { Pencil, Camera, Check, AlertCircle, X } from 'lucide-react';
import {
  adminUploadUserAvatar,
  type AdminAvatarState,
} from '@/lib/actions/adminUploadUserAvatar';

export function AdminIdentityActions({
  userId,
  displayName,
}: {
  userId: string;
  displayName: string;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState<AdminAvatarState, FormData>(
    adminUploadUserAvatar,
    {},
  );
  const fileRef = useRef<HTMLInputElement>(null);

  // Opening every collapsed section first means the admin lands on a usable
  // form rather than on five closed summaries.
  const goToEditor = () => {
    const el = document.getElementById('admin-profile-editor');
    if (!el) return;
    el.querySelectorAll('details').forEach((d) => {
      (d as HTMLDetailsElement).open = true;
    });
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={goToEditor}
        className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
      >
        <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
        Edit Profile
      </button>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-white/5"
      >
        <Camera className="h-3.5 w-3.5" strokeWidth={1.75} />
        Change Photo
      </button>

      {open && (
        <form
          action={formAction}
          className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3"
        >
          <input type="hidden" name="userId" value={userId} />
          <p className="text-xs text-zinc-400">
            Replace the profile photo for <span className="text-zinc-200">{displayName}</span>.
            JPG, PNG, WebP or GIF, up to 5 MB. The current photo is kept until the
            new one is saved.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              name="avatar"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
              className="text-xs text-zinc-300 file:mr-3 file:rounded file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:text-zinc-100"
            />
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="Preview of the new profile photo"
                className="h-12 w-12 rounded-full object-cover ring-1 ring-white/20"
              />
            )}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {pending ? 'Uploading…' : 'Save photo'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setPreview(null);
                if (fileRef.current) fileRef.current.value = '';
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              Cancel
            </button>
          </div>

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
              Photo saved. Reload to see it in the header.
            </p>
          )}
        </form>
      )}
    </div>
  );
}
