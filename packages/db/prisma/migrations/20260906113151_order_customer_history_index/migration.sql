-- US-015 T0.1 — reemplaza el índice de una sola columna sobre `customer_id`
-- por uno compuesto `(customer_id, created_at)`, mismo patrón que
-- `password_reset_tokens_customer_id_created_at_idx`.
--
-- Escrita a mano en vez de aceptar el diff auto-generado por `prisma migrate
-- dev`: el diff automático arrastra ruido preexistente no relacionado con este
-- cambio (drop/recreate del índice HNSW de `product_embeddings` y del GIN de
-- `products.search_document`, ambos declarados `Unsupported` en schema.prisma
-- por diseño — ver comentarios de las migraciones `20260823002111` y
-- `20260823150000` — y un drop/recreate cosmético de la FK de
-- `order_status_history` y de la secuencia `orders_order_number_seq`). Ninguno
-- de esos objetos cambia en este migration; sólo el índice de `orders`.
--
-- Migración aditiva desde el punto de vista de datos: no borra columnas ni
-- filas, sólo reemplaza un índice por otro que cubre el mismo prefijo
-- (`customer_id`) más `created_at` — ningún método de `OrdersRepository` usaba
-- el índice de una sola columna en soledad (ver design.md §Trade-offs).

-- DropIndex
DROP INDEX "orders_customer_id_idx";

-- CreateIndex
CREATE INDEX "orders_customer_id_created_at_idx" ON "orders"("customer_id", "created_at");
