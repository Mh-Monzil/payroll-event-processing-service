import { BadRequestException } from '@nestjs/common';
import { SubmitEventDto } from '../../src/modules/events/dto/submit-event.dto';
import { PayrollEventType } from '../../src/modules/events/enums/payroll-event-type.enum';
import {
  CLIENT_KEY_PREFIX,
  CONTENT_KEY_PREFIX,
  deriveIdempotencyKey,
  resolveIdempotencyKey,
} from '../../src/modules/events/idempotency';

const dto = (payload: Record<string, unknown>): SubmitEventDto => ({
  type: PayrollEventType.SALARY_CHANGE,
  employeeId: 'EMP-001',
  effectiveDate: '2026-09-01',
  payload,
});

describe('idempotency keys', () => {
  const base = dto({ newSalary: 75000, currency: 'EUR' });

  it('gives the same key to the same business request', () => {
    expect(deriveIdempotencyKey(base)).toBe(
      deriveIdempotencyKey(dto({ newSalary: 75000, currency: 'EUR' })),
    );
  });

  // A retried request may serialise its JSON in a different order; that must
  // not make it look like a new request.
  it('ignores key order inside the payload', () => {
    expect(
      deriveIdempotencyKey(dto({ currency: 'EUR', newSalary: 75000 })),
    ).toBe(deriveIdempotencyKey(base));
  });

  it('gives a different key when the business content differs', () => {
    expect(
      deriveIdempotencyKey(dto({ newSalary: 80000, currency: 'EUR' })),
    ).not.toBe(deriveIdempotencyKey(base));
  });

  it('fits the idempotencyKey column', () => {
    expect(deriveIdempotencyKey(base).length).toBeLessThanOrEqual(128);
  });

  it('namespaces client keys so they cannot collide with a fingerprint', () => {
    const key = resolveIdempotencyKey(base, 'retry-42');

    expect(key).toBe(`${CLIENT_KEY_PREFIX}retry-42`);
    expect(key.startsWith(CONTENT_KEY_PREFIX)).toBe(false);
  });

  it('falls back to the fingerprint when the header is blank', () => {
    expect(resolveIdempotencyKey(base, '   ')).toBe(deriveIdempotencyKey(base));
  });

  it('rejects a client key that would not fit the column', () => {
    expect(() => resolveIdempotencyKey(base, 'x'.repeat(200))).toThrow(
      BadRequestException,
    );
  });
});
