import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
// import { DatabaseModule } from './database/database.module';
// import { WidgetsModule } from './modules/widgets/widgets.module';

@Module({
  // ponytail: DatabaseModule + WidgetsModule comentados hasta tener DB; descomentar juntos y setear DB_* en .env
  imports: [/* DatabaseModule, WidgetsModule */],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
