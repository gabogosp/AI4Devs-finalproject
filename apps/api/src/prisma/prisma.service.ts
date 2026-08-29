import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from '@dsm/db';

/**
 * Único punto de acceso al ORM (backend-node-standards §5): extiende el
 * `PrismaClient` generado desde el esquema de `@dsm/db` (única fuente de verdad
 * del catálogo). Los repositorios lo inyectan; ningún service llama al client
 * directo.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
