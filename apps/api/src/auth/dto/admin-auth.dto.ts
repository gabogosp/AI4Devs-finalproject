import { IsNotEmpty, IsString } from 'class-validator';

/** Intercambio del bootstrap token por un JWT admin (seam, ADR-0009). */
export class AdminLoginDto {
  @IsString()
  @IsNotEmpty()
  bootstrapToken!: string;
}

export class AdminLoginResponseDto {
  token!: string;
}
