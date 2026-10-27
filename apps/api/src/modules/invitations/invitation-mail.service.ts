import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

export type InvitationEmailContext = {
  organizationName: string;
  inviterName?: string | null;
  recipientName?: string | null;
};

@Injectable()
export class InvitationMailService implements OnModuleDestroy {
  constructor(
    private readonly client: SESv2Client,
    private readonly config: ConfigService,
  ) {}

  async send(
    email: string,
    token: string,
    expiresAt: Date,
    context?: InvitationEmailContext,
  ) {
    const link = new URL(
      '/invitations',
      this.config.getOrThrow<string>('email.appUrl'),
    );
    link.hash = new URLSearchParams({ token }).toString();
    await this.sendTemplate(
      email,
      this.config.getOrThrow<string>('email.ses.invitationTemplate'),
      {
        ...this.data(email, context),
        invitation_url: link.toString(),
        expiration_date:
          new Intl.DateTimeFormat('es-MX', {
            dateStyle: 'long',
            timeStyle: 'short',
            timeZone: 'America/Mexico_City',
          }).format(expiresAt) + ' (hora de Ciudad de México)',
      },
    );
  }

  async sendWelcome(email: string, context: InvitationEmailContext) {
    await this.sendTemplate(
      email,
      this.config.getOrThrow<string>('email.ses.welcomeTemplate'),
      {
        ...this.data(email, context),
        workspace_url: this.config.getOrThrow<string>('email.consoleUrl'),
      },
    );
  }

  private data(email: string, context?: InvitationEmailContext) {
    const organization = (context?.organizationName || '').replace(
      /[\r\n]/g,
      ' ',
    );
    const inviter = (context?.inviterName || '').replace(/[\r\n]/g, ' ');
    return {
      app_name: this.config.getOrThrow<string>('email.appName'),
      organization_name: organization,
      organization_name_html: this.escapeHtml(organization),
      inviter_name: inviter,
      inviter_name_html: this.escapeHtml(inviter),
      recipient_name_html: this.escapeHtml(context?.recipientName || ''),
      recipient_email: email,
      recipient_email_html: this.escapeHtml(email),
      support_email: this.config.getOrThrow<string>('email.supportEmail'),
    };
  }

  private escapeHtml(value: string) {
    // SES does not HTML-escape template values; keep raw values separately for text/subject.
    return value.replace(
      /[&<>"']/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[char]!,
    );
  }

  private async sendTemplate(
    email: string,
    template: string,
    data: Record<string, string>,
  ) {
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
              TemplateName: template,
              TemplateData: JSON.stringify(data),
            },
          },
        }),
      );
      if (!result.MessageId) throw new Error('SES did not accept the message');
    } catch {
      // Never expose AWS credentials or invitation URLs in API errors/logs.
      throw new ServiceUnavailableException('Invitation email delivery failed');
    }
  }
  onModuleDestroy() {
    this.client.destroy();
  }
}
