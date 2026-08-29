import { z } from 'zod';

/**
 * Tope de bcrypt: **72 bytes**, no 72 caracteres (US-014 T2.1).
 *
 * bcrypt trunca en silencio a partir de ahí, así que una contraseña más larga
 * es en realidad la misma que sus primeros 72 bytes — el usuario creería tener
 * más entropía de la que tiene. Y el límite es en bytes: "ñ" o un emoji ocupan
 * más de uno, así que `value.length` dejaría pasar cadenas que el backend sí
 * trunca.
 */
export const PASSWORD_MAX_BYTES = 72;

export const passwordSchema = z
  .string()
  .min(8, 'Al menos 8 caracteres')
  .refine(
    (v) => new TextEncoder().encode(v).length <= PASSWORD_MAX_BYTES,
    `Demasiado larga (máximo ${PASSWORD_MAX_BYTES} bytes)`,
  );

export const emailSchema = z
  .string()
  .min(1, 'El email es requerido')
  .email('Email inválido');
