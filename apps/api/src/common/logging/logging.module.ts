import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Logging estructurado pino (backend-node-standards §9): JSON por request con
 * `trace_id`, `request_id`, `endpoint`, `method`. Sin logging suelto a stdout en
 * paths de producción. En `development` usa pino-pretty; en test/prod, JSON plano.
 */
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        /**
         * Nivel por entorno, con `info` como default — o sea, sin cambio de
         * comportamiento en producción.
         *
         * Existe porque había información que el proceso **produce y nadie podía
         * leer**: el mailer de log escribe el token de recuperación en `debug`
         * (único canal, ya que la tabla guarda sólo el hash), y sin un nivel
         * configurable ese `debug` no se emitía nunca. Consecuencia concreta: el
         * flujo de recuperación de US-014 no era verificable de punta a punta ni a
         * mano ni por la suite QA. Se elige esto antes que un endpoint de sólo-test
         * porque no agrega una ruta que haya que acordarse de apagar en producción.
         */
        level: process.env.LOG_LEVEL ?? 'info',
        /**
         * AUDIT-dsm-api-009 — `service`, `version` y `env` en TODA línea, no sólo en
         * las de request. Van en `base` y no en `customProps` justamente por eso:
         * `customProps` se evalúa por request y deja sin identificar los logs de
         * arranque, de los runners en proceso (US-005/US-006) y de los jobs
         * periódicos que vienen con US-010.
         *
         * Sin estos tres campos, en Railway conviven los logs de `api`, `web` y
         * `worker` en un mismo stream y no hay forma de filtrar por servicio ni de
         * atribuir un error a un deploy concreto.
         *
         * `version` sale del entorno: en Railway se puebla con el SHA del commit, y
         * en local queda `dev`. Un string hardcodeado acá driftearía en el primer
         * release. Se omiten `pid`/`hostname` (defaults de pino) a propósito: en un
         * único contenedor no aportan y ensucian cada línea.
         */
        base: {
          service: 'dsm-api',
          version:
            process.env.APP_VERSION ??
            process.env.RAILWAY_GIT_COMMIT_SHA ??
            'dev',
          env: process.env.NODE_ENV ?? 'development',
        },
        genReqId: (req: IncomingMessage, res: ServerResponse): string => {
          const existing = req.headers['x-request-id'];
          const id =
            (Array.isArray(existing) ? existing[0] : existing) || randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        customProps: (req: IncomingMessage) => {
          const r = req as IncomingMessage & {
            id?: string;
            url?: string;
            method?: string;
          };
          return {
            trace_id: r.id,
            request_id: r.id,
            endpoint: r.url,
            method: r.method,
          };
        },
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty' }
            : undefined,
      },
    }),
  ],
  exports: [LoggerModule],
})
export class AppLoggingModule {}
