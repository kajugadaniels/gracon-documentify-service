import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ThrottlerExceptionFilter } from './common/filters/throttler-exception.filter';
import { buildCorsConfig } from './common/security/cors.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = config.get<number>('APP_PORT', 3005);
  const env = config.get<string>('APP_ENV', 'development');
  const maxContentSizeBytes = config.get<number>(
    'MAX_CONTENT_SIZE_BYTES',
    10 * 1024 * 1024,
  );
  const bodyLimit = `${maxContentSizeBytes}b`;

  app.use(helmet());
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));
  app.setGlobalPrefix('api/v1');
  app.enableCors(
    buildCorsConfig(
      config.get<string>('FRONTEND_URL', 'http://localhost:4002'),
      config.get<string>('FRONTEND_URLS'),
    ),
  );

  app.useGlobalFilters(
    new GlobalExceptionFilter(),
    new ThrottlerExceptionFilter(),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (env !== 'production') {
    const doc = new DocumentBuilder()
      .setTitle('Gracon 360 — Documents Service')
      .setDescription(
        'Document creation, editing, versioning, and signing integration',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, doc),
    );
  }

  await app.listen(port);
  console.log(
    `[${env.toUpperCase()}] Documents service on http://localhost:${port}/api/v1`,
  );
}

bootstrap();
