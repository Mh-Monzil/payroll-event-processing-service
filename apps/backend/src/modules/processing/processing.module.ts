import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueModule } from '../../shared/queue/queue.module';
import { EventsModule } from '../events/events.module';
import { PayrollEvent } from '../events/entities/payroll-event.entity';
import { Employee } from '../payroll-state/entities/employee.entity';
import { EmployeePayrollState } from '../payroll-state/entities/employee-payroll-state.entity';
import { PayrollApplication } from './entities/payroll-application.entity';
import { PayrollEventProcessor } from './payroll-event.processor';
import { PayrollProviderService } from './provider/payroll-provider.service';
import { EmployeeLockService } from './ordering/employee-lock.service';
import { OrderingGateService } from './ordering/ordering-gate.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PayrollEvent,
      PayrollApplication,
      Employee,
      EmployeePayrollState,
    ]),
    QueueModule,
    EventsModule,
  ],
  providers: [
    PayrollEventProcessor,
    PayrollProviderService,
    EmployeeLockService,
    OrderingGateService,
  ],
})
export class ProcessingModule {}
