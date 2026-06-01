// ════════════════════════════════════════════════════════════════════════════
//  components/forms/TagInput.tsx — premium tag/chip input
//
//  Click in, type a value, hit Enter (or comma) → it becomes a removable chip.
//  Backspace at an empty input deletes the last chip. Hidden <input> stays in
//  sync so it submits with the form as comma-joined value.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { X, Plus, Tag, Sparkles } from 'lucide-react';

interface Props {
  /** Hidden input name — submits as comma-joined string. */
  name: string;
  /** Comma-separated initial tags. */
  defaultValue?: string;
  /** Placeholder shown when the input is empty AND there are no tags. */
  placeholder?: string;
  /** Hard cap on the number of tags. */
  maxItems?: number;
  /** Optional autocomplete list (slug + label). Shown as suggestions. */
  suggestions?: ReadonlyArray<{ slug: string; label: string }>;
  /** Cosmetic: title above the input. */
  title?: string;
  /** Cosmetic: tagline. */
  hint?: string;
}

function normalize(raw: string): string {
  return raw.trim().replace(/^,+|,+$/g, '').trim();
}

export function TagInput({
  name,
  defaultValue = '',
  placeholder = 'Type a value and press Enter',
  maxItems = 200,
  suggestions = [],
  title,
  hint,
}: Props) {
  const initial = useMemo(
    () =>
      defaultValue
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [defaultValue],
  );
  const [tags, setTags] = useState<string[]>(initial);
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  // Unique id so the combobox input can reference its listbox via aria-controls
  // (required by the ARIA combobox role) without colliding across instances.
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredSuggestions = useMemo(() => {
    if (!input.trim()) return [];
    const q = input.trim().toLowerCase();
    const taken = new Set(tags.map((t) => t.toLowerCase()));
    return suggestions
      .filter(
        (s) =>
          !taken.has(s.label.toLowerCase()) &&
          !taken.has(s.slug.toLowerCase()) &&
          (s.label.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q)),
      )
      .slice(0, 6);
  }, [input, suggestions, tags]);

  function add(raw: string) {
    const clean = normalize(raw);
    if (!clean) return;
    if (tags.length >= maxItems) return;
    if (tags.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      setInput('');
      return;
    }
    setTags((prev) => [...prev, clean]);
    setInput('');
  }

  function remove(i: number) {
    setTags((prev) => prev.filter((_, idx) => idx !== i));
    inputRef.current?.focus();
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(input);
    } else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
      e.preventDefault();
      remove(tags.length - 1);
    } else if (e.key === 'Escape') {
      setInput('');
    }
  }

  // Keep the hidden input in sync (some browsers' autofill).
  useEffect(() => {
    /* noop, value is bound directly on hidden input */
  }, [tags]);

  return (
    <div className="space-y-2">
      {(title || hint) && (
        <div>
          {title && (
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-industrial text-violet-glow/80">
              <Sparkles className="h-3 w-3" strokeWidth={2} />
              {title}
            </p>
          )}
          {hint && <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>}
        </div>
      )}

      <div
        role="group"
        aria-label={title ?? 'Tag input'}
        onClick={() => inputRef.current?.focus()}
        className={`relative flex flex-wrap items-center gap-1.5 rounded-2xl border bg-gradient-to-br p-2.5 transition-all duration-200 ${
          focused
            ? 'border-violet/50 from-violet/[0.08] to-violet/[0.02] shadow-[0_0_0_4px_rgba(124,58,237,0.10)]'
            : tags.length > 0
              ? 'border-violet/25 from-white/[0.04] to-white/[0.01]'
              : 'border-white/10 from-white/[0.03] to-white/[0.01] hover:border-white/20'
        }`}
      >
        {tags.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="group inline-flex items-center gap-1.5 rounded-full border border-violet/30 bg-violet/15 py-1 pl-2.5 pr-1 text-xs font-medium text-violet-glow shadow-sm transition-all hover:border-violet/50 hover:bg-violet/20"
          >
            <Tag className="h-3 w-3 shrink-0 opacity-70" strokeWidth={2} />
            <span className="max-w-[18rem] truncate">{tag}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(i);
              }}
              aria-label={`Remove ${tag}`}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-violet-glow/70 transition-colors hover:bg-violet/30 hover:text-white"
            >
              <X className="h-3 w-3" strokeWidth={2.5} />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={tags.length === 0 ? placeholder : 'Add another…'}
          className="min-w-[8rem] flex-1 bg-transparent px-1.5 py-1 text-sm text-white placeholder:text-zinc-500 focus:outline-none"
          role="combobox"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-expanded={filteredSuggestions.length > 0}
        />

        {input.trim() && (
          <button
            type="button"
            onClick={() => add(input)}
            className="inline-flex items-center gap-1 rounded-full bg-violet px-3 py-1 text-xs font-semibold text-white shadow-sm transition-all hover:bg-violet/90 active:scale-95"
          >
            <Plus className="h-3 w-3" strokeWidth={2.5} />
            Add
          </button>
        )}

        {/* Hidden form input — what actually submits. */}
        <input type="hidden" name={name} value={tags.join(', ')} />

        {/* Suggestions dropdown */}
        {focused && filteredSuggestions.length > 0 && (
          <div
            id={listboxId}
            role="listbox"
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-ink-900/95 p-1 shadow-2xl backdrop-blur-xl"
          >
            {filteredSuggestions.map((s) => (
              <button
                key={s.slug}
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(s.label);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:bg-violet/10 hover:text-white"
              >
                <Tag className="h-3 w-3 text-violet-glow/70" strokeWidth={2} />
                <span className="flex-1 truncate">{s.label}</span>
                <span className="font-mono text-[10px] text-zinc-500">
                  {s.slug}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="flex items-center justify-between text-[10px] text-zinc-500">
        <span>
          {tags.length} of {maxItems} · Enter or comma to add
        </span>
        {tags.length > 0 && (
          <button
            type="button"
            onClick={() => setTags([])}
            className="text-zinc-500 transition-colors hover:text-accent-red"
          >
            Clear all
          </button>
        )}
      </p>
    </div>
  );
}
