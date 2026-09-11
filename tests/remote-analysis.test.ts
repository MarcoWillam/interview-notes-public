import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  controlRemoteJob,
  listRemoteArtifacts,
  submitRemoteAnalysis,
  submitRemoteWorkSample,
  submitRemoteWrittenTest,
  type RemoteJob,
} from '../lib/remote-analysis.ts';
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

void test('resume reading is scoped to the current local interview record', async () => {
  const page = await readFile(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  assert.match(page, /submitRemoteResume\([\s\S]*scope: library\.id/);
});
const writtenTestInput = {
  role: resumeInput.role,
  requirements: resumeInput.requirements,
  dimensionText: resumeInput.dimensionText,
  focus: resumeInput.focus,
  scoringGuidance: resumeInput.scoringGuidance,
  reportRequirements: resumeInput.reportRequirements,
  resumeText: resumeInput.resumeText,
  existingQuestions: reading.interviewQuestions.map((question) => ({
    ...question,
    questionSource: question.questionSource as 'resume' | 'role',
  })),
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
const artifact = {
  id: 'artifact-12345678',
  deviceId: 'device-12345678',
  name: 'candidate.zip',
  sha256: 'c'.repeat(64),
  bytes: 1024,
  modifiedAt: 123,
};
const workSampleInput = {
  ...resumeInput,
  role: 'AI 产品经理（校招）',
  workSample: artifact,
  existingQuestions: reading.interviewQuestions.map((question) => ({
    ...question,
    questionSource: question.questionSource as 'resume' | 'role',
  })),
};
const workSampleResult = {
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
  summary: '作品内容待面试核实。',
  dimensions: aiPmWorkSampleRubric.map(({ name }) => ({
    name,
    score: 4,
    assessment: '按统一笔试目的形成作品判断。',
    evidence: [{ path: 'brief.md', excerpt: '目标用户是新手卖家' }],
  })),
  strengths: ['问题明确'],
  risks: ['验证待核实'],
  questions: Array.from({ length: 3 }, (_, index) => ({
    question: `请说明作品中的第 ${index + 1} 个判断。`,
    questionSource: 'work-sample' as const,
    dimensions: [index === 1 ? '沟通协作' : '需求分析'],
    reason: '核实判断过程。',
    resumeEvidence: null,
    workSampleEvidence: { path: 'brief.md', excerpt: '目标用户是新手卖家' },
    listenFor: ['判断依据'],
    probes: ['如何验证？'],
  })),
};
const input = {
  role: '工程师',
  requirements: '沟通',
  transcript: '候选人：我每天同步进展。',
  dimensions: ['沟通'],
};
const report = {
  summary: '待核实',
  dimensions: [
    {
      name: '沟通',
      score: 3,
      assessment: '有同步意识',
      evidence: ['我每天同步进展。'],
    },
  ],
  followUps: [],
};
void test('remote submission waits for queued and running jobs, then validates the report', async () => {
  const calls: string[] = [];
  const states: string[] = [];
  let count = 0;
  const fetcher: typeof fetch = async (url, options) => {
    calls.push(url instanceof Request ? url.url : String(url));
    if (options?.method === 'POST')
      return Response.json({ id: 'job', state: 'queued' }, { status: 202 });
    return Response.json(
      ++count === 1
        ? { id: 'job', state: 'running' }
        : { id: 'job', state: 'completed', report },
    );
  };
  const result = await submitRemoteAnalysis(
    input,
    '样本',
    new AbortController().signal,
    (job) => states.push(job.state),
    { fetcher, pollMs: 0 },
  );
  assert.deepEqual(result, report);
  assert.deepEqual(states, ['queued', 'running', 'completed']);
  assert.equal(calls.length, 3);
});
void test('closing a page stops polling without cancelling a server job', async () => {
  const controller = new AbortController();
  const methods: string[] = [];
  const fetcher: typeof fetch = async (_url, options) => {
    methods.push(options?.method || 'GET');
    return Response.json({ id: 'job', state: 'queued' });
  };
  await assert.rejects(
    submitRemoteAnalysis(
      input,
      '样本',
      controller.signal,
      () => controller.abort(),
      { fetcher, pollMs: 0 },
    ),
    { name: 'AbortError' },
  );
  assert.deepEqual(methods, ['POST']);
});
void test('a failed job does not become a report', async () => {
  const fetcher: typeof fetch = async () =>
    Response.json({
      id: 'job',
      state: 'failed',
      error: '连接器离线，请重新提交。',
    });
  await assert.rejects(
    submitRemoteAnalysis(
      input,
      '样本',
      new AbortController().signal,
      () => {},
      { fetcher, pollMs: 0 },
    ),
    /连接器离线/,
  );
});
void test('an ambiguous submission retry reuses the first client key instead of creating duplicate paid work', async () => {
  const ids = new Set<string>();
  let calls = 0;
  const fetcher: typeof fetch = async (_url, options) => {
    assert.equal(typeof options?.body, 'string');
    const body = JSON.parse(options?.body as string) as { client: string };
    ids.add(body.client);
    if (++calls === 1) throw new DOMException('response lost', 'TimeoutError');
    return Response.json({ id: 'job', state: 'completed', report });
  };
  await assert.rejects(
    submitRemoteAnalysis(
      input,
      'lost response',
      new AbortController().signal,
      () => {},
      { fetcher, pollMs: 0 },
    ),
  );
  assert.deepEqual(
    await submitRemoteAnalysis(
      input,
      'lost response',
      new AbortController().signal,
      () => {},
      { fetcher, pollMs: 0 },
    ),
    report,
  );
  assert.equal(ids.size, 1);
});
void test('resume task is sent with its own kind and returns an unscored reading', async () => {
  const { submitRemoteResume } = await import('../lib/remote-analysis.ts');
  const input = { ...resumeInput };
  const report = structuredClone(reading);
  const fetcher: typeof fetch = async (_url, options) => {
    const body = JSON.parse(options?.body as string) as {
      kind: string;
      input: unknown;
      scope?: string;
    };
    assert.equal(body.kind, 'resume');
    assert.deepEqual(body.input, input);
    assert.equal(body.scope, 'interview-record-a');
    return Response.json({
      id: 'reading',
      kind: 'resume',
      state: 'completed',
      report,
    });
  };
  assert.deepEqual(
    await submitRemoteResume(
      input,
      'Resume',
      new AbortController().signal,
      () => {},
      { fetcher, pollMs: 0, scope: 'interview-record-a' },
    ),
    report,
  );
});

void test('resume result validation uses the normalized submission snapshot', async () => {
  const { submitRemoteResume } = await import('../lib/remote-analysis.ts');
  const input = { ...resumeInput, resumeText: `  ${resumeInput.resumeText}  ` };
  const fetcher: typeof fetch = async (_url, options) => {
    const body = JSON.parse(options?.body as string) as { input: unknown };
    assert.deepEqual(body.input, resumeInput);
    input.resumeText = '调用者已经替换了简历';
    input.dimensionText = '其他维度';
    return Response.json({
      id: 'snapshot',
      state: 'completed',
      report: reading,
    });
  };
  assert.deepEqual(
    await submitRemoteResume(
      input,
      '快照',
      new AbortController().signal,
      () => {},
      { fetcher, pollMs: 0 },
    ),
    reading,
  );
});

void test('written-test supplement uses its own kind and validates the completed result', async () => {
  const fetcher: typeof fetch = async (_url, options) => {
    const body = JSON.parse(options?.body as string) as {
      kind: string;
      input: unknown;
      scope?: string;
    };
    assert.equal(body.kind, 'written-test');
    assert.deepEqual(body.input, writtenTestInput);
    assert.equal(body.scope, 'interview-record-123');
    return Response.json({
      id: 'written-test-job',
      kind: 'written-test',
      state: 'completed',
      report: writtenTestResult,
    });
  };
  assert.deepEqual(
    await submitRemoteWrittenTest(
      writtenTestInput,
      '张三 · 笔试复盘补充',
      new AbortController().signal,
      () => {},
      { fetcher, pollMs: 0, scope: 'interview-record-123' },
    ),
    writtenTestResult,
  );
});

void test('artifact listing accepts only public metadata', async () => {
  const result = await listRemoteArtifacts(async (url) => {
    assert.equal(
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      '/api/artifacts',
    );
    return Response.json({
      artifacts: [
        { ...artifact, deviceName: '作品电脑', available: true, syncedAt: 456 },
      ],
    });
  });
  assert.deepEqual(result, [
    { ...artifact, deviceName: '作品电脑', available: true, syncedAt: 456 },
  ]);
  await assert.rejects(
    listRemoteArtifacts(async () =>
      Response.json({
        artifacts: [
          {
            ...artifact,
            deviceName: '电脑',
            available: true,
            syncedAt: 456,
            path: '/private/work.zip',
          },
        ],
      }),
    ),
    /清单格式无效/,
  );
});

void test('later work sample submission carries its hash and validates three questions', async () => {
  const fetcher: typeof fetch = async (_url, options) => {
    const body = JSON.parse(options?.body as string) as {
      kind: string;
      scope: string;
      input: typeof workSampleInput;
    };
    assert.equal(body.kind, 'work-sample');
    assert.equal(body.scope, 'interview-record-a');
    assert.equal(body.input.workSample.sha256, artifact.sha256);
    return Response.json({
      id: 'work-sample-job',
      kind: 'work-sample',
      state: 'completed',
      report: workSampleResult,
    });
  };
  assert.deepEqual(
    await submitRemoteWorkSample(
      workSampleInput,
      '张三 · 笔试作品',
      new AbortController().signal,
      () => {},
      { fetcher, pollMs: 0, scope: 'interview-record-a' },
    ),
    workSampleResult,
  );
});

void test('task controls post a typed action and preserve queue timing', async () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const returned: RemoteJob = {
    id: 'job-1',
    label: '张三',
    kind: 'resume',
    state: 'paused',
    created: 1,
    updated: 4,
    queuedAt: 2,
    startedAt: 3,
    position: null,
  };
  const fetcher: typeof fetch = async (url, options) => {
    calls.push({
      url:
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      method: options?.method || 'GET',
      body: JSON.parse(typeof options?.body === 'string' ? options.body : '{}'),
    });
    return Response.json(returned);
  };
  const result = await controlRemoteJob('job-1', 'pause', fetcher);
  assert.deepEqual(result, returned);
  assert.deepEqual(calls, [
    {
      url: '/api/jobs/job-1/action',
      method: 'POST',
      body: { action: 'pause' },
    },
  ]);
});
