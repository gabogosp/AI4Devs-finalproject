import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpProblemFilter } from './common/filters/http-problem.filter';

/**
 * Configuración compartida por `main.ts` y los tests e2e-nest: ValidationPipe
 * global (whitelist) + filtro RFC 7807. Mantiene un único punto de verdad para
 * el borde HTTP.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpProblemFilter());
}
