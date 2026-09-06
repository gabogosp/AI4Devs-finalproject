'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { avatarColor, initialsFrom } from '@/lib/format/avatar';

type Size = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-12 w-12 text-sm',
  lg: 'h-24 w-24 text-2xl',
};

export interface AvatarProps {
  name: string;
  customerId: string;
  avatarUrl?: string | null;
  /** 32px / 48px / 96px. */
  size?: Size;
}

/**
 * Avatar compartido (US-024, C2a). Con `avatarUrl` presente renderiza la
 * imagen; si falla al cargar (`onError`) degrada a un círculo de iniciales
 * en vez del ícono roto nativo del navegador
 * (`frontend-resilience-patterns` skill, patrón #11 — image error fallback).
 * Sin `avatarUrl`, el círculo de iniciales es el estado normal, no un error.
 *
 * Color determinístico por `customerId` (`avatarColor`) — mismo cliente,
 * mismo color siempre, sin persistir nada nuevo.
 */
export function Avatar({ name, customerId, avatarUrl, size = 'md' }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const mostrarImagen = Boolean(avatarUrl) && !broken;

  if (mostrarImagen) {
    return (
      // URL arbitraria pegada por la persona (US §4): `next/image` exige un
      // dominio conocido para optimizar, y esta imagen puede venir de
      // cualquier host.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl!}
        alt={`Avatar de ${name}`}
        onError={() => setBroken(true)}
        className={cn('rounded-full object-cover', SIZE_CLASSES[size])}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={`Avatar de ${name}`}
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold text-white',
        SIZE_CLASSES[size],
      )}
      style={{ backgroundColor: avatarColor(customerId) }}
    >
      {initialsFrom(name)}
    </span>
  );
}
