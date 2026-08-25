import { ApiProperty } from '@nestjs/swagger';
import { IsIBAN } from 'class-validator';

export class BankAccountChangePayloadDto {
  @ApiProperty({ example: 'DE89370400440532013000' })
  @IsIBAN()
  iban!: string;
}
