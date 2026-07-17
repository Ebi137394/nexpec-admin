'use client';
// ════════════════════════════════════════════════════════════════════════════
//  components/ui/AppDialog.tsx — promise-based, theme-matched dialog primitive.
//
//  Replaces native window.alert / confirm / prompt (which are unstyled, blocking,
//  and off-brand) with a single in-theme modal. Imperative + await-able so call
//  sites stay one-liners:
//      await alertDialog('Saved.');
//      if (!(await confirmDialog('Delete this?'))) return;
//      const name = await promptDialog({ body: 'Your name', minLength: 2 });
//
//  Mount <AppDialogHost/> ONCE (done in the root layout). No new page layout,
//  colours, or spacing are altered — this only adds a transient overlay that is
//  invisible until invoked. Brand tokens only: ink #020420, violet #7C3AED.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type Kind = 'alert' | 'confirm' | 'prompt';
type Tone = 'default' | 'danger';

interface DialogOptions {
  title?: string;
  body: string;
  confirmText?: string;
  cancelText?: string;
  tone?: Tone;
  defaultValue?: string;   // prompt only
  placeholder?: string;    // prompt only
  minLength?: number;      // prompt only
}
interface ActiveDialog extends DialogOptions {
  id: number;
  kind: Kind;
  resolve: (v: boolean | string | null | void) => void;
}

// ── tiny module store (no external dep) ──
let active: ActiveDialog | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((l) => l());

function open(kind: Kind, opts: DialogOptions): Promise<boolean | string | null | void> {
  return new Promise((resolve) => {
    active = { ...opts, id: ++seq, kind, resolve };
    notify();
  });
}
function close(result: boolean | string | null | void): void {
  const a = active;
  active = null;
  notify();
  a?.resolve(result);
}

const asOpts = (o: string | DialogOptions): DialogOptions => (typeof o === 'string' ? { body: o } : o);

/** Themed replacement for window.alert. Resolves when dismissed. */
export const alertDialog = (o: string | DialogOptions): Promise<void> =>
  open('alert', asOpts(o)) as Promise<void>;
/** Themed replacement for window.confirm. Resolves true/false. */
export const confirmDialog = (o: string | DialogOptions): Promise<boolean> =>
  open('confirm', asOpts(o)) as Promise<boolean>;
/** Themed replacement for window.prompt. Resolves the string, or null if cancelled. */
export const promptDialog = (o: string | DialogOptions): Promise<string | null> =>
  open('prompt', asOpts(o)) as Promise<string | null>;

/** Mount once (root layout). Renders nothing until a dialog is requested. */
export function AppDialogHost(): React.ReactElement | null {
  const [, force] = useState(0);
  const [value, setValue] = useState('');
  useEffect(() => {
    const l = (): void => force((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  // reset the input each time a new prompt opens
  useEffect(() => { setValue(active?.kind === 'prompt' ? (active.defaultValue ?? '') : ''); }, [active?.id]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  if (!active || typeof document === 'undefined') return null;
  const a = active;
  const danger = a.tone === 'danger';
  const tooShort = a.kind === 'prompt' && a.minLength != null && value.trim().length < a.minLength;

  function cancel(): void { close(a.kind === 'confirm' ? false : a.kind === 'prompt' ? null : undefined); }
  function accept(): void {
    if (a.kind === 'prompt') { if (tooShort) return; close(value.trim()); }
    else if (a.kind === 'confirm') close(true);
    else close(undefined);
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 20,
        background: 'rgba(2,4,32,0.72)', backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 420, background: '#0b1020',
          border: '1px solid rgba(255,255,255,0.10)', borderRadius: 18,
          boxShadow: '0 30px 80px -20px rgba(0,0,0,0.7)', padding: 22,
          fontFamily: 'inherit', color: '#eef1f8',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {a.title && <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{a.title}</h2>}
        <p style={{ margin: a.title ? '8px 0 0' : 0, fontSize: 14, lineHeight: 1.5, color: '#aeb6d0', whiteSpace: 'pre-wrap' }}>{a.body}</p>
        {a.kind === 'prompt' && (
          <input
            autoFocus
            value={value}
            placeholder={a.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') accept(); }}
            style={{
              marginTop: 14, width: '100%', boxSizing: 'border-box', borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.12)', background: '#020420',
              color: '#fff', padding: '10px 12px', fontSize: 14, outline: 'none',
            }}
          />
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          {a.kind !== 'alert' && (
            <button
              type="button" onClick={cancel}
              style={{
                borderRadius: 10, padding: '9px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
                background: 'transparent', color: '#c7cde6', border: '1px solid rgba(255,255,255,0.12)',
              }}
            >{a.cancelText ?? 'Cancel'}</button>
          )}
          <button
            type="button" onClick={accept} disabled={tooShort}
            style={{
              borderRadius: 10, padding: '9px 18px', fontSize: 13.5, fontWeight: 700, cursor: tooShort ? 'not-allowed' : 'pointer',
              color: '#fff', border: '1px solid ' + (danger ? 'rgba(251,113,133,0.5)' : 'rgba(167,139,250,0.5)'),
              background: danger ? '#e11d48' : '#7C3AED', opacity: tooShort ? 0.5 : 1,
            }}
          >{a.confirmText ?? (a.kind === 'alert' ? 'OK' : 'Confirm')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
