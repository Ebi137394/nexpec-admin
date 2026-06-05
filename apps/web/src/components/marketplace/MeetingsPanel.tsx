'use client';
// components/marketplace/MeetingsPanel.tsx — web Brokered War Room panel.
//
// Desktop mirror of the mobile MeetingsPanel. List + launch (new tab) + schedule.
// The golden-rule guard (client↔inspector needs an admin host) is enforced in
// schedule_meeting() server-side; this panel surfaces the rejection plainly.
import { useEffect, useState } from 'react';
import { Video, ExternalLink } from 'lucide-react';
import { fetchMeetings, scheduleMeeting, type Meeting } from '@/lib/data/marketplace';

interface Party { id: string; label: string; role: string; }
const PROVIDERS: ReadonlyArray<readonly [string, string]> = [['zoom', 'Zoom'], ['teams', 'Teams'], ['meet', 'Meet'], ['other', 'Other']];
const inp = 'w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white placeholder-white/40 outline-none focus:border-violet';

export function MeetingsPanel({ jobId, rfqId, parties = [] }: { jobId?: string; rfqId?: string; parties?: Party[] }) {
  const [items, setItems] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [provider, setProvider] = useState('zoom');
  const [when, setWhen] = useState('');
  const [invited, setInvited] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => { setLoading(true); fetchMeetings({ jobId, rfqId }).then(setItems).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, [jobId, rfqId]);

  const toggle = (id: string) => setInvited((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const submit = async () => {
    setErr(null);
    if (!title.trim()) { setErr('Title required.'); return; }
    if (!/^https?:\/\//i.test(url.trim())) { setErr('Enter a valid meeting URL.'); return; }
    if (!when) { setErr('Pick a date & time.'); return; }
    setBusy(true);
    try {
      const { error } = await scheduleMeeting({
        title: title.trim(), url: url.trim(), scheduled_at: new Date(when).toISOString(), participant_ids: invited,
        job_id: jobId ?? null, rfq_id: rfqId ?? null, provider, duration_min: 30,
      });
      if (error) {
        setErr(error.message.includes('admin_host_required')
          ? 'Client↔inspector meetings must be hosted by a NEXPEC admin. Ask operations to convene this call.'
          : error.message);
        return;
      }
      setOpen(false); setTitle(''); setUrl(''); setInvited([]); setWhen(''); load();
    } finally { setBusy(false); }
  };

  return (
    <section className="rounded-xl border border-ink-600 bg-ink-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold">Meetings</h3>
        <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-full bg-violet px-3 py-1.5 text-xs font-bold hover:bg-violet-deep">
          <Video size={14} /> Schedule
        </button>
      </div>

      {loading ? <p className="text-sm text-white/50">Loading…</p>
        : items.length === 0 ? <p className="text-sm text-white/50">No meetings scheduled.</p>
        : (
          <ul className="space-y-2">
            {items.map((m) => (
              <li key={m.id} className={`flex items-center gap-3 rounded-lg border border-ink-600 bg-ink-950 p-3 ${m.status === 'cancelled' ? 'opacity-50' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{m.title}</p>
                  <p className="text-xs text-white/50">{m.provider.toUpperCase()}, {new Date(m.scheduled_at).toLocaleString()}{m.status !== 'scheduled' ? `, ${m.status}` : ''}</p>
                </div>
                {m.status !== 'cancelled' && (
                  <a href={m.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-violet px-3 py-1.5 text-xs font-bold text-violet-glow hover:bg-violet/10">
                    <ExternalLink size={13} /> Join
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}

      {open && (
        <div className="mt-4 space-y-3 rounded-lg border border-ink-600 bg-ink-950 p-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. FAT pre-sync" className={inp} />
          <div className="flex gap-2">
            {PROVIDERS.map(([v, l]) => (
              <button key={v} onClick={() => setProvider(v)} className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-bold ${provider === v ? 'border-violet bg-violet text-white' : 'border-ink-600 bg-ink-800 text-white/70'}`}>{l}</button>
            ))}
          </div>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste meeting link (https://…)" className={inp} />
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={inp} />
          {parties.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-white/60">Invite</p>
              <div className="flex flex-wrap gap-2">
                {parties.map((p) => {
                  const on = invited.includes(p.id);
                  return <button key={p.id} onClick={() => toggle(p.id)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${on ? 'border-violet bg-violet text-white' : 'border-ink-600 bg-ink-800 text-white/70'}`}>{p.label}</button>;
                })}
              </div>
              <p className="mt-2 text-xs text-white/40">Client↔inspector calls are hosted by a NEXPEC admin.</p>
            </div>
          )}
          {err && <p className="text-sm text-accent-red">{err}</p>}
          <button onClick={submit} disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet py-2.5 text-sm font-bold hover:bg-violet-deep disabled:opacity-60">
            <Video size={15} /> {busy ? 'Scheduling…' : 'Schedule & notify'}
          </button>
        </div>
      )}
    </section>
  );
}
