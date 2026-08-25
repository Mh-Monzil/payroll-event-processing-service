import { BadRequestException } from '@nestjs/common';
import { UnknownEventTypeError } from '../../src/common/errors/payroll.errors';
import { PayrollEventType } from '../../src/modules/events/enums/payroll-event-type.enum';
import { SubmitEventDto } from '../../src/modules/events/dto/submit-event.dto';
import { EventPayloadValidationPipe } from '../../src/modules/events/pipes/event-payload-validation.pipe';

const envelope = (
  type: string,
  payload: Record<string, unknown>,
): SubmitEventDto =>
  ({
    type,
    employeeId: 'EMP-001',
    effectiveDate: '2026-09-01',
    payload,
  }) as SubmitEventDto;

const failedFields = async (
  pipe: EventPayloadValidationPipe,
  dto: SubmitEventDto,
): Promise<string[]> => {
  try {
    await pipe.transform(dto);
  } catch (error) {
    const body = (error as BadRequestException).getResponse() as {
      fields: { field: string }[];
    };
    return body.fields.map((entry) => entry.field);
  }
  throw new Error('expected the pipe to reject this payload');
};

describe('EventPayloadValidationPipe', () => {
  const pipe = new EventPayloadValidationPipe();

  it('accepts a valid salary change', async () => {
    const result = await pipe.transform(
      envelope(PayrollEventType.SALARY_CHANGE, {
        newSalary: 75000,
        currency: 'EUR',
      }),
    );

    expect(result.payload).toEqual({ newSalary: 75000, currency: 'EUR' });
  });

  it('accepts a valid address change', async () => {
    const result = await pipe.transform(
      envelope(PayrollEventType.ADDRESS_CHANGE, {
        street: 'Hauptstrasse 12',
        city: 'Berlin',
        postalCode: '10115',
        country: 'DE',
      }),
    );

    expect(result.payload).toHaveProperty('country', 'DE');
  });

  it('rejects a payload that is missing a required field', async () => {
    await expect(
      failedFields(
        pipe,
        envelope(PayrollEventType.SALARY_CHANGE, { newSalary: 75000 }),
      ),
    ).resolves.toContain('currency');
  });

  it('rejects a malformed IBAN', async () => {
    await expect(
      failedFields(
        pipe,
        envelope(PayrollEventType.BANK_ACCOUNT_CHANGE, { iban: 'not-an-iban' }),
      ),
    ).resolves.toContain('iban');
  });

  // The payload lands in a jsonb column, so anything the DTO does not declare
  // has to be refused rather than quietly stored.
  it('rejects fields the payload DTO does not declare', async () => {
    await expect(
      failedFields(
        pipe,
        envelope(PayrollEventType.SALARY_CHANGE, {
          newSalary: 75000,
          currency: 'EUR',
          approvedBy: 'anyone',
        }),
      ),
    ).resolves.toContain('approvedBy');
  });

  it('rejects money with more precision than the column stores', async () => {
    await expect(
      failedFields(
        pipe,
        envelope(PayrollEventType.SALARY_CHANGE, {
          newSalary: 75000.123,
          currency: 'EUR',
        }),
      ),
    ).resolves.toContain('newSalary');
  });

  it('rejects an unknown event type before validating anything', async () => {
    await expect(
      pipe.transform(envelope('BONUS_PAYMENT', { amount: 500 })),
    ).rejects.toThrow(UnknownEventTypeError);
  });
});
