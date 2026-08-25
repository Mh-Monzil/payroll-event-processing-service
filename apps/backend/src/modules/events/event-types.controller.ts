import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  EVENT_TYPE_REGISTRY,
  SUPPORTED_EVENT_TYPES,
} from './registry/event-type.registry';
import { PayrollEventType } from './enums/payroll-event-type.enum';

export interface EventTypeSummary {
  type: PayrollEventType;
  description: string;
}

@ApiTags('events')
@Controller('event-types')
export class EventTypesController {
  @Get()
  @ApiOperation({ summary: 'List the event types this service accepts' })
  list(): EventTypeSummary[] {
    return SUPPORTED_EVENT_TYPES.map((type) => ({
      type,
      description: EVENT_TYPE_REGISTRY[type].description,
    }));
  }
}
