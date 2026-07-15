import { IsEmail, IsInt, IsOptional, IsString, Min } from 'class-validator';

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
  role_codes?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  expires_in_hours?: number;
}

export class AcceptInvitationDto {
  @IsString()
  token: string;
}
