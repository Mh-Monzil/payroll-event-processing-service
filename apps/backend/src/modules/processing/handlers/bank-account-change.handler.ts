import { PayrollEvent } from '../../events/entities/payroll-event.entity';
import { PayrollEventType } from '../../events/enums/payroll-event-type.enum';
import { BankAccountChangePayloadDto } from '../../events/dto/payloads/bank-account-change.payload.dto';
import { EventHandler, PayrollStatePatch } from './event-handler.interface';

export class BankAccountChangeHandler implements EventHandler {
  readonly type = PayrollEventType.BANK_ACCOUNT_CHANGE;

  validate(): void {}

  buildPatch(event: PayrollEvent): PayrollStatePatch {
    const payload = event.payload as unknown as BankAccountChangePayloadDto;

    return {
      iban: payload.iban.replace(/\s+/g, '').toUpperCase(),
      lastAppliedEventId: event.id,
      lastEffectiveDate: event.effectiveDate,
    };
  }
}
