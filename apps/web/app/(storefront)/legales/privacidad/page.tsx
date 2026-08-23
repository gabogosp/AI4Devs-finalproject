import { LEGAL_DOCUMENTS } from '@/features/legal/content';
import { LegalDocument } from '@/features/legal/LegalDocument';
import { legalMetadata } from '@/features/legal/legalMetadata';

/**
 * Página legal: sólo compone. El contenido vive en `content.ts`, la
 * presentación en `LegalDocument` y los metadatos en `legalMetadata`.
 *
 * Ruta explícita y no un segmento `[doc]` dinámico: dos documentos conocidos
 * no justifican un parámetro que validar ni una rama `notFound()`
 * (`design.md` D2). Y **sin `loading.tsx`**: una boundary de Suspense
 * compromete el status 200 antes de tiempo (F59) y acá no hay nada asíncrono
 * que esperar — el contenido es estático.
 */
const doc = LEGAL_DOCUMENTS.privacidad;

export const metadata = legalMetadata(doc);

export default function PrivacidadPage() {
  return <LegalDocument doc={doc} />;
}
