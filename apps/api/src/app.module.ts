import { Module } from '@nestjs/common';

/**
 * Módulo raíz de `@dsm/api`. La Fase 1 lo deja mínimo; las fases siguientes
 * importan Config (validado), Prisma, Auth (seam), Categories y Products.
 */
@Module({
  imports: [],
  controllers: [],
  providers: [],
})
export class AppModule {}
