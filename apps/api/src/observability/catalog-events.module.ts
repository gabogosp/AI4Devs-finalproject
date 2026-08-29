import { Global, Module } from '@nestjs/common';
import { CatalogEventsService } from './catalog-events.service';

@Global()
@Module({
  providers: [CatalogEventsService],
  exports: [CatalogEventsService],
})
export class CatalogEventsModule {}
