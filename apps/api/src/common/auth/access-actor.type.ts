import { Request } from 'express';

export type AccessActor = {
  identityReferenceId: string;
  issuer: string;
  subjectId: string;
  identityType: 'workforce_user' | 'customer_user' | 'service_account';
  scopes?: string[];
};

export type AccessRequest = Request & {
  accessActor?: AccessActor;
  traceId?: string;
};
