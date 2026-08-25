import { ClassConstructor } from 'class-transformer';
import { PayrollEventType } from '../enums/payroll-event-type.enum';
import { UnknownEventTypeError } from '../../../common/errors/payroll.errors';
import { AddressChangePayloadDto } from '../dto/payloads/address-change.payload.dto';
import { BankAccountChangePayloadDto } from '../dto/payloads/bank-account-change.payload.dto';
import { SalaryChangePayloadDto } from '../dto/payloads/salary-change.payload.dto';

export interface EventTypeDefinition {
  readonly type: PayrollEventType;
  readonly payloadDto: ClassConstructor<object>;
  readonly description: string;
}

export const EVENT_TYPE_REGISTRY: Readonly<
  Record<PayrollEventType, EventTypeDefinition>
> = {
  [PayrollEventType.BANK_ACCOUNT_CHANGE]: {
    type: PayrollEventType.BANK_ACCOUNT_CHANGE,
    payloadDto: BankAccountChangePayloadDto,
    description: 'Change the account salary is paid into',
  },
  [PayrollEventType.ADDRESS_CHANGE]: {
    type: PayrollEventType.ADDRESS_CHANGE,
    payloadDto: AddressChangePayloadDto,
    description: 'Change the registered home address',
  },
  [PayrollEventType.SALARY_CHANGE]: {
    type: PayrollEventType.SALARY_CHANGE,
    payloadDto: SalaryChangePayloadDto,
    description: 'Change gross salary and currency',
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
