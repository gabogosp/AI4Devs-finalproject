'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Package } from 'lucide-react';

/**
 * Variantes de contexto (design.md D9): se PARAMETRIZA, no se duplica el
 * componente. `hero` es el default, así que los call-sites de US-003 no
 * cambian.
 *
 * **Ninguna card lleva `priority`**: veinte imágenes prioritarias compiten
 * entre sí por ancho de banda y EMPEORAN el LCP en vez de mejorarlo.
 */
const IMAGE_VARIANTS = {
  hero: { sizes: '(max-width: 1024px) 100vw, 50vw', priority: true },
  card: { sizes: '(max-width: 768px) 50vw, 25vw', priority: false },
} as const;

export type ImageVariant = keyof typeof IMAGE_VARIANTS;

/**
 * Imagen de producto. En la ficha (`hero`) es la imagen **LCP** de la página,
 * por eso `priority` (design-system §8.1, presupuesto LCP < 2.5 s de US §9);
 * en la grilla (`card`) no.
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
  decorative = false,
  variant = 'hero',
}: {
  src: string | null;
  name: string;
  /**
   * Opcional desde US-004 (`design.md` D6). Un resultado de búsqueda no trae
   * categoría: `interpreted_as` describe la **consulta**, no el producto, y
   * pasarlo acá pondría en el `alt` de una imagen una frase sobre lo que alguien
   * buscó — peor para quien usa lector de pantalla que no decir la categoría.
   *
   * Sin ella el `alt` es el nombre del producto, que sigue siendo descriptivo.
   * El cambio es aditivo: ningún call-site de US-002/US-003 se toca.
   */
  categoryName?: string;
  /**
   * Marca la imagen como **decorativa** (US-004): el nombre del producto ya
   * está como texto justo al lado, dentro del mismo enlace.
   *
   * Sin esto, un lector de pantalla lee el nombre dos veces —una por el `alt` y
   * otra por el encabezado— y axe lo reporta como `image-redundant-alt`. La
   * imagen no aporta información que el texto adyacente no dé ya, y en ese caso
   * lo accesible es que no la anuncie: repetir no es describir.
   *
   * En la ficha (`hero`) NO aplica: ahí la imagen es el contenido principal y su
   * `alt` es lo que indexa Google Images.
   */
  decorative?: boolean;
  variant?: ImageVariant;
}) {
  const [broken, setBroken] = useState(false);
  const { sizes, priority } = IMAGE_VARIANTS[variant];

  // Sin imagen (AC-6) o carga rota → mismo placeholder: el layout no cambia.
  if (!src || broken) {
    return (
      <div
        // Decorativa: se oculta del árbol accesible en vez de anunciar un
        // placeholder que no agrega nada al nombre que ya está al lado.
        {...(decorative
          ? { 'aria-hidden': true }
          : { role: 'img', 'aria-label': `${name} — sin imagen disponible` })}
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
        alt={decorative ? '' : categoryName ? `${name} — ${categoryName}` : name}
        fill
        priority={priority}
        sizes={sizes}
        onError={() => setBroken(true)}
        className="object-contain"
      />
    </div>
  );
}
