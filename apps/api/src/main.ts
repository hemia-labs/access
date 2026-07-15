import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableCors();
  const config = app.get(ConfigService);
  await app.listen(config.get<number>('access.port') ?? 3019);
}
bootstrap();
