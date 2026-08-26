import { ConfigService } from '@nestjs/config';
import { JobsOptions } from 'bullmq';

export const PAYROLL_QUEUE = 'payroll-events';

export const PROCESS_EVENT_JOB = 'process-event';

export interface ProcessEventJobData {
  eventId: string;
}

export const createJobOptions = (
  configService: ConfigService,
): JobsOptions => ({
  attempts: Number(configService.get<number>('JOB_ATTEMPTS', 5)),
  backoff: {
    type: 'exponential',
    delay: Number(configService.get<number>('JOB_BACKOFF_MS', 1000)),
  },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: false,
});
