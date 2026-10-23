import { registerAs } from '@nestjs/config';

export default registerAs('eventBus', () => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const enabled =
    nodeEnv === 'production' || process.env.EVENT_BUS_ENABLED === 'true';

  return {
    url: process.env.AMQP_URL,
    serviceName: process.env.EVENT_BUS_SERVICE_NAME ?? 'hemia-access',
    prefetch: Math.max(1, Number(process.env.EVENT_BUS_PREFETCH ?? 10)),
    enabled,
    required: nodeEnv === 'production',
    nodeEnv,
  };
});
