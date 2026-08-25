import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { DataSourceOptions } from 'typeorm';

export const createDatabaseOptions = (
  configService: ConfigService,
): DataSourceOptions => ({
  type: 'postgres',
  url: configService.getOrThrow<string>('DATABASE_URL'),
  synchronize: false,
  migrationsRun: false,
  logging: configService.get<string>('DATABASE_LOGGING') === 'true',
  entities: [join(__dirname, '..', 'modules', '**', '*.entity{.ts,.js}')],
  migrations: [join(__dirname, '..', 'database', 'migrations', '*{.ts,.js}')],
});
