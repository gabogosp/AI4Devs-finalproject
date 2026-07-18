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
