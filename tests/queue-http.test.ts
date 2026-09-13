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
import {
  AI_PM_WORK_SAMPLE_RUBRIC_VERSION,
  aiPmWorkSampleRubric,
} from '../lib/work-sample-rubric.ts';
const resumeInput = {
  role: '产品经理',
  requirements: '用户研究与需求分析',
  dimensionText: '需求分析、沟通协作',
  focus: '主动发现问题并推进解决',
  scoringGuidance: '根据具体行动和结果判断证据充分性',
  reportRequirements: '列明待核实内容',
  resumeText: '姓名：张三。示例大学毕业。我访谈了五位用户。',
  hasWrittenTest: false,
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
    questionSource: index === 5 ? 'role' : 'resume',
    listenFor: ['个人行动', '结果与反思'],
    probes: ['你如何验证效果？'],
  })),
  followUps: ['请补充项目时间范围。'],
};
const writtenTestInput = {
  role: resumeInput.role,
  requirements: resumeInput.requirements,
  dimensionText: resumeInput.dimensionText,
  focus: resumeInput.focus,
  scoringGuidance: resumeInput.scoringGuidance,
  reportRequirements: resumeInput.reportRequirements,
  resumeText: resumeInput.resumeText,
  existingQuestions: reading.interviewQuestions,
};
const writtenTestResult = {
  questions: Array.from({ length: 3 }, (_, index) => ({
    question: `请复述笔试方案中的第 ${index + 1} 个关键判断与取舍。`,
    questionSource: 'written-test' as const,
    dimensions: [index % 2 === 0 ? '需求分析' : '沟通协作'],
    reason: '核实候选人自己的判断。',
    resumeEvidence: null,
    listenFor: ['判断依据'],
    probes: ['如果假设不成立，你会如何调整？'],
  })),
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
const workSampleFor = (deviceId: string) => ({
  id: 'artifact-12345678',
  deviceId,
  name: 'ai-pm-work.zip',
  sha256: 'b'.repeat(64),
  bytes: 2048,
  modifiedAt: 123456,
});
const until = async (check: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
async function fixture(trustProxy?: boolean) {
  const dir = await mkdtemp(join(tmpdir(), 'interview-queue-test-'));
  await writeFile(join(dir, 'index.html'), '<h1>fixture</h1>');
  const store = new QueueStore(join(dir, 'queue.sqlite'));
  const user = store.createUser('tester', 'test-password-123').id;
  const config = { origin: 'http://127.0.0.1', trustProxy };
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
        workSamples: async () => ({
          artifacts: [workSampleFor(String(d.id))],
          files: new Map([['artifact-12345678', '/local-only/ai-pm-work.zip']]),
        }),
      },
      { pollMs: 10, heartbeatMs: 20 },
    );
    await until(() => f.store.get(f.user, job.id).state === 'completed');
    const restored = (await (await f.api('/api/jobs/' + job.id)).json()) as {
      report: unknown;
    };
    assert.deepEqual(restored.report, report);
    assert.equal(calls, 1);
    assert.equal(f.store.artifacts(f.user)[0]?.name, 'ai-pm-work.zip');
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
void test('HTTP queue accepts an explicit interview task kind from the browser client', async () => {
  const f = await fixture();
  try {
    const submitted = await f.api('/api/jobs', 'POST', {
      client: 'explicit-interview-kind-123',
      kind: 'interview',
      label: '候选人辅助评估',
      input,
    });
    assert.equal(submitted.status, 202);
    const job = (await submitted.json()) as { id: string; kind: string };
    assert.equal(job.kind, 'interview');
    assert.equal(f.store.get(f.user, job.id).kind, 'interview');
  } finally {
    await f.close();
  }
});
void test('worker syncs metadata-only artifacts and web submissions keep device affinity', async () => {
  const f = await fixture();
  try {
    const device = f.store.redeem(f.store.pairing(f.user).code, '作品电脑');
    const artifact = workSampleFor(device.id);
    const claim = await connectorRequest(
      f.origin,
      '/api/worker/claim',
      {
        ready: true,
        kinds: ['interview', 'resume', 'written-test', 'work-sample'],
        capabilities: ['work-sample'],
        artifacts: [artifact],
      },
      device.token,
    );
    assert.equal(claim.job, null);
    const listed = (await (await f.api('/api/artifacts')).json()) as {
      artifacts: Array<Record<string, unknown>>;
    };
    assert.equal(listed.artifacts[0]?.name, artifact.name);
    assert.equal(listed.artifacts[0]?.deviceName, '作品电脑');
    assert.equal('path' in listed.artifacts[0], false);
    const submitted = await f.api('/api/jobs', 'POST', {
      client: 'artifact-http-123',
      kind: 'resume',
      label: '候选人作品',
      input: { ...resumeInput, hasWrittenTest: true, workSample: artifact },
    });
    assert.equal(submitted.status, 202);
    const job = (await submitted.json()) as {
      artifactId: string;
      targetDeviceName: string;
    };
    assert.equal(job.artifactId, artifact.id);
    assert.equal(job.targetDeviceName, '作品电脑');
  } finally {
    await f.close();
  }
});
void test('connector routes a later work sample job through the local artifact runner', async () => {
  const f = await fixture();
  const controller = new AbortController();
  let worker: Promise<void> | undefined;
  try {
    const device = f.store.redeem(f.store.pairing(f.user).code, '作品电脑');
    const artifact = workSampleFor(device.id);
    const questions = Array.from({ length: 3 }, (_, index) => ({
      question: `请说明作品中的第 ${index + 1} 个产品判断。`,
      questionSource: 'work-sample' as const,
      dimensions: [index === 1 ? '沟通协作' : '需求分析'],
      reason: '核实作品中的具体取舍。',
      resumeEvidence: null,
      workSampleEvidence: { path: 'brief.md', excerpt: '目标用户是新手卖家' },
      listenFor: ['判断依据'],
      probes: ['如何验证？'],
    }));
    const result = {
      rubricVersion: AI_PM_WORK_SAMPLE_RUBRIC_VERSION,
      artifact: {
        id: artifact.id,
        name: artifact.name,
        sha256: artifact.sha256,
        bytes: artifact.bytes,
        modifiedAt: artifact.modifiedAt,
      },
      coverage: {
        analyzed: ['brief.md'],
        excluded: [],
        unsupported: [],
        truncated: false,
      },
      summary: '作品目标清楚，个人完成过程待核实。',
      dimensions: aiPmWorkSampleRubric.map(({ name }) => ({
        name,
        score: 4,
        assessment: '按统一笔试目的形成作品判断。',
        evidence: [{ path: 'brief.md', excerpt: '目标用户是新手卖家' }],
      })),
      strengths: ['问题明确'],
      risks: ['验证待核实'],
      questions,
    };
    let localPath = '';
    worker = runConnector(
      { server: f.origin, ...device },
      controller.signal,
      {
        status,
        analyze: async () => report,
        workSamples: async () => ({
          artifacts: [artifact],
          files: new Map([[artifact.id, '/local/works/candidate.zip']]),
        }),
        analyzeWorkSample: async (actual, path) => {
          assert.equal(actual.workSample.id, artifact.id);
          localPath = path;
          return result;
        },
      },
      { pollMs: 10, heartbeatMs: 20 },
    );
    await until(() => f.store.artifacts(f.user).length === 1);
    const response = await f.api('/api/jobs', 'POST', {
      client: 'work-http-123',
      kind: 'work-sample',
      scope: 'interview-record-a',
      label: '张三 · 笔试作品',
      input: {
        ...resumeInput,
        role: 'AI 产品经理（校招）',
        workSample: artifact,
        existingQuestions: reading.interviewQuestions,
      },
    });
    assert.equal(response.status, 202);
    const job = (await response.json()) as { id: string };
    await until(() => f.store.get(f.user, job.id).state === 'completed');
    assert.equal(localPath, '/local/works/candidate.zip');
    assert.deepEqual(f.store.get(f.user, job.id).report, result);
  } finally {
    controller.abort();
    await worker;
    await f.close();
  }
});
void test('pausing a running task aborts the connector and preserves resumable work', async () => {
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
    assert.equal(
      (
        await f.api('/api/jobs/' + job.id + '/action', 'POST', {
          action: 'pause',
        })
      ).status,
      200,
    );
    await until(() => aborted);
    assert.equal(f.store.get(f.user, job.id).state, 'paused');
    assert.equal(f.store.get(f.user, job.id).report, null);
    assert.notEqual(
      f.store.db.prepare('SELECT input FROM jobs WHERE id=?').get(job.id)
        ?.input,
      null,
    );
  } finally {
    controller.abort();
    await worker;
    await f.close();
  }
});
void test('task action API pauses, resumes and stops only the signed-in account task', async () => {
  const f = await fixture();
  try {
    const job = f.store.submit(f.user, 'actions-123', '面试', input);
    const pause = await f.api('/api/jobs/' + job.id + '/action', 'POST', {
      action: 'pause',
    });
    assert.equal(pause.status, 200);
    assert.equal(((await pause.json()) as { state: string }).state, 'paused');
    const resume = await f.api('/api/jobs/' + job.id + '/action', 'POST', {
      action: 'resume',
    });
    assert.equal(resume.status, 200);
    assert.equal(((await resume.json()) as { state: string }).state, 'queued');

    const other = f.store.createUser('other-user', 'other-password-123').id;
    const forbidden = await fetch(
      f.origin + '/api/jobs/' + job.id + '/action',
      {
        method: 'POST',
        headers: {
          Origin: f.origin,
          Cookie: 'interview_session=' + f.store.newSession(other),
          'X-Interview-Account': other,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'stop' }),
      },
    );
    assert.equal(forbidden.status, 404);
    assert.equal(f.store.get(f.user, job.id).state, 'queued');

    const stop = await f.api('/api/jobs/' + job.id + '/action', 'POST', {
      action: 'stop',
    });
    assert.equal(stop.status, 200);
    assert.equal(((await stop.json()) as { state: string }).state, 'cancelled');
    const invalid = await f.api('/api/jobs/' + job.id + '/action', 'POST', {
      action: 'restart',
    });
    assert.equal(invalid.status, 400);
  } finally {
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
          assert.deepEqual(value, { ...input, outlineVersion: 1 });
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

void test('resume task scope crosses the HTTP boundary without reusing another record', async () => {
  const f = await fixture();
  try {
    const device = f.store.redeem(f.store.pairing(f.user).code, '阅读电脑');
    const submit = async (client: string, scope: string) => {
      const response = await f.api('/api/jobs', 'POST', {
        client,
        kind: 'resume',
        label: '相同简历',
        input: resumeInput,
        scope,
      });
      assert.equal(response.status, 202);
      return (await response.json()) as { id: string; state: string };
    };

    const first = await submit('scope-http-a-1', 'interview-record-a');
    const claimed = f.store.claim(device.token, true, ['resume'])!;
    f.store.finish(device.token, claimed.id, claimed.lease, reading);
    const sameRecord = await submit('scope-http-a-2', 'interview-record-a');
    const newRecord = await submit('scope-http-b-1', 'interview-record-b');

    assert.equal(sameRecord.id, first.id);
    assert.notEqual(newRecord.id, first.id);
    assert.equal(newRecord.state, 'queued');
  } finally {
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

void test('connector routes written-test work to the dedicated runner', async () => {
  const f = await fixture();
  const controller = new AbortController();
  let worker: Promise<void> | undefined;
  try {
    const device = f.store.redeem(f.store.pairing(f.user).code, '笔试复盘电脑');
    const response = await f.api('/api/jobs', 'POST', {
      client: 'written-test-http-123',
      kind: 'written-test',
      label: '张三 · 笔试复盘补充',
      input: writtenTestInput,
    });
    assert.equal(response.status, 202);
    const job = (await response.json()) as { id: string };
    worker = runConnector(
      { server: f.origin, ...device },
      controller.signal,
      {
        status,
        analyze: async () => {
          throw new Error('wrong runner');
        },
        readResume: async () => {
          throw new Error('wrong runner');
        },
        writeTest: async (actual) => {
          assert.deepEqual(actual, writtenTestInput);
          return writtenTestResult;
        },
      },
      { pollMs: 10, heartbeatMs: 20 },
    );
    await until(() => f.store.get(f.user, job.id).state === 'completed');
    assert.deepEqual(f.store.get(f.user, job.id).report, writtenTestResult);
  } finally {
    controller.abort();
    await worker;
    await f.close();
  }
});

const authRequest = (
  origin: string,
  path: string,
  body: unknown,
  realIP?: string | string[],
) =>
  new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(
      origin + path,
      {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          ...(realIP === undefined ? {} : { 'X-Real-IP': realIP }),
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });

for (const endpoint of ['login', 'pair'] as const) {
  void test(`trusted loopback proxy isolates ${endpoint} rate limits by validated client IP`, async () => {
    const f = await fixture(true);
    const path = endpoint === 'login' ? '/api/login' : '/api/pair/redeem';
    const invalid =
      endpoint === 'login'
        ? { username: 'tester', password: 'wrong-password' }
        : { code: 'invalid-code', name: '电脑' };
    const valid = () =>
      endpoint === 'login'
        ? { username: 'tester', password: 'test-password-123' }
        : { code: f.store.pairing(f.user).code, name: '电脑' };
    try {
      for (let attempt = 0; attempt < 12; attempt++) {
        assert.equal(
          await authRequest(f.origin, path, invalid, '198.51.100.1'),
          endpoint === 'login' ? 401 : 403,
        );
      }
      assert.equal(
        await authRequest(f.origin, path, valid(), '198.51.100.1'),
        429,
      );
      assert.equal(
        await authRequest(f.origin, path, valid(), '198.51.100.2'),
        200,
      );
      assert.equal(
        await authRequest(f.origin, path, valid(), '2001:db8::1'),
        200,
      );
    } finally {
      await f.close();
    }
  });
}

for (const trustProxy of [undefined, false]) {
  void test(`direct HTTP ignores spoofed X-Real-IP when trustProxy is ${String(trustProxy)}`, async () => {
    const f = await fixture(trustProxy);
    try {
      for (let attempt = 0; attempt < 12; attempt++) {
        assert.equal(
          await authRequest(
            f.origin,
            '/api/login',
            { username: 'tester', password: 'wrong-password' },
            `198.51.100.${attempt + 1}`,
          ),
          401,
        );
      }
      assert.equal(
        await authRequest(
          f.origin,
          '/api/login',
          { username: 'tester', password: 'test-password-123' },
          '2001:db8::2',
        ),
        429,
      );
    } finally {
      await f.close();
    }
  });
}

void test('trusted proxy falls back to socket for missing, invalid and multiple X-Real-IP values', async () => {
  const f = await fixture(true);
  const values: (string | string[] | undefined)[] = [
    undefined,
    'not-an-ip',
    '198.51.100.1, 198.51.100.2',
    ['198.51.100.3', '198.51.100.4'],
    '198.51.100.5:1234',
    '[2001:db8::1]',
  ];
  try {
    for (let attempt = 0; attempt < 12; attempt++) {
      assert.equal(
        await authRequest(
          f.origin,
          '/api/login',
          { username: 'tester', password: 'wrong-password' },
          values[attempt % values.length],
        ),
        401,
      );
    }
    const valid = { username: 'tester', password: 'test-password-123' };
    for (const value of values) {
      assert.equal(
        await authRequest(f.origin, '/api/login', valid, value),
        429,
      );
    }
    assert.equal(
      await authRequest(f.origin, '/api/login', valid, '198.51.100.9'),
      200,
    );
  } finally {
    await f.close();
  }
});
