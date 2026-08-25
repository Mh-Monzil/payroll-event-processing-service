import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { EventStatus } from '../enums/event-status.enum';
import { PayrollEventType } from '../enums/payroll-event-type.enum';

export class ListEventsQueryDto {
  @ApiPropertyOptional({ example: 'EMP-001' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  employeeId?: string;

  @ApiPropertyOptional({ enum: EventStatus })
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  @ApiPropertyOptional({ enum: PayrollEventType })
  @IsOptional()
  @IsEnum(PayrollEventType)
  type?: PayrollEventType;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
