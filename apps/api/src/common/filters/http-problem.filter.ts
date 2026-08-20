import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainError, FieldError } from '../errors/domain-errors';

/** Envelope RFC 7807 (api-standards §8). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  errors?: FieldError[];
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

/** Extrae el nombre del campo de un mensaje de class-validator ("price_ars_cents must ..."). */
function extractField(message: string): string {
  const m = message.match(/^([A-Za-z0-9_]+)\b/);
  return m ? m[1] : '_';
}

/**
 * Mapea cualquier excepción al envelope RFC 7807. Función pura → testeable sin HTTP.
 * Un error desconocido (Prisma crudo, TypeError, etc.) SIEMPRE cae a 500 genérico
 * sin filtrar internals (stack, SQL, códigos Prisma).
 */
export function mapErrorToProblem(
  exception: unknown,
  instance: string,
): ProblemDetails {
  if (exception instanceof DomainError) {
    return {
      type: exception.type,
      title: TITLES[exception.status] ?? 'Error',
      status: exception.status,
      detail: exception.message,
      instance,
      ...(exception.fieldErrors ? { errors: exception.fieldErrors } : {}),
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const res = exception.getResponse();
    let detail = exception.message;
    let errors: FieldError[] | undefined;
    if (typeof res === 'object' && res !== null) {
      const r = res as { message?: unknown };
      if (Array.isArray(r.message)) {
        errors = (r.message as string[]).map((msg) => ({
          field: extractField(msg),
          message: msg,
        }));
        detail = 'La solicitud tiene campos inválidos.';
      } else if (typeof r.message === 'string') {
        detail = r.message;
      }
    }
    return {
      type: `dsm:catalog/http-${status}`,
      title: TITLES[status] ?? 'Error',
      status,
      detail,
      instance,
      ...(errors ? { errors } : {}),
    };
  }

  return {
    type: 'dsm:catalog/internal',
    title: TITLES[500],
    status: 500,
    detail: 'Ocurrió un error interno.',
    instance,
  };
}

@Catch()
export class HttpProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const problem = mapErrorToProblem(exception, req.url ?? '');

    if (problem.status >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // RFC 7807 define el media type como parte del contrato, no sólo la forma
    // del cuerpo: un cliente que negocie por `Accept: application/problem+json`
    // o que ramifique por content-type no reconocería estas respuestas.
    // `apps/api/docs/api/openapi.yaml` ya lo declaraba — era la implementación
    // la que no lo honraba (detectado al cerrar T6.1 de US-014).
    res
      .status(problem.status)
      .type('application/problem+json')
      .json(problem);
  }
}
