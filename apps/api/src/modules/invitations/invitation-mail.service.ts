import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

@Injectable()
export class InvitationMailService implements OnModuleDestroy {
  constructor(
    private readonly client: SESv2Client,
    private readonly config: ConfigService,
  ) {}
  async send(email: string, token: string, expiresAt: Date) {
    const link = new URL(
      '/invitations',
      this.config.getOrThrow<string>('email.appUrl'),
    );
    link.hash = new URLSearchParams({ token }).toString();
    try {
      const result = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: `${this.config.getOrThrow<string>('email.ses.fromName')} <${this.config.getOrThrow<string>('email.ses.fromAuth')}>`,
          Destination: { ToAddresses: [email] },
          ReplyToAddresses: [
            this.config.getOrThrow<string>('email.ses.replyTo'),
          ],
          ConfigurationSetName: this.config.getOrThrow<string>(
            'email.ses.configurationSetAuth',
          ),
          Content: {
            Template: {
              TemplateName: this.config.getOrThrow<string>(
                'email.ses.invitationTemplate',
              ),
              TemplateData: JSON.stringify({
                app_name: this.config.getOrThrow<string>('email.appName'),
                invitation_url: link.toString(),
                expiration_date: expiresAt.toISOString(),
                support_email:
                  this.config.getOrThrow<string>('email.supportEmail'),
              }),
            },
          },
        }),
      );
      if (!result.MessageId) throw new Error('SES did not accept the message');
    } catch {
      // Never expose AWS credentials or the invitation URL in API errors/logs.
      throw new ServiceUnavailableException('Invitation email delivery failed');
    }
  }
  onModuleDestroy() {
    this.client.destroy();
  }
}
