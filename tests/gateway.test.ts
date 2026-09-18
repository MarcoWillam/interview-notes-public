import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { createGateway } from '../server/gateway.ts';
const listen = (server: Server) =>
  new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address !== 'string') resolve(address.port);
      else reject(new Error('Missing address'));
    });
  });
const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
const input = {
  role: '产品经理',
  requirements: '用户调研',
  dimensions: ['需求分析'],
  transcript: '候选人：我访谈了五位用户。',
};
const report = {
  summary: '待核实调研细节',
  dimensions: [
    {
      name: '需求分析',
      assessment: '有访谈经历',
      score: 3,
      evidence: ['我访谈了五位用户。'],
    },
  ],
  followUps: [],
};
void test('HTTP gateway serves the page and status, rejects foreign callers and oversized input, and returns verified analysis', async (t) => {
  const frontend = createServer((_req, res) => res.end('fixture page'));
  const frontendPort = await listen(frontend);
  t.after(() => close(frontend));
  let calls = 0;
  const options = {
    port: 0,
    frontendPort,
    analyze: async () => {
      calls++;
      return report;
    },
    status: async () => ({
      analysis: true,
      provider: 'codex-local' as const,
      message: '已连接',
    }),
  };
  const gateway = createGateway(options);
  options.port = await listen(gateway.server);
  t.after(() => close(gateway.server));
  const base = `http://127.0.0.1:${options.port}`;
  assert.equal(await (await fetch(base)).text(), 'fixture page');
  assert.equal(
    ((await (await fetch(base + '/api/status')).json()) as { provider: string })
      .provider,
    'codex-local',
  );
  const spoofed = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: options.port,
        path: '/api/status',
        headers: { Host: 'evil.example' },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(spoofed, 403);
  const post = (origin: string, body: string) =>
    fetch(base + '/api/analyze', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body,
    });
  assert.equal(
    (await post('https://example.com', JSON.stringify(input))).status,
    403,
  );
  assert.equal((await post(base, 'x'.repeat(550001))).status, 413);
  assert.equal((await fetch(base + '/api/asr/stream')).status, 404);
  assert.equal(calls, 0);
  const response = await post(base, JSON.stringify(input));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { report });
  assert.equal(calls, 1);
});
void test('HTTP client disconnect aborts the running analysis', async (t) => {
  let started!: () => void, cancelled!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const stopped = new Promise<void>((resolve) => {
    cancelled = resolve;
  });
  const options = {
    port: 0,
    frontendPort: 1,
    analyze: (_input: unknown, signal: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        started();
        signal.addEventListener(
          'abort',
          () => {
            cancelled();
            reject(new Error('aborted'));
          },
          { once: true },
        );
      }),
  };
  const gateway = createGateway(options);
  options.port = await listen(gateway.server);
  t.after(() => {
    gateway.cancelAll();
    return close(gateway.server);
  });
  const base = `http://127.0.0.1:${options.port}`;
  const controller = new AbortController();
  const response = fetch(base + '/api/analyze', {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: controller.signal,
  }).catch(() => null);
  await ready;
  controller.abort();
  await response;
  await Promise.race([
    stopped,
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Cancellation did not reach runner')),
        2000,
      );
      timer.unref();
    }),
  ]);
});
