import {
  Controller,
  Headers,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { ValidationError } from '../common/errors/domain-errors';
import { ImportFileInterceptor } from './import-file.interceptor';
import { ImportRunner } from './import-runner';
import { ImportsService } from './imports.service';

/** Cuerpo del 202/200 del alta: lo mínimo para que el panel arranque el polling. */
export interface CreateImportResponse {
  id: string;
  status: string;
}

/**
 * Superficie admin del import masivo (US-006). Gateada por `AdminGuard`
 * (ADR-0009, AC-8): el guard no se modifica — se reusa tal cual.
 */
@Controller('v1/admin/imports')
@UseGuards(AdminGuard)
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly runner: ImportRunner,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Recibe el archivo, lo valida y **devuelve 202 sin procesarlo** (AC-7): un
   * import de 5.000 filas no cabe en el tiempo de un request, y el dueño necesita
   * ver progreso, no un timeout.
   *
   * El `Idempotency-Key` opcional hace que un reintento devuelva **el mismo**
   * trabajo con 200 en vez de crear otro (api-standards §10).
   */
  @Post()
  @UseInterceptors(ImportFileInterceptor)
  async create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CreateImportResponse> {
    if (!file) {
      throw new ValidationError('Falta el archivo a importar', [
        { field: 'file', message: 'requerido (multipart/form-data)' },
      ]);
    }

    const { job, replayed } = await this.imports.prepareImport({
      buffer: file.buffer,
      // El nombre del cliente es metadata y nada más: no decide el formato y no
      // se usa como ruta (nada se escribe a disco).
      filename: file.originalname ?? 'archivo',
      idempotencyKey: idempotencyKey?.trim() || undefined,
      subject: this.subjectDe(req),
    });

    res.setHeader('Location', `/v1/admin/imports/${job.id}`);
    // 200 en la réplica y 202 en el alta: el panel distingue "ya estaba" de
    // "arrancó recién" sin comparar cuerpos.
    res.status(replayed ? 200 : 202);

    if (!replayed) {
      this.runner.schedule(job.id, file.buffer, job.source_format as 'csv' | 'xlsx');
    }

    return { id: job.id, status: job.status };
  }

  /**
   * `sub` del JWT admin: pseudónimo interno para trazar quién importó. No es PII.
   *
   * Se **decodifica** sin volver a verificar porque el `AdminGuard` ya validó la
   * firma para dejar pasar este request; repetir la verificación sería pagarla dos
   * veces. Se lee acá y no en el guard porque el guard no se modifica (AC-8).
   */
  private subjectDe(req: Request): string | undefined {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      return undefined;
    }
    const payload = this.jwt.decode(header.slice('Bearer '.length).trim());
    const sub = (payload as { sub?: unknown } | null)?.sub;
    return typeof sub === 'string' ? sub : undefined;
  }
}
