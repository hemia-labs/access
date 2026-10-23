import { IsIn, IsInt, Min } from 'class-validator';
import type { OrganizationType } from '../entities/organization.entity';
export class SetOrganizationTypeDto {
  @IsIn(['internal', 'customer', 'partner', 'vendor', 'sandbox'])
  type: OrganizationType;

  @IsInt()
  @Min(1)
  version: number;
}
