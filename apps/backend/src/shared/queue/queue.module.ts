import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { createRedisOptions } from '../../config/redis.config';
import { PAYROLL_QUEUE } from '../../config/queue.config';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: createRedisOptions(configService),
      }),
    }),
    BullModule.registerQueue({ name: PAYROLL_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
