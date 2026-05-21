// ════════════════════════════════════════════════════════════════════════════
//  components/vault/VaultDocumentActions.tsx — owner + admin actions
//
//  Owner can: archive / restore (toggle is_archived)
//  Admin can: verify / unverify (toggle is_verified + stamp)
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  ShieldOff,
  XCircle,
} from 'lucide-react';
import {
  archiveVaultDocumentAction,
  restoreVaultDocumentAction,
  verifyVaultDocumentAction,
} from '@/lib/actions/vault';
import { vaultActionInitialState, type VaultActionState } from '@/lib/actions/vault.types';

interface Props {
  documentId: string;
  isVerified: boolean;
  isArchived: boolean;
  isAdmin: boolean;
  isOwner: boolean;
}

export function VaultDocumentActions({
  documentId,
  isVerified,
  isArchived,
  isAdmin,
  isOwner,
}: Props) {
  return (
    <div className="space-y-3">
      {isAdmin && <VerifyForm documentId={documentId} isVerified={isVerified} />}
      {isOwner && !isArchived && <ArchiveForm documentId={documentId} />}
      {isOwner && isArchived && <RestoreForm documentId={documentId} />}
      {!isOwner && !isAdmin && (
        <p className="rounded-xl border border-white/[0.06] bg-white/[0.01] p-3 text-xs text-zinc-500">
          You can view this document but cannot modify it.
        </p>
      )}
    </div>
  );
}

function VerifyForm({ documentId, isVerified }: { documentId: string; isVerified: boolean }) {
  const [state, formAction] = useActionState<VaultActionState, FormData>(
    verifyVaultDocumentAction,
    vaultActionInitialState,
  );
  const nextValue = isVerified ? 'false' : 'true';
  return (
    <form action={formAction}>
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="verified" value={nextValue} />
      {state.error ? <Alert tone="red" msg={state.error} /> : null}
      {state.ok && state.message ? <Alert tone="green" msg={state.message} /> : null}
      <ActionButton
        label={isVerified ? 'Revoke verification' : 'Verify document'}
        Icon={isVerified ? ShieldOff : ShieldCheck}
        tone={isVerified ? 'zinc' : 'green'}
      />
    </form>
  );
}

function ArchiveForm({ documentId }: { documentId: string }) {
  const [state, formAction] = useActionState<VaultActionState, FormData>(
    archiveVaultDocumentAction,
    vaultActionInitialState,
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="documentId" value={documentId} />
      {state.error ? <Alert tone="red" msg={state.error} /> : null}
      <ActionButton label="Archive document" Icon={Archive} tone="zinc" />
    </form>
  );
}

function RestoreForm({ documentId }: { documentId: string }) {
  const [state, formAction] = useActionState<VaultActionState, FormData>(
    restoreVaultDocumentAction,
    vaultActionInitialState,
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="documentId" value={documentId} />
      {state.error ? <Alert tone="red" msg={state.error} /> : null}
      <ActionButton label="Restore document" Icon={ArchiveRestore} tone="violet" />
    </form>
  );
}

function ActionButton({
  label,
  Icon,
  tone,
}: {
  label: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  tone: 'green' | 'zinc' | 'violet';
}) {
  const { pending } = useFormStatus();
  const cls = {
    green: 'border-accent-green/40 bg-accent-green/10 text-accent-green hover:bg-accent-green/15',
    zinc: 'border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:text-white',
    violet: 'border-violet/40 bg-violet/10 text-violet-glow hover:bg-violet/15',
  }[tone];
  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${cls}`}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" strokeWidth={2} />}
      {pending ? 'Working…' : label}
    </button>
  );
}

function Alert({ tone, msg }: { tone: 'red' | 'green'; msg: string }) {
  const cls = tone === 'green'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
    : 'border-red-500/30 bg-red-500/10 text-red-200';
  const icon = tone === 'green' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />;
  return (
    <div className={`mb-3 flex items-start gap-2 rounded-xl border p-3 text-sm ${cls}`}>
      <span className="mt-0.5">{icon}</span>
      <span>{msg}</span>
    </div>
  );
}
