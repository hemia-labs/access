import { ConfigService } from '@nestjs/config';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { InvitationMailService } from '../../../../apps/api/src/modules/invitations/invitation-mail.service';
import { createInvitationSesClient } from '../../../../apps/api/src/modules/invitations/invitation-email.provider';

const config = new ConfigService({
  email: {
    appName: 'Hemia',
    appUrl: 'https://id.example.test',
    supportEmail: 'support@hemia.dev',
    consoleUrl: 'https://console.example.test',
    ses: {
      fromName: 'Hemia',
      fromAuth: 'auth@hemia-access.hemia.dev',
      replyTo: 'support@hemia.dev',
      configurationSetAuth: 'hemia-dev-auth',
      invitationTemplate: 'hemia-access-dev-invitation',
      welcomeTemplate: 'hemia-access-dev-welcome',
    },
  },
});
function fixture() {
  const send = jest.fn().mockResolvedValue({ MessageId: 'message-id' });
  const destroy = jest.fn();
  const service = new InvitationMailService(
    { send, destroy } as unknown as SESv2Client,
    config,
  );
  return { service, send, destroy };
}
describe('SES v2 invitations (Balanz contract)', () => {
  it('uses SES templates, configuration sets and fragment links', async () => {
    const { service, send } = fixture();
    await service.send(
      'invitee@example.test',
      'secret-token',
      new Date('2030-01-01'),
    );
    const command = (send.mock.calls as unknown[][])[0][0] as SendEmailCommand;
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command.input.FromEmailAddress).toBe(
      'Hemia <auth@hemia-access.hemia.dev>',
    );
    expect(command.input.Destination?.ToAddresses).toEqual([
      'invitee@example.test',
    ]);
    expect(command.input.ConfigurationSetName).toBe('hemia-dev-auth');
    expect(command.input.Content?.Template?.TemplateName).toBe(
      'hemia-access-dev-invitation',
    );
    const data = JSON.parse(
      command.input.Content?.Template?.TemplateData ?? '{}',
    ) as Record<string, string>;
    expect(data.invitation_url).toBe(
      'https://id.example.test/invitations#token=secret-token',
    );
    expect(data.app_name).toBe('Hemia');
  });
  it('escapes user data in HTML while preserving readable text and subject values', async () => {
    const { service, send } = fixture();
    await service.send(
      'invitee@example.test',
      'token',
      new Date('2030-01-01'),
      {
        organizationName: 'R&D <equipo>\r\nPrueba',
        inviterName: '<img src=x>',
      },
    );
    const command = (send.mock.calls as unknown[][])[0][0] as SendEmailCommand;
    const data = JSON.parse(
      command.input.Content!.Template!.TemplateData!,
    ) as Record<string, string>;
    expect(data.organization_name).toBe('R&D <equipo>  Prueba');
    expect(data.organization_name_html).toBe('R&amp;D &lt;equipo&gt;  Prueba');
    expect(data.inviter_name_html).toBe('&lt;img src=x&gt;');
    expect(data.expiration_date).toContain('hora de Ciudad de México');
  });
  it('sends welcome to the accepted email with the Console URL and no invitation token', async () => {
    const { service, send } = fixture();
    await service.sendWelcome('invitee@example.test', {
      organizationName: 'Hemia',
    });
    const command = (send.mock.calls as unknown[][])[0][0] as SendEmailCommand;
    expect(command.input.Content!.Template!.TemplateName).toBe(
      'hemia-access-dev-welcome',
    );
    const data = JSON.parse(
      command.input.Content!.Template!.TemplateData!,
    ) as Record<string, string>;
    expect(data.workspace_url).toBe('https://console.example.test');
    expect(data.recipient_email).toBe('invitee@example.test');
    expect(data.invitation_url).toBeUndefined();
  });
  it('reports delivery failure without exposing AWS errors or the invitation token', async () => {
    const { service, send } = fixture();
    send.mockRejectedValue(new Error('sensitive AWS response'));
    await expect(
      service.send('invitee@example.test', 'secret-token', new Date()),
    ).rejects.toThrow('Invitation email delivery failed');
  });
  it('does not claim delivery if SES did not return a message ID', async () => {
    const { service, send } = fixture();
    send.mockResolvedValue({});
    await expect(
      service.send('invitee@example.test', 'token', new Date()),
    ).rejects.toThrow('Invitation email delivery failed');
  });
  it('destroys the SES client on shutdown', () => {
    const { service, destroy } = fixture();
    service.onModuleDestroy();
    expect(destroy).toHaveBeenCalled();
  });
  it('uses AWS environment credentials directly', async () => {
    const original = { ...process.env };
    process.env.AWS_ACCESS_KEY_ID = 'test-access';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
    process.env.AWS_SESSION_TOKEN = 'test-session';
    const client = createInvitationSesClient(
      new ConfigService({ AWS_REGION: 'us-east-2' }),
    );
    try {
      expect(await client.config.region()).toBe('us-east-2');
      expect(await client.config.credentials()).toMatchObject({
        accessKeyId: 'test-access',
        secretAccessKey: 'test-secret',
        sessionToken: 'test-session',
      });
    } finally {
      client.destroy();
      process.env = original;
    }
  });
});
