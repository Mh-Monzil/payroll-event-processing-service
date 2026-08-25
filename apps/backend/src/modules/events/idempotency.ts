import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { SubmitEventDto } from './dto/submit-event.dto';

export const CLIENT_KEY_PREFIX = 'client:';
export const CONTENT_KEY_PREFIX = 'content:';
export const MAX_CLIENT_KEY_LENGTH = 120;

const canonicalise = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.keys(source)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalise(source[key]);
        return acc;
      }, {});
  }
  return value;
};

export const deriveIdempotencyKey = (dto: SubmitEventDto): string => {
  const fingerprint = JSON.stringify(
    canonicalise({
      type: dto.type,
      employeeId: dto.employeeId,
      effectiveDate: dto.effectiveDate,
      payload: dto.payload,
    }),
  );

  return (
    CONTENT_KEY_PREFIX + createHash('sha256').update(fingerprint).digest('hex')
  );
};

export const clientIdempotencyKey = (raw: string): string => {
  const trimmed = raw.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_CLIENT_KEY_LENGTH) {
    throw new BadRequestException({
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: `Idempotency-Key must be between 1 and ${MAX_CLIENT_KEY_LENGTH} characters`,
    });
  }

  return CLIENT_KEY_PREFIX + trimmed;
};

export const resolveIdempotencyKey = (
  dto: SubmitEventDto,
  clientKey?: string,
): string =>
  clientKey === undefined || clientKey.trim().length === 0
    ? deriveIdempotencyKey(dto)
    : clientIdempotencyKey(clientKey);
