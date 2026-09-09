import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitRemoteAnalysis } from '../lib/remote-analysis.ts';
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
    };
    assert.equal(body.kind, 'resume');
    assert.deepEqual(body.input, input);
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
      { fetcher, pollMs: 0 },
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
