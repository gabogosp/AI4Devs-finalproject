import type { Metadata } from 'next';
import { ImportScreen } from '@/features/imports/ImportScreen';

export const metadata: Metadata = {
  title: 'Importar catálogo',
  description:
    'Carga masiva de productos desde un archivo CSV o Excel, con reporte de las filas rechazadas.',
};

export default function Page() {
  return (
    <section className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Importar catálogo</h1>
      <ImportScreen />
    </section>
  );
}
