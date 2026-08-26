import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  REDIS_HOST = 'localhost';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT = 6379;

  /** Chance the simulated provider throws a transient error, per attempt. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  PROVIDER_FAILURE_RATE = 0.3;

  /** Simulated round-trip latency to the external payroll system, in ms. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  PROVIDER_LATENCY_MS = 1500;

  /** BullMQ attempts per job, including the first one. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  JOB_ATTEMPTS = 5;

  /** Base delay for exponential backoff, in ms. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  JOB_BACKOFF_MS = 1000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  WORKER_CONCURRENCY = 5;

  /** How long a job waits before re-checking whether it may run yet. */
  @Type(() => Number)
  @IsInt()
  @Min(50)
  ORDERING_DEFER_MS = 500;

  /** How long an event may sit in PROCESSING before reconciliation reclaims it. */
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  STUCK_EVENT_TIMEOUT_MS = 120000;
}

export function validateEnv(
  raw: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, raw, {
    exposeDefaultValues: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map(
        (error) =>
          `  - ${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`,
      )
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return validated;
}
