import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './shared/redis/redis.module';
import { QueueModule } from './shared/queue/queue.module';
import { ProcessingModule } from './modules/processing/processing.module';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env', '../../.env'],
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    RedisModule,
    QueueModule,
    ProcessingModule,
  ],
})
export class WorkerModule {}
