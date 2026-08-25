import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventStatusHistory } from './entities/event-status-history.entity';
import { PayrollEvent } from './entities/payroll-event.entity';
import { EventsController } from './events.controller';
import { EventTypesController } from './event-types.controller';
import { EventsService } from './events.service';
import { EventPayloadValidationPipe } from './pipes/event-payload-validation.pipe';

@Module({
  imports: [TypeOrmModule.forFeature([PayrollEvent, EventStatusHistory])],
  controllers: [EventsController, EventTypesController],
  providers: [EventsService, EventPayloadValidationPipe],
  exports: [EventsService],
})
export class EventsModule {}
