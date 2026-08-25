import { ApiProperty } from '@nestjs/swagger';
import {
  IsISO4217CurrencyCode,
  IsNumber,
  IsPositive,
  Max,
} from 'class-validator';

export class SalaryChangePayloadDto {
  @ApiProperty({ example: 75000.0, description: 'Gross annual salary' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(999_999_999_999.99)
  newSalary!: number;

  @ApiProperty({ example: 'EUR', description: 'ISO 4217' })
  @IsISO4217CurrencyCode()
  currency!: string;
}
