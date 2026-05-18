import { cn } from '@/lib/cn';

interface AuthFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  trailing?: React.ReactNode;
}

/**
 * Form field for the auth surfaces. Label-above pattern (more accessible
 * than floating labels for screen readers), faint violet focus ring,
 * monospaced numeric input where relevant.
 */
export function AuthField({
  label,
  hint,
  trailing,
  className,
  id,
  ...rest
}: AuthFieldProps) {
  const inputId = id ?? rest.name ?? `field-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <label htmlFor={inputId} className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-industrial text-zinc-400">
        {label}
      </span>
      <span className="relative block">
        <input
          id={inputId}
          {...rest}
          className={cn(
            'w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3',
            'text-sm text-white placeholder:text-zinc-600',
            'transition-all duration-200',
            'focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none',
            'focus:ring-2 focus:ring-violet/30',
            trailing && 'pr-12',
            className,
          )}
        />
        {trailing && (
          <span className="absolute inset-y-0 right-3 flex items-center text-zinc-500">
            {trailing}
          </span>
        )}
      </span>
      {hint && <span className="mt-1.5 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}
