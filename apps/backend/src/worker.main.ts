import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { WorkerModule } from './worker.module';
import { CustomLogger } from './shared/services/custom-logger.service';
import { InfraTag } from './common/enums/logging-tag.enum';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const configService = app.get(ConfigService);
  const logger = new CustomLogger('WorkerBootstrap');

  app.enableShutdownHooks();

  logger.logWithTag(InfraTag.BOOTSTRAP, 'Worker started', {
    concurrency: configService.get<number>('WORKER_CONCURRENCY'),
    env: configService.get<string>('NODE_ENV'),
  });
}

void bootstrap();
