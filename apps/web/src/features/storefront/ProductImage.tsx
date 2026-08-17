'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Package } from 'lucide-react';

/**
 * Imagen principal de la ficha. Es la imagen **LCP** de la página, por eso
 * `priority` (design-system §8.1, presupuesto LCP < 2.5 s de US §9).
 *
 * Hoja `client` mínima porque necesita `onError` (next-standards §2): una URL
 * que el dueño cargó puede romperse en cualquier momento, y el broken-image
 * nativo del browser es inaceptable en la página de conversión
 * (`frontend-resilience-patterns` #11). El resto de la ficha es Server
 * Component.
 */
export function ProductImage({
  src,
  name,
  categoryName,
}: {
  src: string | null;
  name: string;
  categoryName: string;
}) {
  const [broken, setBroken] = useState(false);

  // Sin imagen (AC-6) o carga rota → mismo placeholder: el layout no cambia.
  if (!src || broken) {
    return (
      <div
        role="img"
        aria-label={`${name} — sin imagen disponible`}
        className="flex aspect-square w-full items-center justify-center rounded-lg bg-gray-100"
      >
        <Package className="h-16 w-16 text-gray-400" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-gray-100">
      <Image
        src={src}
        // Alt descriptivo, nunca "imagen": es lo que lee un lector de pantalla
        // y lo que indexa Google Images (WCAG 2.1 AA).
        alt={`${name} — ${categoryName}`}
        fill
        priority
        sizes="(max-width: 1024px) 100vw, 50vw"
        onError={() => setBroken(true)}
        className="object-contain"
      />
    </div>
  );
}
