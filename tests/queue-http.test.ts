import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { QueueStore } from '../server/queue/store.ts';
import { queueHttp } from '../server/queue/http.ts';
import {
  connectorRequest,
  runConnector,
  validateServer,
} from '../server/queue/connector-client.ts';
const resumeInput = {
  role: '产品经理',
  requirements: '用户研究与需求分析',
  dimensionText: '需求分析、沟通协作',
  focus: '主动发现问题并推进解决',
  scoringGuidance: '根据具体行动和结果判断证据充分性',
  reportRequirements: '列明待核实内容',
  resumeText: '姓名：张三。示例大学毕业。我访谈了五位用户。',
};
const reading = {
  candidateName: '张三',
  candidateNameEvidence: '姓名：张三。',
  summary: '简历自述，待面试核实。',
  sections: ['教育背景', '工作经历', '项目经验', '技能'].map((name) => ({
    name,
    items:
      name === '教育背景'
        ? [{ text: '示例大学毕业', evidence: '示例大学毕业。' }]
        : [],
  })),
  interviewQuestions: Array.from({ length: 6 }, (_, index) => ({
    question: `请描述第 ${index + 1} 次主动发现用户问题并推进解决的具体经历。`,
    dimensions: [index % 2 === 0 ? '需求分析' : '沟通协作'],
    reason: '核实自驱力、具体行动与结果。',
    resumeEvidence: index === 5 ? null : '我访谈了五位用户。',
    listenFor: ['个人行动', '结果与反思'],
    probes: ['你如何验证效果？'],
  })),
  followUps: ['请补充项目时间范围。'],
};
const input = {
  role: '产品经理',
  requirements: '用户调研',
  dimensions: ['需求分析'],
  transcript: '候选人：我访谈了五位用户。',
};
const report = {
  summary: '有调研经验。',
  dimensions: [
    {
      name: '需求分析',
      score: 3,
      assessment: '有访谈经历。',
      evidence: ['我访谈了五位用户。'],
    },
  ],
  followUps: [],
};
const status = async () => ({
  provider: 'codex-local' as const,
  analysis: true,
  message: 'ready',
});
const until = async (check: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'interview-queue-test-'));
  await writeFile(join(dir, 'index.html'), '<h1>fixture</h1>');
  const store = new QueueStore(join(dir, 'queue.sqlite'));
  const user = store.createUser('tester', 'test-password-123').id;
  const config = { origin: 'http://127.0.0.1' };
  const server = queueHttp(store, config, dir);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no listener');
  config.origin += ':' + address.port;
  const cookie = 'interview_session=' + store.newSession(user);
  const api = (path: string, method = 'GET', body?: unknown) =>
    fetch(config.origin + path, {
      method,
      headers: {
        Origin: config.origin,
        Cookie: cookie,
        'X-Interview-Account': user,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return {
    store,
    user,
    origin: config.origin,
    api,
    async close() {
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
void test('HTTP queue holds offline jobs, pairs a connector, and returns a validated result', async () => {
  const f = await fixture();
  const controller = new AbortController();
  let worker: Promise<void> | undefined;
  try {
    assert.equal((await fetch(f.origin)).status, 200);
    assert.equal((await fetch(f.origin + '/api/jobs')).status, 401);
    assert.equal(
      await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(
          f.origin + '/api/jobs',
          { headers: { Host: 'evil.example' } },
          (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode));
          },
        );
        request.on('error', reject);
        request.end();
      }),
      403,
    );
    assert.equal(
      (
        await fetch(f.origin + '/api/jobs', {
          method: 'POST',
          headers: { Origin: f.origin, 'Content-Type': 'application/json' },
          body: 'x'.repeat(550001),
        })
      ).status,
      413,
    );
    const submitted = await f.api('/api/jobs', 'POST', {
      client: 'offline-123',
      label: '合成面试',
      input,
    });
    assert.equal(submitted.status, 202);
    const job = (await submitted.json()) as { id: string };
    assert.equal(f.store.get(f.user, job.id).state, 'queued');
    const pair = (await (await f.api('/api/pair', 'POST', {})).json()) as {
      code: string;
      expiresAt: number;
    };
    assert.ok(pair.expiresAt > Date.now());
    const d = await connectorRequest(f.origin, '/api/pair/redeem', {
      code: pair.code,
      name: '测试电脑',
    });
    assert.equal(typeof d.token, 'string');
    await assert.rejects(
      connectorRequest(f.origin, '/api/pair/redeem', {
        code: pair.code,
        name: '重复配对',
      }),
      /配对码.*重新生成/,
    );
    let calls = 0;
    worker = runConnector(
      { server: f.origin, token: String(d.token), id: String(d.id) },
      controller.signal,
      {
        status,
        analyze: async (actual) => {
          calls++;
          assert.deepEqual(actual, input);
          return report;
        },
      },
      { pollMs: 10, heartbeatMs: 20 },
    );
    await until(() => f.store.get(f.user, job.id).state === 'completed');
    const restored = (await (await f.api('/api/jobs/' + job.id)).json()) as {
      report: unknown;
    };
    assert.deepEqual(restored.report, report);
    assert.equal(calls, 1);
    assert.equal(
      f.store.db.prepare('SELECT input FROM jobs WHERE id=?').get(job.id)
        ?.input,
      null,
    );
    assert.equal((await f.api('/api/jobs')).status, 200);
  } finally {
    controller.abort();
    await worker;
    await f.close();
  }
});
void test('explicit cancellation reaches the running connector and prevents late results', async () => {
  const f = await fixture();
  const controller = new AbortController();
  let worker: Promise<void> | undefined,
    aborted = false;
  try {
    const d = f.store.redeem(f.store.pairing(f.user).code, '测试电脑');
    const job = f.store.submit(f.user, 'cancel-123', '面试', input);
    worker = runConnector(
      { server: f.origin, ...d },
      controller.signal,
      {
        status,
        analyze: async (_input, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                aborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          }),
      },
      { pollMs: 10, heartbeatMs: 20 },
    );
    await until(() => f.store.get(f.user, job.id).state === 'running');
    assert.equal((await f.api('/api/jobs/' + job.id, 'DELETE')).status, 200);
    await until(() => aborted);
    assert.equal(f.store.get(f.user, job.id).state, 'cancelled');
    assert.equal(f.store.get(f.user, job.id).report, null);
  } finally {
    controller.abort();
    await worker;
    await f.close();
  }
});
void test('connector allows only HTTPS or loopback roots', () => {
  assert.equal(
    validateServer('https://interview.example/'),
    'https://interview.example',
  );
  for (const url of [
    'http://example.com',
    'https://example.com/path',
    'https://user:secret@example.com',
    'https://example.com/?query=1',
  ])
    assert.throws(() => validateServer(url));
});
void test('connector routes resume work to the reading runner and stores its cited output', async () => {
  const f = await fixture();
  const controller = new AbortController();
  let worker: Promise<void> | undefined;
  try {
    const input = resumeInput;
    const report = reading;
    const d = f.store.redeem(f.store.pairing(f.user).code, '阅读电脑');
    const r = await f.api('/api/jobs', 'POST', {
      client: 'resume-http-123',
      kind: 'resume',
      label: '虚构简历',
      input,
    });
    assert.equal(r.status, 202);
    const job = (await r.json()) as { id: string };
    worker = runConnector(
      { server: f.origin, ...d },
      controller.signal,
      {
        status,
        analyze: async () => {
          throw new Error('wrong runner');
        },
        readResume: async (value) => {
          assert.deepEqual(value, input);
          return report;
        },
      },
      { pollMs: 10, heartbeatMs: 20 },
    );
    await until(() => f.store.get(f.user, job.id).state === 'completed');
    const restored = (await (await f.api('/api/jobs/' + job.id)).json()) as {
      state: string;
      report: unknown;
    };
    assert.equal(restored.state, 'completed');
    assert.deepEqual(restored.report, report);
  } finally {
    controller.abort();
    await worker;
    await f.close();
  }
});

void test('connector fails resume work whose question evidence is absent from the submitted text', async () => {
  const f = await fixture();
  const controller = new AbortController();
  let worker: Promise<void> | undefined;
  try {
    const d = f.store.redeem(f.store.pairing(f.user).code, '阅读电脑');
    const job = f.store.submit(
      f.user,
      'resume-invalid-http',
      '简历',
      resumeInput,
      'resume',
    );
    worker = runConnector(
      { server: f.origin, ...d },
      controller.signal,
      {
        status,
        analyze: async () => {
          throw new Error('wrong runner');
        },
        readResume: async (actual) => {
          assert.deepEqual(actual, resumeInput);
          const invalid = structuredClone(reading);
          invalid.interviewQuestions[0].resumeEvidence =
            '简历中不存在的项目成果';
          return invalid;
        },
      },
      { pollMs: 10, heartbeatMs: 20 },
    );
    await until(() => f.store.get(f.user, job.id).state === 'failed');
    const restored = (await (await f.api('/api/jobs/' + job.id)).json()) as {
      state: string;
      report: unknown;
      error: string;
    };
    assert.equal(restored.state, 'failed');
    assert.equal(restored.report, null);
    // The connector must reject invalid runner output before transmitting it.
    assert.match(restored.error, /本地 Codex 未完成分析/);
  } finally {
    controller.abort();
    await worker;
    await f.close();
  }
});
