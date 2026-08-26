import { DataSource } from 'typeorm';
import { PayrollEvent } from '../../src/modules/events/entities/payroll-event.entity';
import { EventStatusHistory } from '../../src/modules/events/entities/event-status-history.entity';
import { PayrollApplication } from '../../src/modules/processing/entities/payroll-application.entity';
import { Employee } from '../../src/modules/payroll-state/entities/employee.entity';
import { EmployeePayrollState } from '../../src/modules/payroll-state/entities/employee-payroll-state.entity';

export const createTestDataSource = (): DataSource =>
  new DataSource({
    type: 'postgres',
    url:
      process.env.DATABASE_URL ??
      'postgres://payroll:payroll@localhost:5433/payroll',
    entities: [
      PayrollEvent,
      EventStatusHistory,
      PayrollApplication,
      Employee,
      EmployeePayrollState,
    ],
    synchronize: false,
    logging: false,
  });

export const TEST_KEY_PREFIX = 'itest:';
