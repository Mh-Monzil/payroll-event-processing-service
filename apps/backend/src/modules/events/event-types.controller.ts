import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  EVENT_TYPE_REGISTRY,
  PayloadFieldDescriptor,
  SUPPORTED_EVENT_TYPES,
} from './registry/event-type.registry';
import { PayrollEventType } from './enums/payroll-event-type.enum';

export interface EventTypeSummary {
  type: PayrollEventType;
  description: string;
  fields: readonly PayloadFieldDescriptor[];
}

@ApiTags('events')
@Controller('event-types')
export class EventTypesController {
  @Get()
  @ApiOperation({
    summary: 'List the event types this service accepts, with their payloads',
    description:
      'Lets a client build its form from the registry instead of hardcoding the types, so a new event type reaches the UI without a frontend change.',
  })
  list(): EventTypeSummary[] {
    return SUPPORTED_EVENT_TYPES.map((type) => ({
      type,
      description: EVENT_TYPE_REGISTRY[type].description,
      fields: EVENT_TYPE_REGISTRY[type].fields,
    }));
  }
}
