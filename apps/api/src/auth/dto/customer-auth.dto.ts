import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { SafeCustomer } from '../customers.repository';
import { normalizeEmail } from '../email/normalize-email';

/**
 * Normaliza el email **antes** de validarlo.
 *
 * Sin esto, `@IsEmail` rechaza `'  Ana@Example.com '` con un 422 y el alta falla
 * con "email inválido" — pegar una dirección desde una lista de contactos suele
 * arrastrar espacios, así que el caso es común y el mensaje, desconcertante.
 *
 * Usa la MISMA función que el repositorio, no una copia: la normalización sigue
 * viviendo en un solo lugar (§6). Que se aplique dos veces no molesta, porque es
 * idempotente — y hay un test que lo ancla.
 */
const NormalizarEmail = (): PropertyDecorator =>
  Transform(({ value }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  );

/**
 * DTOs del seam de auth de cliente (§4 — todo input validado en el borde).
 *
 * Ninguno declara `role`, `id` ni `password_hash`. Con el `ValidationPipe` global
 * corriendo en `forbidNonWhitelisted: true`, enviarlos no es "ignorado": es un
 * **422**. La diferencia importa — un campo ignorado en silencio invita a probar
 * si alguna versión futura lo acepta; un 422 dice que no existe.
 *
 * La contraseña **no** lleva validadores de longitud acá a propósito. La política
 * (§3.2: mínimo, tope en bytes, corpus de filtradas) vive en `validatePassword`,
 * en un solo lugar. Duplicarla en el DTO garantizaría que las dos versiones
 * diverjan, y la del DTO sería la que gana sin que nadie lo note.
 */

export class RegisterDto {
  @NormalizarEmail()
  @IsEmail({}, { message: 'email debe ser una dirección válida' })
  email!: string;

  @IsString()
  @Length(1, 120, { message: 'name debe tener entre 1 y 120 caracteres' })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: 'password es requerida' })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
}

export class LoginDto {
  @NormalizarEmail()
  @IsEmail({}, { message: 'email debe ser una dirección válida' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'password es requerida' })
  password!: string;
}

export class ResetRequestDto {
  @NormalizarEmail()
  @IsEmail({}, { message: 'email debe ser una dirección válida' })
  email!: string;
}

export class ResetConfirmDto {
  @IsString()
  @IsNotEmpty({ message: 'token es requerido' })
  token!: string;

  @IsString()
  @IsNotEmpty({ message: 'password es requerida' })
  password!: string;
}

/**
 * Respuesta pública del cliente — **exactamente** cinco campos.
 *
 * Se construye campo por campo en vez de destructurar lo que sobra. Un
 * `{ ...customer, password_hash: undefined }` deja pasar cualquier columna que
 * se agregue después a la tabla: el día que alguien sume `internal_notes` o
 * `risk_score`, aparecería en la respuesta sin que nadie lo decida. Acá agregar
 * un campo a la respuesta es un acto explícito.
 */
export class CustomerResponseDto {
  id!: string;
  email!: string;
  name!: string;
  phone!: string | null;
  created_at!: Date;

  static from(customer: SafeCustomer): CustomerResponseDto {
    return {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      created_at: customer.created_at,
    };
  }
}
