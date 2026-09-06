import { Transform } from 'class-transformer';
import { IsString, IsUrl, Length, MaxLength, ValidateIf } from 'class-validator';

/**
 * Entrada de `PATCH /v1/me` (US-024). Ambos campos SIEMPRE presentes — el
 * formulario reusa el patrón de `ProductForm.tsx` (submit del estado
 * completo, no un patch parcial): no hay ambigüedad sobre qué significa
 * omitir `avatar_url`.
 *
 * `avatar_url` NO copia el validador laxo de `image_url` de producto
 * (`@IsOptional() @IsString()`, sin verificar forma de URL) — AC-5 de esta US
 * pide explícitamente rechazar `"no-es-url"` o un esquema distinto de
 * http/https, así que acá se valida forma de URL de verdad (`design.md` D2).
 * `null` es el valor válido para "sin avatar" (AC-3) — `@ValidateIf` saltea
 * `@IsUrl`/`@MaxLength` en ese caso.
 */
export class UpdateProfileDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 120, { message: 'name debe tener entre 1 y 120 caracteres' })
  name!: string;

  @ValidateIf((o: UpdateProfileDto) => o.avatar_url !== null)
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'avatar_url debe ser una URL http o https válida' },
  )
  @MaxLength(2048, { message: 'avatar_url no puede superar los 2048 caracteres' })
  avatar_url!: string | null;
}
