import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
export class LegalConsumerContextDto {
  @IsUUID() organization_id: string;
  @IsString() @MinLength(1) @MaxLength(2048) identity_issuer: string;
  @IsString() @MinLength(1) @MaxLength(160) subject_id: string;
}

export class LegalOrganizationContextDto {
  @IsUUID() organization_id: string;
}

export class LegalOrganizationsValidateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  organization_ids: string[];
}
