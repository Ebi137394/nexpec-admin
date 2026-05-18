// ════════════════════════════════════════════════════════════════════════════
//  components/reviews/StarRating.tsx — interactive 1–5 star input + display
//
//  Two modes:
//    interactive (default) — radio-group hidden inputs, hover state, click
//                             to select. Submits as form field `rating`.
//    readonly              — read-only display for an existing review row.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';

interface Props {
  /** Form field name when interactive. Defaults to "rating". */
  name?: string;
  /** Initial selection (1–5). Defaults to 0 = nothing selected. */
  defaultValue?: number;
  /** Read-only display (no inputs, no hover). */
  readOnly?: boolean;
  /** Override the rendered size. Defaults to 5 (h-5 w-5). */
  size?: 4 | 5 | 6 | 8;
  /** Required for form submission when interactive. */
  required?: boolean;
}

export function StarRating({
  name = 'rating',
  defaultValue = 0,
  readOnly = false,
  size = 5,
  required = false,
}: Props) {
  const [selected, setSelected] = useState<number>(defaultValue);
  const [hover, setHover] = useState<number>(0);
  const sizeClass = `h-${size} w-${size}`;
  const active = hover || selected;

  if (readOnly) {
    return (
      <div className="inline-flex items-center gap-0.5" aria-label={`${defaultValue} of 5 stars`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className={`${sizeClass} ${
              n <= defaultValue ? 'fill-accent-amber text-accent-amber' : 'text-zinc-700'
            }`}
            strokeWidth={1.5}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Star rating"
      className="inline-flex items-center gap-1"
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={selected === n}
          aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
          onMouseEnter={() => setHover(n)}
          onClick={() => setSelected(n)}
          className="rounded p-0.5 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-violet/40"
        >
          <Star
            className={`${sizeClass} transition-colors ${
              n <= active ? 'fill-accent-amber text-accent-amber' : 'text-zinc-600'
            }`}
            strokeWidth={1.5}
          />
        </button>
      ))}
      {/* Hidden input that carries the form value */}
      <input
        type="hidden"
        name={name}
        value={selected || ''}
        required={required}
      />
    </div>
  );
}
