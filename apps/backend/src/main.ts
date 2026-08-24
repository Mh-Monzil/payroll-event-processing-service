import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseFormatInterceptor } from './common/interceptors/response-format.interceptor';
import { CustomLogger } from './shared/services/custom-logger.service';
import { InfraTag } from './common/enums/logging-tag.enum';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const logger = new CustomLogger('Bootstrap');

  app.enableCors({ origin: true, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalInterceptors(new ResponseFormatInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Payroll Event Processing Service')
    .setDescription(
      'Accepts payroll events, processes them asynchronously, exactly once, and in order per employee.',
    )
    .setVersion('1.0')
    .addTag('events', 'Submit and inspect payroll events')
    .addTag('health', 'Liveness and readiness probes')
    .build();
  SwaggerModule.setup(
    'api',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);

  logger.logWithTag(InfraTag.BOOTSTRAP, 'API started', {
    port,
    docs: `http://localhost:${port}/api`,
    env: configService.get<string>('NODE_ENV'),
  });
}

void bootstrap();
