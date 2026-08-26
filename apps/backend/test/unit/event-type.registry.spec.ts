import { getMetadataStorage } from 'class-validator';
import { UnknownEventTypeError } from '../../src/common/errors/payroll.errors';
import { PayrollEventType } from '../../src/modules/events/enums/payroll-event-type.enum';
import { SalaryChangePayloadDto } from '../../src/modules/events/dto/payloads/salary-change.payload.dto';
import {
  EVENT_TYPE_REGISTRY,
  SUPPORTED_EVENT_TYPES,
  getEventTypeDefinition,
  isSupportedEventType,
} from '../../src/modules/events/registry/event-type.registry';

const validatedProperties = (dto: object): string[] => {
  const metadata = getMetadataStorage().getTargetValidationMetadatas(
    dto as never,
    '',
    true,
    false,
  );

  return [...new Set(metadata.map((entry) => entry.propertyName))].sort();
};

describe('event type registry', () => {
  it('has a definition for every declared event type', () => {
    for (const type of Object.values(PayrollEventType)) {
      expect(EVENT_TYPE_REGISTRY[type]).toBeDefined();
      expect(EVENT_TYPE_REGISTRY[type].type).toBe(type);
    }
  });

  it('describes exactly the fields its payload DTO validates', () => {
    for (const type of Object.values(PayrollEventType)) {
      const definition = EVENT_TYPE_REGISTRY[type];

      expect(definition.fields.map((field) => field.name).sort()).toEqual(
        validatedProperties(definition.payloadDto),
      );
    }
  });

  it('resolves a type to its payload DTO', () => {
    expect(
      getEventTypeDefinition(PayrollEventType.SALARY_CHANGE).payloadDto,
    ).toBe(SalaryChangePayloadDto);
  });

  it('rejects an unknown type and reports what is supported', () => {
    expect(() => getEventTypeDefinition('BONUS_PAYMENT')).toThrow(
      UnknownEventTypeError,
    );

    try {
      getEventTypeDefinition('BONUS_PAYMENT');
    } catch (error) {
      expect((error as UnknownEventTypeError).knownTypes).toEqual(
        SUPPORTED_EVENT_TYPES,
      );
    }
  });

  it('does not treat inherited object properties as event types', () => {
    expect(isSupportedEventType('toString')).toBe(false);
    expect(isSupportedEventType('constructor')).toBe(false);
  });
});
