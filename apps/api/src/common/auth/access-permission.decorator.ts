import { SetMetadata } from '@nestjs/common';

export const ACCESS_PERMISSION_KEY = 'access_permission';

export type AccessPermissionRequirement = {
  permission: string;
  global?: boolean;
};

export const AccessPermission = (
  permission: string,
  options: { global?: boolean } = {},
) =>
  SetMetadata(ACCESS_PERMISSION_KEY, {
    permission,
    global: options.global,
  } satisfies AccessPermissionRequirement);
