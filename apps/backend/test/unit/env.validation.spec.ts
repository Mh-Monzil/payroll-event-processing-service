import { validateEnv } from '../../src/config/env.validation';

describe('validateEnv', () => {
  const validEnv: Record<string, string> = {
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    PROVIDER_FAILURE_RATE: '0.3',
    PROVIDER_LATENCY_MS: '1500',
    JOB_ATTEMPTS: '5',
    JOB_BACKOFF_MS: '1000',
    WORKER_CONCURRENCY: '5',
    STUCK_EVENT_TIMEOUT_MS: '120000',
  };

  it('accepts a complete configuration and coerces numeric strings', () => {
    const config = validateEnv(validEnv);

    // process.env values are always strings; the config object must not be.
    expect(config.PORT).toBe(3000);
    expect(config.JOB_ATTEMPTS).toBe(5);
    expect(config.PROVIDER_FAILURE_RATE).toBeCloseTo(0.3);
  });

  it('rejects a missing DATABASE_URL rather than starting without a database', () => {
    const withoutDatabase = { ...validEnv };
    delete withoutDatabase.DATABASE_URL;

    expect(() => validateEnv(withoutDatabase)).toThrow(/DATABASE_URL/);
  });

  it('rejects a failure rate outside 0..1', () => {
    expect(() =>
      validateEnv({ ...validEnv, PROVIDER_FAILURE_RATE: '1.5' }),
    ).toThrow(/PROVIDER_FAILURE_RATE/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });
});
