import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAnalysis } from '../lib/services.ts';
import { assessmentInstructions } from '../lib/assessment.ts';
function request(body: unknown) {
  return new Request('https://example.test/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://example.test',
    },
    body: JSON.stringify(body),
  });
}
void test('unconfigured AI returns explicit unavailability and no invented report', async () => {
  const response = await handleAnalysis(request({}), {});
  assert.equal(response.status, 503);
  assert.equal(
    ((await response.json()) as { error: string }).error,
    '尚未配置 AI 分析服务',
  );
});
void test('assessment conclusion groups general qualities before role abilities and an overall judgment', () => {
  const general = assessmentInstructions.indexOf('通用素质能力：');
  const product = assessmentInstructions.indexOf('产品能力：');
  const operations = assessmentInstructions.indexOf('运营能力：');
  const overall = assessmentInstructions.indexOf('综合判断：');
  assert.ok(general >= 0);
  assert.ok(product > general);
  assert.ok(operations > general);
  assert.ok(overall > product);
  assert.ok(overall > operations);
  assert.match(
    assessmentInstructions,
    /自驱力与结果闭环、学习力、挑战力与韧性、团队精神与沟通协作/,
  );
});
import { handleTranscription, serviceStatus } from '../lib/services.ts';
const env = {
  ANALYSIS_BASE_URL: 'https://provider.example/v1',
  ANALYSIS_API_KEY: 'test-only',
  ANALYSIS_MODEL: 'model',
  ASR_BASE_URL: 'https://asr.example/v1',
  ASR_API_KEY: 'test-only',
  ASR_MODEL: 'speech',
};
const input = {
  role: '产品经理',
  requirements: '推进项目',
  transcript: '候选人：我每周访谈五位用户。',
  dimensions: ['专业能力'],
};
void test('cross-origin requests never invoke paid services', async () => {
  const r = new Request('https://example.test/api/analyze', {
    method: 'POST',
    headers: { Origin: 'https://attacker.example' },
    body: '{}',
  });
  assert.equal(
    (
      await handleAnalysis(r, env, async () => {
        throw new Error('must not call');
      })
    ).status,
    403,
  );
});
void test('service status never leaks credentials and requires HTTPS', () => {
  assert.deepEqual(serviceStatus(env), { analysis: true, transcription: true });
  assert.equal(
    serviceStatus({ ...env, ANALYSIS_BASE_URL: 'http://provider.example' })
      .analysis,
    false,
  );
});
void test('valid provider output is grounded against the submitted transcript', async () => {
  const report = {
    summary: '有用户调研实践',
    dimensions: [
      {
        name: '专业能力',
        score: 3,
        assessment: '需核实调研结果',
        evidence: ['我每周访谈五位用户。'],
      },
    ],
    followUps: [],
  };
  const result = {
    report,
    interviewerReview: {
      status: 'unavailable',
      reason: 'speaker-labels-missing',
      summary: null,
      dimensions: [],
      strengths: [],
      priorities: [],
      rewrites: [],
      missedFollowUps: [],
    },
  };
  let called = false;
  const r = await handleAnalysis(request(input), env, async (url, options) => {
    called = true;
    assert.equal(url, 'https://provider.example/v1/chat/completions');
    const payload = JSON.parse(options?.body as string);
    assert.equal(
      JSON.parse(payload.messages[1].content).speakerLabelsAvailable,
      false,
    );
    return Response.json({
      choices: [{ message: { content: JSON.stringify(result) } }],
    });
  });
  assert.equal(called, true);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), result);
});
void test('raw provider failures and keys are not returned to the browser', async () => {
  const r = await handleAnalysis(
    request(input),
    env,
    async () => new Response('secret provider debug', { status: 401 }),
  );
  assert.equal(r.status, 502);
  assert.equal((await r.text()).includes('secret'), false);
});
void test('oversized requests and fabricated output are rejected', async () => {
  const r = await handleAnalysis(
    request({ ...input, transcript: 'x'.repeat(560000) }),
    env,
  );
  assert.equal(r.status, 413);
  const invalid = await handleAnalysis(request(input), env, async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: 'x',
              dimensions: [
                {
                  name: '专业能力',
                  score: 5,
                  assessment: 'x',
                  evidence: ['不存在的原文'],
                },
              ],
              followUps: [],
            }),
          },
        },
      ],
    }),
  );
  assert.equal(invalid.status, 502);
});
void test('audio is submitted as multipart and transcription is returned honestly', async () => {
  const form = new FormData();
  form.set(
    'file',
    new File(['recorded bytes'], 'interview.webm', { type: 'audio/webm' }),
  );
  const req = new Request('https://example.test/api/transcribe', {
    method: 'POST',
    headers: { Origin: 'https://example.test' },
    body: form,
  });
  const r = await handleTranscription(req, env, async (url, options) => {
    assert.equal(url, 'https://asr.example/v1/audio/transcriptions');
    assert.equal((options!.body as FormData).get('model'), 'speech');
    return Response.json({ text: '候选人：你好。' });
  });
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { text: string }).text, '候选人：你好。');
});
