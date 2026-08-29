'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'destructive';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary-dark',
  secondary: 'bg-surface text-foreground border border-border hover:bg-gray-100',
  accent: 'bg-accent-strong text-white hover:opacity-90',
  ghost: 'bg-transparent text-foreground hover:bg-gray-100',
  destructive: 'bg-error text-white hover:opacity-90',
};

/**
 * Botón accesible del design-system: variantes, estado `loading` (`aria-busy`),
 * área táctil ≥44px, focus ring `shadow-focus`.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', loading = false, disabled, className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        className={cn(
          'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md px-4 text-sm font-medium',
          'transition-colors focus:outline-none focus-visible:shadow-focus',
          'disabled:cursor-not-allowed disabled:opacity-60',
          VARIANTS[variant],
          className,
        )}
        {...props}
      >
        {loading && <span aria-hidden="true">…</span>}
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
