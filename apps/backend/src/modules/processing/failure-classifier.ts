import {
  PermanentPayrollError,
  TransientProviderError,
} from '../../common/errors/payroll.errors';
import { FailureKind } from '../events/enums/failure-kind.enum';

export interface FailureClassification {
  kind: FailureKind;
  code: string;
  message: string;
  detail: unknown;
  retryable: boolean;
}

export const classifyFailure = (
  error: unknown,
  attempt: number,
  maxAttempts: number,
): FailureClassification => {
  const attemptsLeft = attempt < maxAttempts;

  if (error instanceof PermanentPayrollError) {
    return {
      kind: FailureKind.PERMANENT,
      code: error.code,
      message: error.message,
      detail: error.detail ?? null,
      retryable: false,
    };
  }

  if (error instanceof TransientProviderError) {
    return {
      kind: FailureKind.RETRIES_EXHAUSTED,
      code: error.code,
      message: error.message,
      detail: error.detail ?? null,
      retryable: attemptsLeft,
    };
  }

  return {
    kind: FailureKind.RETRIES_EXHAUSTED,
    code: 'UNEXPECTED_ERROR',
    message: error instanceof Error ? error.message : String(error),
    detail: null,
    retryable: attemptsLeft,
  };
};
