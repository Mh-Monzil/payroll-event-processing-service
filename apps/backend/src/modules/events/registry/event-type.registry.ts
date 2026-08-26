import { ClassConstructor } from 'class-transformer';
import { PayrollEventType } from '../enums/payroll-event-type.enum';
import { UnknownEventTypeError } from '../../../common/errors/payroll.errors';
import { AddressChangePayloadDto } from '../dto/payloads/address-change.payload.dto';
import { BankAccountChangePayloadDto } from '../dto/payloads/bank-account-change.payload.dto';
import { SalaryChangePayloadDto } from '../dto/payloads/salary-change.payload.dto';

export interface PayloadFieldDescriptor {
  readonly name: string;
  readonly label: string;
  readonly kind: 'text' | 'number';
  readonly example: string;
}

export interface EventTypeDefinition {
  readonly type: PayrollEventType;
  readonly payloadDto: ClassConstructor<object>;
  readonly description: string;
  readonly fields: readonly PayloadFieldDescriptor[];
}

export const EVENT_TYPE_REGISTRY: Readonly<
  Record<PayrollEventType, EventTypeDefinition>
> = {
  [PayrollEventType.BANK_ACCOUNT_CHANGE]: {
    type: PayrollEventType.BANK_ACCOUNT_CHANGE,
    payloadDto: BankAccountChangePayloadDto,
    description: 'Change the account salary is paid into',
    fields: [
      {
        name: 'iban',
        label: 'IBAN',
        kind: 'text',
        example: 'DE89370400440532013000',
      },
    ],
  },
  [PayrollEventType.ADDRESS_CHANGE]: {
    type: PayrollEventType.ADDRESS_CHANGE,
    payloadDto: AddressChangePayloadDto,
    description: 'Change the registered home address',
    fields: [
      {
        name: 'street',
        label: 'Street',
        kind: 'text',
        example: 'Hauptstrasse 12',
      },
      { name: 'city', label: 'City', kind: 'text', example: 'Berlin' },
      {
        name: 'postalCode',
        label: 'Postal code',
        kind: 'text',
        example: '10115',
      },
      {
        name: 'country',
        label: 'Country (ISO 3166-1 alpha-2)',
        kind: 'text',
        example: 'DE',
      },
    ],
  },
  [PayrollEventType.SALARY_CHANGE]: {
    type: PayrollEventType.SALARY_CHANGE,
    payloadDto: SalaryChangePayloadDto,
    description: 'Change gross salary and currency',
    fields: [
      {
        name: 'newSalary',
        label: 'New gross salary',
        kind: 'number',
        example: '75000',
      },
      {
        name: 'currency',
        label: 'Currency (ISO 4217)',
        kind: 'text',
        example: 'EUR',
      },
    ],
  },
};

export const SUPPORTED_EVENT_TYPES = Object.keys(
  EVENT_TYPE_REGISTRY,
) as PayrollEventType[];

export function isSupportedEventType(type: string): type is PayrollEventType {
  return Object.prototype.hasOwnProperty.call(EVENT_TYPE_REGISTRY, type);
}

export function getEventTypeDefinition(type: string): EventTypeDefinition {
  if (!isSupportedEventType(type)) {
    throw new UnknownEventTypeError(type, SUPPORTED_EVENT_TYPES);
  }
  return EVENT_TYPE_REGISTRY[type];
}
