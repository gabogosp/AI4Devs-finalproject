import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Observable } from 'rxjs';
import { FileTooLargeError } from './import-errors';

/**
 * Cap de tamaño del multipart. Se lee de `process.env` y no de `ConfigService`
 * porque el decorador del interceptor se evalúa al cargar la clase, antes de que
 * exista el contenedor de Nest — mismo criterio que `TRUST_PROXY_HOPS` en
 * `bootstrap.ts`. El valor **ya está validado** por Zod al arrancar, y el
 * service lo vuelve a aplicar sobre el buffer (defensa en profundidad).
 */
const MAX_FILE_BYTES = Number(
  process.env.IMPORT_MAX_FILE_BYTES ?? 4_194_304,
);

/**
 * Recepción del archivo en **memoria**, con el cap aplicado por multer antes de
 * terminar de bufferizar el cuerpo (`security-standards.md` §6.4).
 *
 * Nada se escribe a disco: no hay directorio temporal, así que el `filename` que
 * manda el cliente no puede ser una ruta. Se guarda sólo como metadata.
 *
 * Los límites de **partes** no son decorativos. El `multer` que arrastra
 * `@nestjs/platform-express@10` es el `1.4.4-lts.1`, que tiene tres avisos `high`
 * de DoS por multipart malformado (parcheados en 2.x, un salto que arrastra la
 * versión de Nest y por eso no se decide acá). Acotar `files`, `parts`, `fields`
 * y `fieldSize` reduce la superficie de esos vectores; el resto lo cubre que la
 * ruta sea admin-only y esté limitada a 3 requests por hora.
 */
const FileToMemory = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: 1,
    // Un multipart legítimo de esta ruta tiene UNA parte de archivo y ninguna
    // más; se deja holgura mínima para bordes de clientes HTTP.
    parts: 4,
    fields: 3,
    fieldSize: 1_024,
  },
});

/**
 * T5.2 — traduce el corte de multer al error del contrato.
 *
 * Sin esto, un archivo demasiado grande sale como el 413 genérico de Nest
 * (`dsm:catalog/http-413`) y el cliente no puede distinguirlo del resto: el
 * contrato declara `dsm:import/file-too-large` y el panel ramifica por `type`.
 */
@Injectable()
export class ImportFileInterceptor
  extends FileToMemory
  implements NestInterceptor
{
  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    try {
      return (await super.intercept(context, next)) as Observable<unknown>;
    } catch (error) {
      if (this.esCorteDeTamano(error)) {
        throw new FileTooLargeError(MAX_FILE_BYTES);
      }
      throw error;
    }
  }

  private esCorteDeTamano(error: unknown): boolean {
    const code = (error as { code?: string }).code;
    if (code === 'LIMIT_FILE_SIZE') return true;
    // Nest envuelve el `MulterError` en un `PayloadTooLargeException`; el código
    // original queda en la causa o en el mensaje, según la versión.
    const status = (error as { status?: number }).status;
    if (status === 413) return true;
    return (
      error instanceof Error && error.message.includes('File too large')
    );
  }
}

export const IMPORT_MAX_FILE_BYTES_EFECTIVO = MAX_FILE_BYTES;
