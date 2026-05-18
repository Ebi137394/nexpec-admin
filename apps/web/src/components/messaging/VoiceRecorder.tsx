// ════════════════════════════════════════════════════════════════════════════
//  components/messaging/VoiceRecorder.tsx — record + send voice messages
//
//  Client component using the MediaRecorder API. When the user finishes
//  recording, the audio blob is attached to a hidden <form action={sendMessage}>
//  as a File and submitted server-side — same code path as the file-picker.
//
//  Permissions: requests mic via navigator.mediaDevices.getUserMedia. If
//  denied, falls back to a clear error and offers a retry.
//
//  Audio format: prefers audio/webm;codecs=opus (Chrome, Firefox, modern
//  Safari). Falls back to audio/mp4 or whatever the UA supports.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2, Send, Loader2 } from 'lucide-react';
import { sendMessage } from '@/lib/actions/messages';

interface Props {
  conversationId: string;
  returnTo: string;
}

type RecState = 'idle' | 'requesting' | 'recording' | 'preview' | 'sending' | 'error';

const MAX_DURATION_MS = 5 * 60 * 1000; // 5 minutes

function pickMimeType(): { mime: string; ext: string } {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    return { mime: 'audio/webm', ext: 'webm' };
  }
  const candidates: Array<{ mime: string; ext: string }> = [
    { mime: 'audio/webm;codecs=opus', ext: 'webm' },
    { mime: 'audio/webm', ext: 'webm' },
    { mime: 'audio/mp4;codecs=mp4a.40.2', ext: 'm4a' },
    { mime: 'audio/mp4', ext: 'm4a' },
    { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c.mime)) return c;
    } catch {
      /* keep trying */
    }
  }
  return { mime: 'audio/webm', ext: 'webm' };
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VoiceRecorder({ conversationId, returnTo }: Props) {
  const [state, setState] = useState<RecState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  const mimeRef = useRef<{ mime: string; ext: string }>({ mime: 'audio/webm', ext: 'webm' });
  const finalBlobRef = useRef<Blob | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        if (tickRef.current) clearInterval(tickRef.current);
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          recorderRef.current.stop();
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startRecording() {
    setError(null);
    setState('requesting');
    try {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        throw new Error('Your browser does not support voice recording.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mime = pickMimeType();
      mimeRef.current = mime;

      let mr: MediaRecorder;
      try {
        mr = new MediaRecorder(stream, { mimeType: mime.mime });
      } catch {
        // Fallback: let the browser pick
        mr = new MediaRecorder(stream);
      }
      recorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const baseType = mimeRef.current.mime.split(';')[0] ?? 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: baseType });
        finalBlobRef.current = blob;
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setState('preview');
        // Release mic
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
      };
      mr.onerror = () => {
        setError('Recording failed. Please try again.');
        setState('error');
      };

      mr.start(250); // collect chunks every 250ms
      startedAtRef.current = Date.now();
      setElapsed(0);
      setState('recording');
      tickRef.current = setInterval(() => {
        const e = Date.now() - startedAtRef.current;
        setElapsed(e);
        if (e >= MAX_DURATION_MS) stopRecording();
      }, 250);
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message.includes('Permission')
            ? 'Microphone permission denied. Allow mic access in your browser and try again.'
            : e.message
          : 'Could not start recording.';
      setError(msg);
      setState('error');
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    }
  }

  function stopRecording() {
    try {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      const mr = recorderRef.current;
      if (mr && mr.state !== 'inactive') mr.stop();
    } catch {
      /* ignore */
    }
  }

  function discard() {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    finalBlobRef.current = null;
    chunksRef.current = [];
    setElapsed(0);
    setError(null);
    setState('idle');
  }

  function send() {
    const blob = finalBlobRef.current;
    const form = formRef.current;
    const input = fileInputRef.current;
    if (!blob || !form || !input) return;
    try {
      const ext = mimeRef.current.ext || 'webm';
      const filename = `voice-${Date.now()}.${ext}`;
      const file = new File([blob], filename, { type: blob.type || 'audio/webm' });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      setState('sending');
      form.requestSubmit();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not attach voice clip.');
      setState('error');
    }
  }

  // -------- UI --------
  if (state === 'idle' || state === 'requesting' || state === 'error') {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={startRecording}
          disabled={state === 'requesting'}
          aria-label="Record voice message"
          title="Record voice message"
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:border-violet/40 hover:text-white disabled:opacity-60"
        >
          {state === 'requesting' ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          ) : (
            <Mic className="h-4 w-4" strokeWidth={1.75} />
          )}
        </button>
        {state === 'error' && error && (
          <p className="text-[10px] text-accent-red">{error}</p>
        )}
      </div>
    );
  }

  if (state === 'recording') {
    return (
      <div className="flex items-center gap-2 rounded-full border border-accent-red/40 bg-accent-red/10 px-3 py-1.5">
        <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-accent-red" />
        <span className="font-mono text-xs font-semibold text-accent-red">
          {formatDuration(elapsed)}
        </span>
        <button
          type="button"
          onClick={stopRecording}
          aria-label="Stop recording"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-red text-white transition-colors hover:bg-accent-red/90"
        >
          <Square className="h-3.5 w-3.5" strokeWidth={1.75} fill="currentColor" />
        </button>
      </div>
    );
  }

  // preview / sending
  return (
    <div className="flex items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-3 py-1.5">
      {blobUrl && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio src={blobUrl} controls className="h-8 max-w-[180px]" />
      )}
      <span className="font-mono text-[11px] text-violet-glow">
        {formatDuration(elapsed)}
      </span>
      <button
        type="button"
        onClick={discard}
        disabled={state === 'sending'}
        aria-label="Discard"
        title="Discard"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:border-accent-red/40 hover:text-accent-red disabled:opacity-60"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={send}
        disabled={state === 'sending'}
        aria-label="Send voice message"
        title="Send voice message"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-violet text-white transition-colors hover:bg-violet/90 disabled:opacity-60"
      >
        {state === 'sending' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
        ) : (
          <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
      </button>

      {/* Hidden form posting to the existing sendMessage server action.
          Same wire-format as the file picker so we reuse the upload path. */}
      <form
        ref={formRef}
        action={sendMessage}
        encType="multipart/form-data"
        className="hidden"
      >
        <input type="hidden" name="conversationId" value={conversationId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="content" value="" />
        <input ref={fileInputRef} type="file" name="attachment" />
      </form>
    </div>
  );
}
