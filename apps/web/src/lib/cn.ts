import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional + de-conflicted class merging. Standard shadcn-style utility.
 *   cn('p-4', condition && 'bg-violet', { 'opacity-50': disabled })
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
