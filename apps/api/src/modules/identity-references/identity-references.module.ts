import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityReference } from './entities/identity-reference.entity';
import { IdentityReferencesService } from './identity-references.service';

@Module({
  imports: [TypeOrmModule.forFeature([IdentityReference])],
  providers: [IdentityReferencesService],
  exports: [IdentityReferencesService],
})
export class IdentityReferencesModule {}
