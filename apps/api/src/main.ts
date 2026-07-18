import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Bootstrap de `@dsm/api`. La Fase 2 añade ValidationPipe global, filtro
 * RFC 7807 y logging pino; por ahora arranca el módulo raíz.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

void bootstrap();
