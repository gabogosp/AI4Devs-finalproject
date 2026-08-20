import { MessageCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { whatsappHref } from './whatsapp';

/**
 * Enlace al canal de WhatsApp, compartido por header, footer y ficha (AC-1/AC-2).
 *
 * Server Component a propósito: no necesita estado ni handlers, así que header y
 * footer siguen sin enviar JavaScript de cliente a toda página pública.
 *
 * Es presentacional puro: **no compone la URL**, se la pide a `whatsappHref`.
 * Esa separación es lo que sostiene AC-5 — hay un solo lugar donde vive el
 * número y la forma del enlace.
 */
export function WhatsAppLink({
  label,
  message,
  variant = 'accent',
  className,
}: {
  /** Obligatorio: **es** el nombre accesible del enlace, no un adorno. */
  label: string;
  message?: string;
  variant?: 'accent' | 'ghost';
  className?: string;
}) {
  return (
    <a
      href={whatsappHref(message)}
      target="_blank"
      // Sin `noopener`, la pestaña destino puede manipular `window.opener`.
      rel="noopener noreferrer"
      className={cn(
        'inline-flex min-h-[44px] w-fit items-center justify-center gap-2 rounded-md',
        'px-4 text-sm font-medium focus:outline-none focus-visible:shadow-focus',
        variant === 'accent'
          ? 'bg-accent-strong text-white'
          : 'text-foreground hover:bg-gray-100',
        className,
      )}
    >
      {/* Ícono + texto, nunca sólo ícono (design-system §7.14): el ícono va
          `aria-hidden` para que el nombre accesible sea exactamente `label`. */}
      <MessageCircle className="h-4 w-4" aria-hidden="true" />
      {label}
    </a>
  );
}
