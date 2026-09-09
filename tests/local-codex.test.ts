import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisHandler } from '../server/analysis.ts';
const input = {
  role: '产品经理',
  requirements: '独立完成需求调研',
  dimensions: ['需求分析'],
  transcript:
    '面试官：如何开展调研？\n候选人：我访谈了五位用户，整理出三个核心问题。',
};
const report = {
  summary: '具备调研经验，细节待核实。',
  dimensions: [
    {
      name: '需求分析',
      score: 3,
      assessment: '有具体访谈案例。',
      evidence: ['我访谈了五位用户，整理出三个核心问题。'],
    },
  ],
  followUps: ['如何选择受访用户？'],
};
const request = (value: unknown = input, origin = 'http://localhost:8787') =>
  new Request('http://localhost:8787/api/analyze', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
void test('local analysis returns only a report grounded in the submitted text', async () => {
  const handle = createAnalysisHandler(async (received) => {
    assert.deepEqual(received, input);
    return report;
  });
  const response = await handle(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), report);
});
void test('foreign origin and invalid inputs never invoke Codex', async () => {
  let calls = 0;
  const handle = createAnalysisHandler(async () => {
    calls++;
    return report;
  });
  assert.equal(
    (await handle(request(input, 'https://example.com'))).status,
    403,
  );
  assert.equal((await handle(request({}))).status, 400);
  assert.equal(
    (await handle(request({ ...input, transcript: '字'.repeat(80001) })))
      .status,
    400,
  );
  assert.equal(
    (await handle(request({ ...input, transcript: '字'.repeat(200000) })))
      .status,
    413,
  );
  assert.equal(calls, 0);
});
void test('concurrent analysis cannot start a second paid run', async () => {
  let complete!: (value: unknown) => void;
  const handle = createAnalysisHandler(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const pending = handle(request());
  while (!complete) await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await handle(request())).status, 429);
  complete(report);
  assert.equal((await pending).status, 200);
});
void test('provider failure and invented quotations never leak raw output', async () => {
  const broken = createAnalysisHandler(async () => {
    throw new Error('private-token upstream');
  });
  const response = await broken(request());
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /private-token/);
  const fabricated = createAnalysisHandler(async () => ({
    ...report,
    dimensions: [{ ...report.dimensions[0], evidence: ['销售额翻倍'] }],
  }));
  assert.equal((await fabricated(request())).status, 502);
});
void test('cancellation reaches the runner and releases the single run slot', async () => {
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const handle = createAnalysisHandler(
    (_input, signal) =>
      new Promise((_resolve, reject) => {
        started();
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      }),
  );
  const initial = request();
  const response = handle(new Request(initial, { signal: controller.signal }));
  await ready;
  controller.abort();
  assert.equal((await response).status, 499);
});
