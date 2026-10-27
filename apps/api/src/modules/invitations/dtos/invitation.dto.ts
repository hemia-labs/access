import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Min,
  Max,
  MaxLength,
  MinLength,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';

export class CreateInvitationDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  identity_issuer_hint?: string;

  @IsOptional()
  @IsString()
  product_code?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  role_codes?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  expires_in_hours?: number;
}

export class AcceptInvitationDto {
  @IsString()
  @MinLength(40)
  @MaxLength(128)
  token: string;
}

export class AcceptInvitationProofDto extends AcceptInvitationDto {
  @IsString()
  @MaxLength(8192)
  identity_proof: string;
}
