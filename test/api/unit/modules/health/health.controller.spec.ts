import { HealthController } from '../../../../../apps/api/src/modules/health/health.controller';

describe('HealthController startup probe', () => {
  it('returns HTTP 503 while the evaluator workers are not ready', () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const controller = new HealthController({
      startup: () => ({ status: 'not_ready', reason: 'evaluator_not_ready' }),
    } as never);

    controller.startup(response);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({
      status: 'not_ready',
      reason: 'evaluator_not_ready',
    });
  });
});
