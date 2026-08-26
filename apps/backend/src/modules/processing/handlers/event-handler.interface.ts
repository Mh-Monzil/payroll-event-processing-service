import { EmployeePayrollState } from '../../payroll-state/entities/employee-payroll-state.entity';
import { PayrollEvent } from '../../events/entities/payroll-event.entity';
import { PayrollEventType } from '../../events/enums/payroll-event-type.enum';

export type PayrollStatePatch = Partial<
  Omit<EmployeePayrollState, 'employeeId' | 'updatedAt'>
>;

export interface EventHandler {
  readonly type: PayrollEventType;

  validate(event: PayrollEvent, current: EmployeePayrollState | null): void;

  buildPatch(event: PayrollEvent): PayrollStatePatch;
}
