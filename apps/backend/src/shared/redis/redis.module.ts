import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createRedisOptions } from '../../config/redis.config';
import { CustomLogger } from '../services/custom-logger.service';
import { InfraTag } from '../../common/enums/logging-tag.enum';
import { REDIS_CLIENT } from './redis.constants';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    CustomLogger,
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService, CustomLogger],
      useFactory: (configService: ConfigService, logger: CustomLogger) => {
        const client = new Redis(createRedisOptions(configService));

        client.on('connect', () =>
          logger.logWithTag(InfraTag.REDIS_CONNECTIVITY, 'Redis connected'),
        );
        client.on('error', (error) =>
          logger.errorWithTag(
            InfraTag.REDIS_CONNECTIVITY,
            'Redis client error',
            error,
          ),
        );

        return client;
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService, CustomLogger],
})
export class RedisModule {}
