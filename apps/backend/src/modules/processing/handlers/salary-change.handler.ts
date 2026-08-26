import { PermanentPayrollError } from '../../../common/errors/payroll.errors';
import { EmployeePayrollState } from '../../payroll-state/entities/employee-payroll-state.entity';
import { PayrollEvent } from '../../events/entities/payroll-event.entity';
import { PayrollEventType } from '../../events/enums/payroll-event-type.enum';
import { SalaryChangePayloadDto } from '../../events/dto/payloads/salary-change.payload.dto';
import { EventHandler, PayrollStatePatch } from './event-handler.interface';

export class SalaryChangeHandler implements EventHandler {
  readonly type = PayrollEventType.SALARY_CHANGE;

  validate(event: PayrollEvent, current: EmployeePayrollState | null): void {
    const payload = event.payload as unknown as SalaryChangePayloadDto;
    const currency = payload.currency.toUpperCase();

    if (
      current?.salaryCurrency &&
      current.salaryCurrency.toUpperCase() !== currency
    ) {
      throw new PermanentPayrollError(
        'CURRENCY_MISMATCH',
        `Employee ${event.employeeId} is paid in ${current.salaryCurrency}; this event uses ${currency}`,
        { current: current.salaryCurrency, requested: currency },
      );
    }
  }

  buildPatch(event: PayrollEvent): PayrollStatePatch {
    const payload = event.payload as unknown as SalaryChangePayloadDto;

    return {
      salaryAmount: payload.newSalary.toFixed(2),
      salaryCurrency: payload.currency.toUpperCase(),
      lastAppliedEventId: event.id,
      lastEffectiveDate: event.effectiveDate,
    };
  }
}
