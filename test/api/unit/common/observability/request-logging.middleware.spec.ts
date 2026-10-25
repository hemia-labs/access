import { EventEmitter } from 'events';
import { RequestLoggingMiddleware } from '../../../../../apps/api/src/common/observability/request-logging.middleware';

describe('RequestLoggingMiddleware', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    '/v1/me/context?token=sensitive-token&product=billing',
    '/v1/me/context',
  ])('logs the path without query credentials: %s', (originalUrl) => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const request = {
      originalUrl,
      method: 'GET',
      header: jest.fn().mockReturnValue('test-trace'),
    };
    const response = Object.assign(new EventEmitter(), {
      setHeader: jest.fn(),
      statusCode: 200,
    });
    const next = jest.fn();

    const middleware = new RequestLoggingMiddleware();
    middleware.use.call(middleware, request, response, next);
    response.emit('finish');

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.setHeader).toHaveBeenCalledWith('x-trace-id', 'test-trace');
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
      path: '/v1/me/context',
      method: 'GET',
      status: 200,
      trace_id: 'test-trace',
    });
    expect(log.mock.calls[0][0]).not.toContain('sensitive-token');
  });
});
