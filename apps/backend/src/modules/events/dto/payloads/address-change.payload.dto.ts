import { ApiProperty } from '@nestjs/swagger';
import { IsISO31661Alpha2, IsString, Length } from 'class-validator';

export class AddressChangePayloadDto {
  @ApiProperty({ example: 'Hauptstrasse 12' })
  @IsString()
  @Length(1, 255)
  street!: string;

  @ApiProperty({ example: 'Berlin' })
  @IsString()
  @Length(1, 128)
  city!: string;

  @ApiProperty({ example: '10115' })
  @IsString()
  @Length(1, 16)
  postalCode!: string;

  @ApiProperty({ example: 'DE', description: 'ISO 3166-1 alpha-2' })
  @IsISO31661Alpha2()
  country!: string;
}
