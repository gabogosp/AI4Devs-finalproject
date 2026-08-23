import Link from 'next/link';

/**
 * Entrada al flujo de importación masiva desde el listado de productos (OQ-FE-1).
 *
 * Vive en su propio componente y **no** dentro de `ProductList` a propósito: la
 * frontera que no se mueve es el comportamiento del listado, que ya está cubierto
 * por sus tests. Un link no necesita meterse en la lógica de una tabla paginada, y
 * la página del panel es el lugar natural para las acciones de la pantalla.
 */
export function ImportEntryLink() {
  return (
    <Link href="/admin/importar" className="text-sm underline">
      Importar catálogo desde un archivo
    </Link>
  );
}
