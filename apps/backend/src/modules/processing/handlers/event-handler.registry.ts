import { PayrollEventType } from '../../events/enums/payroll-event-type.enum';
import { EventHandler } from './event-handler.interface';
import { AddressChangeHandler } from './address-change.handler';
import { BankAccountChangeHandler } from './bank-account-change.handler';
import { SalaryChangeHandler } from './salary-change.handler';

export const EVENT_HANDLERS: Readonly<Record<PayrollEventType, EventHandler>> =
  {
    [PayrollEventType.BANK_ACCOUNT_CHANGE]: new BankAccountChangeHandler(),
    [PayrollEventType.ADDRESS_CHANGE]: new AddressChangeHandler(),
    [PayrollEventType.SALARY_CHANGE]: new SalaryChangeHandler(),
  };

export const getEventHandler = (type: PayrollEventType): EventHandler =>
  EVENT_HANDLERS[type];
