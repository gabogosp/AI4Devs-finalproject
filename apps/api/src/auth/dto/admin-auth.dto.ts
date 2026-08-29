import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import { normalizeEmail } from '../email/normalize-email';

/**
 * Login admin (ADR-0009). Acepta **dos** formas y ninguna más:
 *
 * - `{ bootstrapToken }` — el camino interino de US-001, que queda como salida de
 *   emergencia detrás de `ADMIN_AUTH_ENABLED`.
 * - `{ email, password }` — el camino que US-014 agrega.
 *
 * La validación es condicional en vez de dos DTOs con dos rutas: la ruta, el
 * transporte y la forma de la respuesta **no cambian**, que es exactamente lo que
 * ADR-0009 prometió — churn cero en el frontend de US-001.
 */
export class AdminLoginDto {
  @ValidateIf((o: AdminLoginDto) => !o.email && !o.password)
  @IsString()
  @IsNotEmpty({ message: 'bootstrapToken o email+password son requeridos' })
  bootstrapToken?: string;

  @ValidateIf((o: AdminLoginDto) => !o.bootstrapToken)
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsEmail({}, { message: 'email debe ser una dirección válida' })
  email?: string;

  @ValidateIf((o: AdminLoginDto) => !o.bootstrapToken)
  @IsString()
  @IsNotEmpty({ message: 'password es requerida' })
  password?: string;
}

export class AdminLoginResponseDto {
  token!: string;
}
