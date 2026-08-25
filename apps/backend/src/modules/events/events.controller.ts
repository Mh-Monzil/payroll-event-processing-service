import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PaginatedData } from '../../common/interfaces/api-response.interface';
import { EventsService } from './events.service';
import { SubmitEventDto } from './dto/submit-event.dto';
import { ListEventsQueryDto } from './dto/list-events.query.dto';
import {
  EventDetailResponseDto,
  EventResponseDto,
  SubmitEventResponseDto,
  toEventDetailResponse,
  toEventResponse,
  toSubmitEventResponse,
} from './dto/event-response.dto';
import { EventPayloadValidationPipe } from './pipes/event-payload-validation.pipe';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ResponseMessage('Event accepted for processing')
  @ApiOperation({
    summary: 'Submit a payroll event',
    description:
      'Persists the event and returns immediately. Processing happens in the background, so poll GET /events/:id for the outcome.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Retry-safe key. Omitted, the service fingerprints the request body instead.',
  })
  @ApiBadRequestResponse({ description: 'Invalid envelope, payload or type' })
  async submit(
    @Body(EventPayloadValidationPipe) dto: SubmitEventDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SubmitEventResponseDto> {
    const { event, duplicate } = await this.events.submit(dto, idempotencyKey);

    if (duplicate) {
      response.status(HttpStatus.OK);
    }

    return toSubmitEventResponse(event, duplicate);
  }

  @Get()
  @ApiOperation({ summary: 'List submitted events, newest first' })
  async list(
    @Query() query: ListEventsQueryDto,
  ): Promise<PaginatedData<EventResponseDto>> {
    const page = await this.events.list(query);
    return { ...page, items: page.items.map(toEventResponse) };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Fetch one event with its full transition history',
  })
  @ApiOkResponse({ type: EventDetailResponseDto })
  @ApiNotFoundResponse({ description: 'No event with that id' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventDetailResponseDto> {
    return toEventDetailResponse(await this.events.findById(id));
  }
}
