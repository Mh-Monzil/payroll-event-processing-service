import { ConfigService } from '@nestjs/config';
import { RedisOptions } from 'ioredis';

export const createRedisOptions = (
  configService: ConfigService,
): RedisOptions => ({
  host: configService.get<string>('REDIS_HOST', 'localhost'),
  port: Number(configService.get<number>('REDIS_PORT', 6379)),
  maxRetriesPerRequest: null,
});
