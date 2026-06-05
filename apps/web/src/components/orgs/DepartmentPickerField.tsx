'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/orgs/DepartmentPickerField.tsx
//
//  Reusable form field for picking a department. Used by:
//    · /client/jobs/new        — Department selector at post time
//    · ReassignInvoiceDepartmentDialog — post-issuance reclassification
//
//  Native <select> styled to match the rest of the form primitives in
//  /client/jobs/new. Option labels are depth-indented with non-breaking
//  spaces so the org chart reads top-down. A cost-center suffix appears
//  in monospace when present.
//
//  The picker stays uncontrolled (defaultValue only) so it integrates with
//  FormData-based server actions without bringing React state along. If
//  you need an onChange hook, pass `onValueChange`.
//
//  Layout: the surrounding form supplies the label and hint; this
//  component renders only the select itself (matching the Field/Select
//  primitives in jobs/new/page.tsx).
// ════════════════════════════════════════════════════════════════════════════

import { useId } from 'react';
import type { DepartmentPickerOption } from '@/lib/data/orgStructure.types';
import { cn } from '@/lib/cn';

interface Props {
  /** Form field name. Defaults to "departmentId". */
  name?: string;
  /** Label shown above the select. Defaults to "Department". */
  label?: string;
  /** Hint text under the select. */
  hint?: string;
  /** Departments to show, depth-annotated. Empty array hides the field. */
  departments: DepartmentPickerOption[];
  /** Pre-selected dept id (e.g. user's primary assignment). */
  defaultDepartmentId?: string | null;
  /**
   * The "no attribution" choice shown at the top.
   *   'allow'  → renders "— Unattributed —" option. The submitted value is "".
   *   'hide'   → no opt-out; the user must pick a department.
   * Defaults to 'allow' since the job-post field is optional.
   */
  unattributedMode?: 'allow' | 'hide';
  /** Label for the unattributed option. Defaults to "— Unattributed —". */
  unattributedLabel?: string;
  /** Optional name of the organization for the hint line. */
  orgName?: string;
  /** Optional click handler so parents can react to a change. */
  onValueChange?: (value: string | null) => void;
  /** Disable the entire field. */
  disabled?: boolean;
}

export function DepartmentPickerField({
  name = 'departmentId',
  label = 'Department',
  hint,
  departments,
  defaultDepartmentId,
  unattributedMode = 'allow',
  unattributedLabel = 'Unattributed',
  orgName,
  onValueChange,
  disabled = false,
}: Props) {
  const id = useId();

  // If no departments, render a discreet read-only notice so the layout
  // doesn't shift and the user knows why the picker is absent.
  if (departments.length === 0) {
    return (
      <div>
        <label
          htmlFor={id}
          className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
        >
          {label}
        </label>
        <p className="mt-2 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] px-3 py-2.5 text-xs text-zinc-500">
          {orgName ? `${orgName} hasn't` : 'Your organization hasn\'t'}{' '}
          set up department structure yet. Spend will roll up under
          &ldquo;Unattributed&rdquo; until departments are created.
        </p>
        {/* Submit an empty value so the action sees the field name. */}
        <input type="hidden" name={name} value="" />
      </div>
    );
  }

  return (
    <div>
      <label
        htmlFor={id}
        className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
      >
        {label}
      </label>
      <div className="relative mt-2">
        <select
          id={id}
          name={name}
          defaultValue={defaultDepartmentId ?? ''}
          disabled={disabled}
          onChange={
            onValueChange
              ? (e) => onValueChange(e.currentTarget.value || null)
              : undefined
          }
          className={cn(
            'w-full appearance-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 pr-9 text-sm text-white focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          {unattributedMode === 'allow' && (
            <option value="">{unattributedLabel}</option>
          )}
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {renderOptionLabel(d)}
            </option>
          ))}
        </select>
        {/* Custom caret, keeps the visual consistent with the form's
            other Select primitives, which also use the appearance-none
            approach. */}
        <svg
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
          viewBox="0 0 20 20"
          fill="none"
        >
          <path
            d="M5 7l5 5 5-5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      {hint && <p className="mt-1.5 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

/**
 * Render an option label with depth-based indentation. We use Unicode
 * NB-spaces because <option> elements ignore leading regular whitespace
 * in most browsers but honour NB-spaces consistently. The cost-center
 * suffix sits right-aligned via a wide gap (non-breaking spaces) so it
 * still reads cleanly in the native select dropdown.
 */
function renderOptionLabel(d: DepartmentPickerOption): string {
  const indent = '  '.repeat(Math.max(0, d.depth));
  const arrow = d.depth > 0 ? '↳ ' : '';
  const base = `${indent}${arrow}${d.name}`;
  return d.cost_center ? `${base}, ${d.cost_center}` : base;
}
