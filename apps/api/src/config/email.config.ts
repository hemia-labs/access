import { registerAs } from '@nestjs/config';
export default registerAs('email', () => {
  const project = process.env.EMAIL_PROJECT || 'hemia-access';
  const environment =
    process.env.EMAIL_ENVIRONMENT ||
    (process.env.NODE_ENV === 'production' ? 'prod' : 'dev');
  return {
    appName: process.env.EMAIL_APP_NAME || 'Hemia',
    appUrl:
      process.env.ID_FRONTEND_URL ||
      process.env.EMAIL_APP_URL ||
      'http://localhost:5173',
    supportEmail: process.env.EMAIL_SUPPORT_EMAIL || 'support@hemia.dev',
    ses: {
      fromName: process.env.EMAIL_FROM_NAME || 'Hemia',
      fromAuth: process.env.EMAIL_FROM_AUTH || `auth@${project}.hemia.dev`,
      replyTo: process.env.EMAIL_REPLY_TO || 'support@hemia.dev',
      configurationSetAuth:
        process.env.EMAIL_CONFIGURATION_SET_AUTH || `hemia-${environment}-auth`,
      invitationTemplate:
        process.env.EMAIL_INVITATION_TEMPLATE ||
        `${project}-${environment}-invitation`,
    },
  };
});
