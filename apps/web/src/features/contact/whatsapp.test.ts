import { describe, expect, it } from 'vitest';
import { WHATSAPP_MESSAGES, whatsappHref } from './whatsapp';
import { publicEnv } from '@/lib/env';

describe('whatsappHref', () => {
  it('sin mensaje devuelve el enlace al número configurado, sin query', () => {
    expect(whatsappHref()).toBe(
      `https://wa.me/${publicEnv.NEXT_PUBLIC_WHATSAPP_PHONE}`,
    );
    expect(whatsappHref()).not.toContain('?');
  });

  it('el número sale de la configuración, no está hardcodeado (AC-5)', () => {
    expect(whatsappHref()).toContain(publicEnv.NEXT_PUBLIC_WHATSAPP_PHONE);
  });

  it('usa la forma canónica wa.me, que es la que resuelve escritorio (AC-3)', () => {
    // `api.whatsapp.com/send?phone=` no es equivalente: no hace el desvío a la
    // app de escritorio ni a WhatsApp Web.
    expect(whatsappHref()).toMatch(/^https:\/\/wa\.me\//);
    expect(whatsappHref()).not.toMatch(/api\.whatsapp\.com/);
  });

  it('agrega exactamente un parámetro `text` cuando hay mensaje', () => {
    const url = new URL(whatsappHref('hola'));
    expect([...url.searchParams.keys()]).toEqual(['text']);
  });

  it('un nombre con comillas, ampersand y numeral sobrevive intacto', () => {
    // Caso real de ferretería. Sin codificar, el `&` inyectaría un parámetro en
    // la URL de un tercero y el `#` truncaría el mensaje.
    const nombre = 'Caño 1/2" & codo #3';
    const url = new URL(whatsappHref(nombre));

    expect(url.searchParams.get('text')).toBe(nombre);
    expect([...url.searchParams.keys()]).toEqual(['text']);
  });

  it('el mensaje de producto conserva el literal que ya usa la ficha', () => {
    // Si este texto cambiara, el refactor de la ficha dejaría de ser
    // behavior-preserving sin que ningún otro test lo note.
    expect(WHATSAPP_MESSAGES.product('Heladera')).toBe(
      'Hola! Quería consultar por "Heladera".',
    );
  });
});
