import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';

/**
 * `POST /v1/webhooks/mercadopago` (US-010 T6.1). El `ValidationPipe` global
 * corre con `forbidNonWhitelisted: true` (`bootstrap.ts` §7.1) — el body real
 * de MercadoPago trae más campos que los que este endpoint usa
 * (`action`, `api_version`, `date_created`, `id`, `live_mode`, `user_id`), así
 * que TODOS se declaran acá (opcionales salvo `type`/`data`) para que un
 * webhook real no se rechace por whitelist antes de llegar al controller.
 * Sólo `type`/`data.id` importan para la lógica (el resto del body NUNCA se
 * cree — `getPayment` re-consulta la VERDAD del pago, `design.md` §D2).
 */
export class MercadoPagoWebhookDataDto {
  @IsString()
  id!: string;
}

export class MercadoPagoWebhookBodyDto {
  @IsIn(['payment'])
  type!: string;

  @ValidateNested()
  @Type(() => MercadoPagoWebhookDataDto)
  data!: MercadoPagoWebhookDataDto;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  api_version?: string;

  @IsOptional()
  @IsString()
  date_created?: string;

  @IsOptional()
  id?: number;

  @IsOptional()
  @IsBoolean()
  live_mode?: boolean;

  @IsOptional()
  user_id?: number;
}
