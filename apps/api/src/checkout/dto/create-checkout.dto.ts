import { Type } from 'class-transformer';
import { Equals, IsEmail, IsIn, IsString, Length, Matches, ValidateNested } from 'class-validator';

/**
 * Datos del comprador (AC-3). El teléfono es **obligatorio** — decisión por
 * defecto de la US §10, para coordinar el retiro y el contacto por WhatsApp de
 * US-018.
 */
export class BuyerDto {
  @IsString()
  @Length(2, 120, { message: 'name debe tener entre 2 y 120 caracteres' })
  name!: string;

  @IsEmail({}, { message: 'email no tiene un formato válido' })
  email!: string;

  @Matches(/^\+?[0-9 ()-]{8,20}$/, {
    message: 'phone no tiene un formato válido',
  })
  phone!: string;
}

/**
 * Entrada de `POST /v1/checkout` (T3.1) — con el `ValidationPipe` global en
 * `forbidNonWhitelisted: true`, **cualquier** campo extra es 422, no un campo
 * ignorado. En particular `total_ars_cents`, `items`, `cart_id`, `status` u
 * `order_number` inyectados en el cuerpo se rechazan: el total y las líneas
 * salen del carrito y del catálogo, nunca del cliente (§4, §5.5).
 *
 * `consent` con `@Equals(true)`: `false` o ausente es 422 — AC-4 no admite un
 * camino que cree la orden sin consentimiento explícito.
 *
 * `fulfillment` sólo admite `'pickup'` (sucursal única): el checkout confirma
 * el retiro, no ofrece elección de sucursal (US §10).
 */
export class CreateCheckoutDto {
  @ValidateNested()
  @Type(() => BuyerDto)
  buyer!: BuyerDto;

  @Equals(true, { message: 'consent debe aceptarse para continuar' })
  consent!: boolean;

  @IsIn(['pickup'], { message: "fulfillment debe ser 'pickup'" })
  fulfillment!: 'pickup';
}
