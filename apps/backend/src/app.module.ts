import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './shared/redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { EventsModule } from './modules/events/events.module';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env', '../../.env'],
      validate: validateEnv,
    }),
    DatabaseModule,
    RedisModule,
    HealthModule,
    EventsModule,
  ],
})
export class AppModule {}
