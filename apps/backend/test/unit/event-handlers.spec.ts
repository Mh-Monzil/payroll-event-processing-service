import { PermanentPayrollError } from '../../src/common/errors/payroll.errors';
import { PayrollEvent } from '../../src/modules/events/entities/payroll-event.entity';
import { PayrollEventType } from '../../src/modules/events/enums/payroll-event-type.enum';
import { EmployeePayrollState } from '../../src/modules/payroll-state/entities/employee-payroll-state.entity';
import {
  EVENT_HANDLERS,
  getEventHandler,
} from '../../src/modules/processing/handlers/event-handler.registry';

const event = (
  type: PayrollEventType,
  payload: Record<string, unknown>,
): PayrollEvent =>
  ({
    id: 'e1',
    type,
    employeeId: 'EMP-001',
    effectiveDate: '2026-09-01',
    payload,
  }) as PayrollEvent;

describe('event handlers', () => {
  it('has a handler for every event type', () => {
    for (const type of Object.values(PayrollEventType)) {
      expect(EVENT_HANDLERS[type].type).toBe(type);
    }
  });

  describe('bank account change', () => {
    it('stores the IBAN without spacing and in upper case', () => {
      const patch = getEventHandler(
        PayrollEventType.BANK_ACCOUNT_CHANGE,
      ).buildPatch(
        event(PayrollEventType.BANK_ACCOUNT_CHANGE, {
          iban: 'de89 3704 0044 0532 0130 00',
        }),
      );

      expect(patch.iban).toBe('DE89370400440532013000');
    });
  });

  describe('address change', () => {
    it('copies the address and records which event set it', () => {
      const patch = getEventHandler(PayrollEventType.ADDRESS_CHANGE).buildPatch(
        event(PayrollEventType.ADDRESS_CHANGE, {
          street: 'Hauptstrasse 12',
          city: 'Berlin',
          postalCode: '10115',
          country: 'de',
        }),
      );

      expect(patch).toMatchObject({
        city: 'Berlin',
        country: 'DE',
        lastAppliedEventId: 'e1',
        lastEffectiveDate: '2026-09-01',
      });
    });
  });

  describe('salary change', () => {
    const handler = getEventHandler(PayrollEventType.SALARY_CHANGE);
    const salaryEvent = event(PayrollEventType.SALARY_CHANGE, {
      newSalary: 75000,
      currency: 'EUR',
    });

    it('formats money to the two decimals the column stores', () => {
      expect(handler.buildPatch(salaryEvent).salaryAmount).toBe('75000.00');
    });

    it('accepts a first salary for an employee with no state yet', () => {
      expect(() => handler.validate(salaryEvent, null)).not.toThrow();
    });

    it('accepts a raise in the currency the employee is already paid in', () => {
      expect(() =>
        handler.validate(salaryEvent, {
          salaryCurrency: 'EUR',
        } as EmployeePayrollState),
      ).not.toThrow();
    });

    // Retrying will never make this succeed, so it must be permanent.
    it('permanently rejects a change that switches currency', () => {
      expect(() =>
        handler.validate(salaryEvent, {
          salaryCurrency: 'USD',
        } as EmployeePayrollState),
      ).toThrow(PermanentPayrollError);
    });
  });
});
