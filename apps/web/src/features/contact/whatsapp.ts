import { publicEnv } from '@/lib/env';

/**
 * Único constructor del enlace de WhatsApp de todo el sitio (AC-5).
 *
 * Función pura, sin hook ni estado: así la consumen tanto un Server Component
 * (header, footer) como uno de cliente (la ficha), sin duplicar la composición
 * ni el número.
 *
 * Se usa la forma canónica `wa.me` y no `api.whatsapp.com/send?phone=`: son
 * distintas, y es `wa.me` la que resuelve el desvío a la app móvil, a WhatsApp
 * Web o a la app de escritorio según el dispositivo (AC-3). Eso hace que el
 * caso de escritorio no requiera ninguna detección: la resuelve el enlace.
 */
export function whatsappHref(message?: string): string {
  const base = `https://wa.me/${publicEnv.NEXT_PUBLIC_WHATSAPP_PHONE}`;
  // `encodeURIComponent` siempre: en una ferretería los nombres reales llevan
  // comillas y ampersands (`Caño 1/2" & codo #3`). Sin codificar, el `&`
  // inyectaría un parámetro de query en la URL de un tercero y el `#` truncaría
  // el mensaje en silencio.
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/**
 * Catálogo de mensajes prellenados. Están acá y no en cada call-site para que
 * el copy sea revisable en un solo lugar.
 */
export const WHATSAPP_MESSAGES = {
  general: '¡Hola! Quería hacer una consulta.',
  /**
   * Literal idéntico al que US-003 ya usa en la ficha: el refactor que la migra
   * a esta pieza no debe cambiar nada observable.
   */
  product: (name: string) => `Hola! Quería consultar por "${name}".`,
} as const;
