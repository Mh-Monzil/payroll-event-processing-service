import { PayrollEvent } from '../../events/entities/payroll-event.entity';
import { PayrollEventType } from '../../events/enums/payroll-event-type.enum';
import { AddressChangePayloadDto } from '../../events/dto/payloads/address-change.payload.dto';
import { EventHandler, PayrollStatePatch } from './event-handler.interface';

export class AddressChangeHandler implements EventHandler {
  readonly type = PayrollEventType.ADDRESS_CHANGE;

  validate(): void {}

  buildPatch(event: PayrollEvent): PayrollStatePatch {
    const payload = event.payload as unknown as AddressChangePayloadDto;

    return {
      street: payload.street,
      city: payload.city,
      postalCode: payload.postalCode,
      country: payload.country.toUpperCase(),
      lastAppliedEventId: event.id,
      lastEffectiveDate: event.effectiveDate,
    };
  }
}
