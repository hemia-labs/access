import { HttpStatus } from '@nestjs/common';

export class AccessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = HttpStatus.BAD_REQUEST,
  ) {
    super(message);
  }
}
