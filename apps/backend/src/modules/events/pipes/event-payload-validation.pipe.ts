import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import { ValidationError, validate } from 'class-validator';
import { SubmitEventDto } from '../dto/submit-event.dto';
import { getEventTypeDefinition } from '../registry/event-type.registry';

interface PayloadFieldError {
  field: string;
  messages: string[];
}

@Injectable()
export class EventPayloadValidationPipe implements PipeTransform<
  SubmitEventDto,
  Promise<SubmitEventDto>
> {
  async transform(value: SubmitEventDto): Promise<SubmitEventDto> {
    const definition = getEventTypeDefinition(value.type);

    const payload = plainToInstance(definition.payloadDto, value.payload ?? {});
    const errors = await validate(payload, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });

    if (errors.length > 0) {
      throw new BadRequestException({
        code: 'INVALID_EVENT_PAYLOAD',
        message: `Invalid payload for event type ${definition.type}`,
        eventType: definition.type,
        fields: this.flatten(errors),
      });
    }

    return { ...value, payload: instanceToPlain(payload) };
  }

  private flatten(errors: ValidationError[], parent = ''): PayloadFieldError[] {
    return errors.flatMap((error) => {
      const field = parent ? `${parent}.${error.property}` : error.property;
      const own: PayloadFieldError[] = error.constraints
        ? [{ field, messages: Object.values(error.constraints) }]
        : [];
      const nested = error.children?.length
        ? this.flatten(error.children, field)
        : [];
      return [...own, ...nested];
    });
  }
}
