import { IsInt, Max, Min } from 'class-validator';

/**
 * Tope de unidades por línea. Se lee de `process.env` y no de `ConfigService`
 * porque los decoradores de `class-validator` se evalúan al **definir la clase**,
 * antes de que exista el contenedor de DI. El valor sigue siendo el mismo que
 * valida `envSchema` al arrancar (`CART_MAX_QTY_PER_LINE`), así que un valor
 * inválido ya hizo fallar el arranque antes de llegar acá.
 */
const MAX_QTY = Number(process.env.CART_MAX_QTY_PER_LINE ?? 99);

/**
 * Entrada de `PUT /v1/cart/items/{slug}` — **un solo campo** (§4).
 *
 * Que no declare `unit_price_ars_cents`, `product_id` ni `cart_id` no es una
 * omisión: con el `ValidationPipe` global en `forbidNonWhitelisted: true`,
 * mandarlos es un **422**, no un campo ignorado. La diferencia importa — un campo
 * ignorado en silencio invita a probar si alguna versión futura lo acepta; un 422
 * dice que no existe. Y todos los importes se derivan server-side del precio
 * vigente de `products`: no hay forma de que el cliente proponga un precio.
 *
 * `Max` acota el DoS de la cota por línea (§7.3); `Min(1)` porque cantidad 0 no es
 * una línea: es un `DELETE`.
 */
export class SetCartItemDto {
  @IsInt({ message: 'quantity debe ser un entero' })
  @Min(1, { message: 'quantity debe ser al menos 1' })
  @Max(MAX_QTY, { message: `quantity no puede superar ${MAX_QTY}` })
  quantity!: number;
}
