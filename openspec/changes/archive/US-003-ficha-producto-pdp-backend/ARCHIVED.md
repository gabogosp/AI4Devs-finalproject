# Archivado manualmente — 2026-08-20

`/archive-change` está bloqueado por el gap **F54**, así que el archivado de las
tres disciplinas de US-003 se hizo a mano siguiendo el mismo procedimiento con
que se archivó US-001.

## Delta aplicado al contrato vivo (`openspec/specs/catalogo/`)

- **Path nuevo** `/products/{slug}` → `openapi/paths/storefront-products-slug.yaml`.
- **Schema nuevo** `StorefrontProduct`, deliberadamente distinto de `Product`: la
  vista pública expone `in_stock` como booleano y **no** el nivel de stock.
- **Response reusable** `RateLimited` (§7.3), que US-001 declaraba inline por
  endpoint.
- Tag `storefront-products` y descripción del contrato actualizada: las rutas de
  navegación por categorías se suman al archivar **US-002**.

## Defecto preexistente corregido de paso

Los archivos de `openapi/paths/` usaban `$ref: '#/components/...'`, que resuelve
contra la raíz de **ese** archivo y no contra el contrato padre. El contrato vivo
**no resolvía**: 15 `invalid-ref` desde que se archivó US-001. Como el contrato
vivo es la fuente que consumen los generadores de cliente, un contrato que no
resuelve es decorativo.

Reapuntados a `../../openapi.yaml#/components/...`. Ahora `spectral lint` da 0
errores sobre la raíz. Vale la pena revisar si el procedimiento de archivado del
framework debería emitir esta forma desde el principio.
