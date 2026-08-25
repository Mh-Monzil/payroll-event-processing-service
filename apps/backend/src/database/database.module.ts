import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../config/database.config';
import { CustomLogger } from '../shared/services/custom-logger.service';
import { InfraTag } from '../common/enums/logging-tag.enum';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createDatabaseOptions(configService),
    }),
  ],
  providers: [CustomLogger],
  exports: [TypeOrmModule, CustomLogger],
})
export class DatabaseModule {
  constructor(dataSource: DataSource, logger: CustomLogger) {
    logger.logWithTag(InfraTag.DB_CONNECTIVITY, 'Database connected', {
      initialized: dataSource.isInitialized,
      database: dataSource.options.database,
    });
  }
}
