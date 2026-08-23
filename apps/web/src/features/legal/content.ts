import { z } from 'zod';

/**
 * Contenido legal del sitio como **dato tipado**, nunca HTML.
 *
 * Los párrafos son texto plano y se renderizan como texto: `dangerouslySetInnerHTML`
 * es anti-patrón (`frontend-standards.md` §12) y acá sería además innecesario —
 * un documento legal no necesita marcado, necesita ser legible y correcto.
 *
 * **Estado del texto**: provisional. Lleva los datos que **hoy son ciertos**
 * (nombre de fantasía, domicilio del local, email de contacto, tomados de
 * `docs/project-config.yml` y del footer ya publicado) y marca lo que falta con
 * `[PENDIENTE: …]` **dentro del propio texto**, así el hueco se ve en la página
 * y no sólo en el código. La revisión legal es un gate humano del DoD de la US
 * (decisión del PO, OQ-FE-17 (a)): no hay chequeo automático que lo bloquee.
 */

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocumentContent {
  slug: 'privacidad' | 'terminos';
  title: string;
  /** Fecha ISO. MISMA versión que registra `orders.consent_terms_version` (US-008). */
  version: string;
  effective_date: string;
  /**
   * Los cuatro bloques que la Ley 25.326 exige, como **claves obligatorias del
   * tipo** y no como elementos de un array: así el compilador y el schema exigen
   * *cada uno*, en vez de "al menos cuatro secciones" —que se cumpliría con
   * cuatro cualesquiera—.
   */
  required: {
    /** Responsable del tratamiento de los datos. */
    controller: LegalSection;
    /** Finalidad del uso de los datos. */
    purpose: LegalSection;
    /** Derechos del titular de los datos. */
    rights: LegalSection;
    /** Canal de contacto para ejercerlos. */
    contact: LegalSection;
  };
  extra: LegalSection[];
}

/** Versión vigente de los términos. Igual al default del backend (US-008). */
export const LEGAL_TERMS_VERSION = '2026-06-15';

const NOMBRE = 'DSM Refrigeración y Ferretería';
const DOMICILIO = 'Av. Córdoba y Av. Pueyrredón, CABA, Argentina';
const EMAIL = 'dsm.refrigeracion.ferreteria@gmail.com';

const sectionSchema = z.object({
  heading: z.string().min(1),
  paragraphs: z.array(z.string().min(1)).min(1),
});

export const legalDocumentSchema = z.object({
  slug: z.enum(['privacidad', 'terminos']),
  title: z.string().min(1),
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  required: z.object({
    controller: sectionSchema,
    purpose: sectionSchema,
    rights: sectionSchema,
    contact: sectionSchema,
  }),
  extra: z.array(sectionSchema),
});

const privacidad: LegalDocumentContent = {
  slug: 'privacidad',
  title: 'Política de privacidad',
  version: LEGAL_TERMS_VERSION,
  effective_date: LEGAL_TERMS_VERSION,
  required: {
    controller: {
      heading: 'Quién trata tus datos',
      paragraphs: [
        `El responsable del tratamiento es ${NOMBRE}, con domicilio en ${DOMICILIO}.`,
        `Podés contactarnos por correo electrónico a ${EMAIL}.`,
        '[PENDIENTE: razón social, CUIT y domicilio legal completos — los provee el dueño antes de publicar]',
      ],
    },
    purpose: {
      heading: 'Para qué usamos tus datos',
      paragraphs: [
        'Usamos tus datos personales únicamente para gestionar tu pedido: prepararlo, coordinar la entrega o el retiro en el local, emitir el comprobante y comunicarnos con vos sobre esa compra.',
        'No los usamos para publicidad ni los cedemos, vendemos ni transferimos a terceros con fines comerciales.',
        'Compartimos con nuestro procesador de pagos únicamente lo necesario para cobrar tu compra. No almacenamos los datos de tu tarjeta: los procesa la plataforma de pago.',
      ],
    },
    rights: {
      heading: 'Tus derechos sobre tus datos',
      paragraphs: [
        'Según la Ley 25.326 de Protección de Datos Personales, tenés derecho a acceder a tus datos, rectificarlos si son inexactos, actualizarlos y solicitar su supresión.',
        'El acceso es gratuito a intervalos no menores a seis meses, salvo que acredites un interés legítimo. Respondemos dentro de los diez días corridos de recibido tu pedido.',
        'La Agencia de Acceso a la Información Pública, órgano de control de la Ley 25.326, atiende las denuncias que se presenten sobre el incumplimiento de las normas de protección de datos personales.',
        'Tus datos se alojan en servidores ubicados fuera de la Argentina. Al registrarte o comprar prestás tu consentimiento informado para esa transferencia internacional.',
      ],
    },
    contact: {
      heading: 'Cómo ejercer tus derechos',
      paragraphs: [
        `Escribinos a ${EMAIL} indicando qué querés hacer (acceder, rectificar, actualizar o suprimir) y un dato que nos permita identificar tu pedido.`,
        `También podés acercarte al local en ${DOMICILIO}.`,
      ],
    },
  },
  extra: [
    {
      heading: 'Qué datos recolectamos',
      paragraphs: [
        'Al comprar te pedimos nombre, correo electrónico, teléfono y, si elegís envío, un domicilio de entrega.',
        'Si creás una cuenta, guardamos además tu contraseña de forma cifrada. Nunca la almacenamos en texto legible ni podemos verla.',
      ],
    },
    {
      heading: 'Cuánto tiempo los conservamos',
      paragraphs: [
        'Conservamos los datos asociados a una compra mientras dure la relación comercial y por el plazo que exijan las obligaciones fiscales y contables aplicables.',
        '[PENDIENTE: plazo de retención definitivo — a confirmar con asesoría contable]',
      ],
    },
    {
      heading: 'Cambios en esta política',
      paragraphs: [
        'Si modificamos esta política publicamos la versión nueva en esta misma página, con su fecha de vigencia. La versión que aceptaste al comprar queda registrada junto a tu pedido.',
      ],
    },
  ],
};

const terminos: LegalDocumentContent = {
  slug: 'terminos',
  title: 'Términos y condiciones',
  version: LEGAL_TERMS_VERSION,
  effective_date: LEGAL_TERMS_VERSION,
  required: {
    controller: {
      heading: 'Quién opera este sitio',
      paragraphs: [
        `Este sitio es operado por ${NOMBRE}, con domicilio en ${DOMICILIO}.`,
        '[PENDIENTE: razón social, CUIT y condición frente al IVA — los provee el dueño antes de publicar]',
      ],
    },
    purpose: {
      heading: 'Qué podés hacer en este sitio',
      paragraphs: [
        'Este sitio te permite consultar nuestro catálogo, hacer un pedido y coordinar su entrega o retiro en el local.',
        'Los precios se expresan en pesos argentinos e incluyen IVA. Pueden cambiar sin aviso previo; el precio válido es el vigente al momento de confirmar el pedido.',
        'La disponibilidad que se muestra es orientativa. Si un producto no estuviera disponible después de tu compra, te contactamos para reemplazarlo o reintegrarte el importe.',
      ],
    },
    rights: {
      heading: 'Tus derechos como consumidor',
      paragraphs: [
        'Como consumidor te amparan la Ley 24.240 de Defensa del Consumidor y las normas complementarias.',
        'Tenés derecho a revocar la compra dentro de los diez días corridos de recibido el producto, sin costo ni necesidad de justificar el motivo, siempre que lo devuelvas en las condiciones en que lo recibiste (art. 34 de la Ley 24.240).',
        'Los productos cuentan con la garantía legal que corresponda según su naturaleza y con la garantía del fabricante cuando la tengan.',
      ],
    },
    contact: {
      heading: 'Cómo comunicarte con nosotros',
      paragraphs: [
        `Para consultas, reclamos o para ejercer tu derecho de revocación, escribinos a ${EMAIL} o acercate al local en ${DOMICILIO}.`,
        'Respondemos los reclamos a la brevedad y siempre dentro de los plazos que fija la normativa vigente.',
      ],
    },
  },
  extra: [
    {
      heading: 'Cómo se confirma un pedido',
      paragraphs: [
        'Tu pedido queda confirmado cuando se acredita el pago. Hasta ese momento el stock no está reservado.',
        'Te avisamos por correo electrónico cuando el pedido esté listo para retirar o en camino.',
      ],
    },
    {
      heading: 'Pagos',
      paragraphs: [
        'Los pagos se procesan a través de una plataforma de pago externa. No accedemos ni almacenamos los datos de tu tarjeta.',
      ],
    },
    {
      heading: 'Cambios en estos términos',
      paragraphs: [
        'Podemos actualizar estos términos publicando la versión nueva en esta página, con su fecha de vigencia. La versión que aceptaste al comprar queda registrada junto a tu pedido.',
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS: Record<'privacidad' | 'terminos', LegalDocumentContent> = {
  privacidad,
  terminos,
};
