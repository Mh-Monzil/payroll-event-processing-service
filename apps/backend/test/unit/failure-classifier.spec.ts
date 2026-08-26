import {
  PermanentPayrollError,
  TransientProviderError,
} from '../../src/common/errors/payroll.errors';
import { FailureKind } from '../../src/modules/events/enums/failure-kind.enum';
import { classifyFailure } from '../../src/modules/processing/failure-classifier';

describe('classifyFailure', () => {
  it('never retries a business rule violation, even on the first attempt', () => {
    const failure = classifyFailure(
      new PermanentPayrollError('EMPLOYEE_INACTIVE', 'inactive'),
      1,
      5,
    );

    expect(failure.retryable).toBe(false);
    expect(failure.kind).toBe(FailureKind.PERMANENT);
    expect(failure.code).toBe('EMPLOYEE_INACTIVE');
  });

  it('retries a provider outage while attempts remain', () => {
    const failure = classifyFailure(
      new TransientProviderError('PROVIDER_UNAVAILABLE', 'down'),
      2,
      5,
    );

    expect(failure.retryable).toBe(true);
  });

  it('gives up on a provider outage once attempts run out', () => {
    const failure = classifyFailure(
      new TransientProviderError('PROVIDER_UNAVAILABLE', 'down'),
      5,
      5,
    );

    expect(failure.retryable).toBe(false);
    expect(failure.kind).toBe(FailureKind.RETRIES_EXHAUSTED);
  });

  // Guessing wrong in this direction costs attempts; guessing wrong in the
  // other direction loses a payroll change.
  it('treats an unrecognised error as retryable', () => {
    const failure = classifyFailure(new Error('socket hang up'), 1, 5);

    expect(failure.retryable).toBe(true);
    expect(failure.code).toBe('UNEXPECTED_ERROR');
    expect(failure.message).toBe('socket hang up');
  });
});
