'use client';

import { useFormStatus } from 'react-dom';
import { cn } from '@/lib/cn';
import { Loader2 } from 'lucide-react';

/**
 * Submit button that reads the parent form's pending state and shows a
 * spinner inline. Disables itself during submission to prevent
 * double-fires (the server action also debounces by replacing the form's
 * input, but defense in depth is cheap here).
 */
export function SubmitButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        'btn-primary group w-full justify-center disabled:opacity-60 disabled:hover:bg-violet disabled:hover:shadow-glow',
        className,
      )}
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Working…</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
