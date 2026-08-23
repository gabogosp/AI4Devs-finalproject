import type { Metadata } from 'next';
import { ImportScreen } from '@/features/imports/ImportScreen';

export const metadata: Metadata = {
  title: 'Importación en curso',
  description: 'Estado, progreso y reporte de una importación de catálogo.',
};

/**
 * Deep-link de un trabajo (OQ-FE-3).
 *
 * Existe porque el backend **no tiene listado de imports** (diferido a US-016): el
 * id de la URL es el único hilo que sobrevive a un refresh, y sin él un trabajo de
 * 5.000 filas seguiría corriendo sin que la pantalla supiera cuál es.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <section className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Importar catálogo</h1>
      <ImportScreen jobId={id} />
    </section>
  );
}
