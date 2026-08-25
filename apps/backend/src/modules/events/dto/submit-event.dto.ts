import { ApiProperty } from '@nestjs/swagger';
import {
  IsISO8601,
  IsObject,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { PayrollEventType } from '../enums/payroll-event-type.enum';

export class SubmitEventDto {
  @ApiProperty({
    enum: PayrollEventType,
    example: PayrollEventType.SALARY_CHANGE,
  })
  @IsString()
  type!: PayrollEventType;

  @ApiProperty({ example: 'EMP-001' })
  @IsString()
  @Length(1, 64)
  employeeId!: string;

  @ApiProperty({
    example: '2026-09-01',
    description: 'Calendar date, YYYY-MM-DD',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'effectiveDate must be a calendar date in YYYY-MM-DD form',
  })
  @IsISO8601({ strict: true })
  effectiveDate!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Type-specific fields. See the schema for the submitted type.',
    example: { newSalary: 75000.0, currency: 'EUR' },
  })
  @IsObject()
  payload!: Record<string, unknown>;
}
