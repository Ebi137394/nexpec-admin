'use client';

import { motion, useMotionValue, useSpring } from 'framer-motion';
import { useRef, type ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * A button that subtly pulls toward the cursor when the pointer is near.
 * The translation is tiny by design — large magnetic offsets read as gimmick.
 * Falls back to no-op on touch / coarse pointer devices.
 */
type MagneticButtonProps = ComponentProps<typeof motion.a>;

export function MagneticButton({
  children,
  className,
  ...rest
}: MagneticButtonProps) {
  const ref = useRef<HTMLAnchorElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 220, damping: 18, mass: 0.4 });

  const handlePointerMove = (e: React.PointerEvent<HTMLAnchorElement>) => {
    if (e.pointerType !== 'mouse') return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = e.clientX - rect.left - rect.width / 2;
    const relY = e.clientY - rect.top - rect.height / 2;
    // Cap the translation so the button never leaves its tap target.
    const cap = 8;
    x.set(Math.max(-cap, Math.min(cap, relX * 0.25)));
    y.set(Math.max(-cap, Math.min(cap, relY * 0.25)));
  };

  const handlePointerLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.a
      ref={ref}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={{ x: sx, y: sy }}
      className={cn(className)}
      {...rest}
    >
      {children}
    </motion.a>
  );
}
