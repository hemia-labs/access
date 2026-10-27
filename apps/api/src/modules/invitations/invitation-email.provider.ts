import { SESv2Client } from '@aws-sdk/client-sesv2';
import { ConfigService } from '@nestjs/config';

export function createInvitationSesClient(config: ConfigService) {
  return new SESv2Client({
    region: config.get<string>('AWS_REGION', 'us-east-2'),
  });
}
