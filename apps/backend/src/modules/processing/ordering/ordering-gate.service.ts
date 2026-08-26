import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Not, Repository } from 'typeorm';
import { PayrollEvent } from '../../events/entities/payroll-event.entity';
import {
  EventStatus,
  TERMINAL_STATUSES,
} from '../../events/enums/event-status.enum';

@Injectable()
export class OrderingGateService {
  constructor(
    @InjectRepository(PayrollEvent)
    private readonly events: Repository<PayrollEvent>,
  ) {}

  async blockingPredecessor(event: PayrollEvent): Promise<PayrollEvent | null> {
    return this.events.findOne({
      where: {
        employeeId: event.employeeId,
        sequence: LessThan(event.sequence),
        status: Not(In(TERMINAL_STATUSES as EventStatus[])),
      },
      order: { sequence: 'ASC' },
    });
  }
}
