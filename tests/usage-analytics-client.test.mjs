import './register-ui-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

test('usage analytics drops unauthorized batches and retries transient failures', async (t) => {
  const previousWindow = globalThis.window;
  const previousLocation = globalThis.location;
  const previousFetch = globalThis.fetch;
  let timerId = 0;
  globalThis.window = {
    setTimeout: () => ++timerId,
    setInterval: () => ++timerId,
    clearInterval: () => {},
  };
  globalThis.location = { pathname: '/dashboard' };
  const statuses = [401, 403, 500, 200];
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    const status = statuses.shift();
    return { ok: status >= 200 && status < 300, status };
  };
  t.after(() => {
    globalThis.window = previousWindow;
    globalThis.location = previousLocation;
    globalThis.fetch = previousFetch;
  });

  const { flushUsageAnalytics, setUsageAnalyticsSession } = await import(
    '../runtime/modules/observability/ui/usage-analytics-client.ts'
  );

  setUsageAnalyticsSession({ userId: 'unauthorized-401', sessionId: 's-401' });
  await flushUsageAnalytics();
  await flushUsageAnalytics();
  assert.equal(requests.length, 1, '401 batch is terminal');

  setUsageAnalyticsSession({ userId: 'unauthorized-403', sessionId: 's-403' });
  await flushUsageAnalytics();
  await flushUsageAnalytics();
  assert.equal(requests.length, 2, '403 batch is terminal');

  setUsageAnalyticsSession({ userId: 'transient-500', sessionId: 's-500' });
  await flushUsageAnalytics();
  await flushUsageAnalytics();
  assert.equal(requests.length, 4, '500 batch is retained and retried');
  assert.ok(requests.every(({ url }) => url === '/api/v1/analytics/events'));
});