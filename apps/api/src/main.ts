import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

/**
 * Bootstrap de `@dsm/api`: ValidationPipe global + filtro RFC 7807 (configureApp)
 * + logger pino estructurado.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);

  // AUDIT-dsm-api-002 — sin esto, un redeploy de Railway manda SIGTERM y el proceso
  // muere cortando las requests en vuelo y dejando el pool de Prisma sin cerrar. Con
  // los hooks, Nest corre `onModuleDestroy`/`beforeApplicationShutdown` y
  // `PrismaService` puede desconectarse ordenadamente. Importa más cuando exista el
  // webhook de pago (US-010): cortar una request a mitad de la confirmación deja una
  // orden cobrada sin confirmar, que es justo el caso que la reconciliación tiene que
  // salir a rescatar.
  app.enableShutdownHooks();

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

void bootstrap();
