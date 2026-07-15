import { IsString, IsUUID } from 'class-validator';

export class CheckAccessDto {
  @IsUUID()
  organization_id: string;

  @IsString()
  permission: string;
}
