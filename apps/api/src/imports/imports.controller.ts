import {
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
import {
  ImportJobQueryDto,
  ImportJobResponseDto,
} from './dto/import.dto';
import { ImportFileInterceptor } from './import-file.interceptor';
import { buildReportCsv, reportFilename } from './report-csv';
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
   * Estado, progreso y filas rechazadas del trabajo (AC-5, AC-7).
   *
   * El `ParseUUIDPipe` se construye con 422 explícito: su default es 400, y el
   * resto de la API ya contesta 422 a un input inválido (ValidationPipe global).
   * Un id mal formado no puede ser un 500 ni un 400 suelto en la única superficie
   * que el panel consulta en loop.
   */
  @Get(':id')
  async get(
    @Param(
      'id',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      }),
    )
    id: string,
    @Query() query: ImportJobQueryDto,
  ): Promise<ImportJobResponseDto> {
    const page = { limit: query.limit, offset: query.offset };
    const { job, errors, total } = await this.imports.getJob(id, page);
    return ImportJobResponseDto.from(job, errors, { ...page, total });
  }

  /**
   * Reporte descargable de las filas rechazadas (AC-5).
   *
   * Se sirve como `text/csv` con `Content-Disposition: attachment` y un nombre
   * generado por el servidor. Todas las celdas van neutralizadas contra inyección
   * de fórmulas: el destino de este texto es una planilla, no un JSON.
   */
  @Get(':id/report')
  async report(
    @Param(
      'id',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      }),
    )
    id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { job, rows } = await this.imports.getReport(id);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${reportFilename(job.id)}"`,
    );
    res.send(buildReportCsv(job, rows));
  }

  /** `sub` del JWT admin: pseudónimo interno para trazar quién importó. No es PII.
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
