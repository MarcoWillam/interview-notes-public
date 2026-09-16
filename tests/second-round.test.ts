import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePriorRoundDocument,
  validateSecondRoundAssessmentResult,
  validateSecondRoundOutlineInput,
  validateSecondRoundOutlineResult,
} from '../lib/second-round.ts';
import {
  recoverSecondRoundTaskResult,
  secondRoundTaskSourceHash,
} from '../lib/second-round-task.ts';

const priorRoundText = `# 面试评估记录

候选人：林小满
岗位：AI 产品经理（校招）
状态：面试官已确认

## 岗位要求
理解用户问题并能借助 AI 推进方案。

## 候选人简历（自述背景，待面试核实）
林小满在校园项目中组织五位同学访谈，并主动完成两轮原型验证。

## 待核实事项
- 尚未说明为什么放弃第一个方案。

## 面试官结论
建议复试核实范围取舍和失败复盘。

## 对话记录（人工校对文本）
面试官：请介绍这次校园项目。
候选人：我组织了五位同学访谈。`;

const externalText = `初试记录
候选人参与过校园项目。
建议复试核实其方案取舍和失败复盘。`;

const baseInput = {
  candidate: '林小满',
  role: 'AI 产品经理（校招）',
  requirements: '理解用户问题并能借助 AI 推进方案。',
  dimensionText:
    '用户洞察与问题定义、产品方案与范围取舍、AI 理解与产品化判断、数据验证与迭代意识、自驱力与结果闭环、学习力、挑战力与韧性、团队精神与沟通协作',
  focus: '重点核实初试证据不足项。',
  scoringGuidance: '',
  reportRequirements: '',
  priorRoundSource: 'bole-markdown' as const,
  priorRoundText,
  priorRoundName: '林小满-面试记录.md',
  resumeText: '林小满在校园项目中组织五位同学访谈，并主动完成两轮原型验证。',
};

void test('second-round task source hashes are stable and input-sensitive', async () => {
  const first = await secondRoundTaskSourceHash(
    'second-round-outline',
    baseInput,
  );
  const second = await secondRoundTaskSourceHash('second-round-outline', {
    ...baseInput,
  });
  const changed = await secondRoundTaskSourceHash('second-round-outline', {
    ...baseInput,
    focus: '重点核实候选人的学习迁移能力。',
  });

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(second, first);
  assert.notEqual(changed, first);
});

void test('recognizes Bole exports and extracts the embedded resume', () => {
  const parsed = parsePriorRoundDocument(priorRoundText, '林小满-面试记录.md');
  assert.equal(parsed.source, 'bole-markdown');
  assert.equal(parsed.candidate, '林小满');
  assert.equal(parsed.role, 'AI 产品经理（校招）');
  assert.equal(
    parsed.embeddedResumeText,
    '林小满在校园项目中组织五位同学访谈，并主动完成两轮原型验证。',
  );
});

void test('treats free-form notes as external and requires a separate resume', () => {
  const parsed = parsePriorRoundDocument(externalText, '初试记录.txt');
  assert.equal(parsed.source, 'external');
  assert.equal(parsed.embeddedResumeText, '');
  assert.throws(
    () =>
      validateSecondRoundOutlineInput({
        ...baseInput,
        priorRoundSource: 'external',
        priorRoundText: externalText,
        priorRoundName: '初试记录.txt',
        resumeText: '',
      }),
    /外部初试资料必须上传并解析候选人简历/,
  );
  assert.equal(
    validateSecondRoundOutlineInput({
      ...baseInput,
      priorRoundSource: 'external',
      priorRoundText: externalText,
      priorRoundName: '初试记录.txt',
    }).priorRoundSource,
    'external',
  );
});

const digest = {
  initialQuestions: ['请介绍这次校园项目。'],
  verified: ['候选人组织了五位同学访谈。'],
  gaps: ['尚未说明为什么放弃第一个方案。'],
  risks: ['范围取舍缺少事实依据。'],
  conflicts: [],
};

function question(index: number, overrides = {}) {
  return {
    id: `required-${index + 1}`,
    question: `当时你为何选择第${index + 1}种验证方式？`,
    dimensions: ['产品方案与范围取舍'],
    goal: '核实候选人的独立判断和取舍依据。',
    priorEvidence: '尚未说明为什么放弃第一个方案。',
    resumeEvidence: '主动完成两轮原型验证',
    relatedInitialQuestion: '请介绍这次校园项目。',
    difference: '初试了解项目概况，复试核实选择依据。',
    listenFor: ['是否说明本人判断', '是否说明替代方案'],
    riskSignals: ['只描述团队决定'],
    probes: ['如果重来一次，你会调整什么？'],
    ...overrides,
  };
}

void test('validates a six-plus-three second-round outline with grounded evidence', () => {
  const input = validateSecondRoundOutlineInput(baseInput);
  const result = validateSecondRoundOutlineResult(
    {
      digest,
      outline: {
        version: 1,
        recommendedMinutes: { min: 45, max: 60 },
        summary: '围绕初试缺口继续核实判断、取舍和迁移能力。',
        requiredQuestions: Array.from({ length: 6 }, (_, index) =>
          question(index),
        ),
        reserveQuestions: [
          question(6, {
            id: 'reserve-1',
            question: '如果用户反对，你会怎样调整方案？',
          }),
        ],
      },
    },
    input,
  );
  assert.equal(result.outline.requiredQuestions.length, 6);
  assert.equal(result.outline.reserveQuestions.length, 1);
  assert.deepEqual(result.outline.recommendedMinutes, { min: 45, max: 60 });
});

void test('standalone second-round results apply only to the unchanged source snapshot', async () => {
  const input = validateSecondRoundOutlineInput(baseInput);
  const report = {
    digest,
    outline: {
      version: 1,
      recommendedMinutes: { min: 45, max: 60 },
      summary: '围绕初试缺口继续核实判断、取舍和迁移能力。',
      requiredQuestions: Array.from({ length: 6 }, (_, index) =>
        question(index),
      ),
      reserveQuestions: [],
    },
  };
  const sourceHash = await secondRoundTaskSourceHash(
    'second-round-outline',
    input,
  );
  const ready = await recoverSecondRoundTaskResult(
    'second-round-outline',
    input,
    sourceHash,
    report,
  );
  assert.equal(ready.status, 'ready');
  if (ready.status === 'ready')
    assert.equal(ready.result.outline.requiredQuestions.length, 6);

  const stale = await recoverSecondRoundTaskResult(
    'second-round-outline',
    { ...input, focus: '已经改变的关注重点' },
    sourceHash,
    report,
  );
  assert.deepEqual(stale, { status: 'stale' });
});

void test('rejects repeated first-round questions and invented evidence', () => {
  const input = validateSecondRoundOutlineInput(baseInput);
  const valid = {
    digest,
    outline: {
      version: 1,
      recommendedMinutes: { min: 45, max: 60 },
      summary: '围绕初试缺口继续核实判断、取舍和迁移能力。',
      requiredQuestions: Array.from({ length: 6 }, (_, index) =>
        question(index),
      ),
      reserveQuestions: [],
    },
  };
  assert.throws(
    () =>
      validateSecondRoundOutlineResult(
        {
          ...valid,
          outline: {
            ...valid.outline,
            requiredQuestions: [
              question(0, { question: '请介绍这次校园项目。' }),
              ...valid.outline.requiredQuestions.slice(1),
            ],
          },
        },
        input,
      ),
    /不能重复初试问题/,
  );
  assert.throws(
    () =>
      validateSecondRoundOutlineResult(
        {
          ...valid,
          outline: {
            ...valid.outline,
            requiredQuestions: [
              question(0, { priorEvidence: '初试资料中不存在的依据。' }),
              ...valid.outline.requiredQuestions.slice(1),
            ],
          },
        },
        input,
      ),
    /初试依据无法在初试资料中找到/,
  );
});

void test('second-round comparison evidence can only quote the current transcript', () => {
  const transcript = '候选人：我重新访谈了三位用户，并主动否定了原方案。';
  const input = {
    role: baseInput.role,
    requirements: baseInput.requirements,
    transcript,
    dimensions: baseInput.dimensionText.split('、'),
    resumeText: baseInput.resumeText,
    focus: baseInput.focus,
    scoringGuidance: '',
    reportRequirements: '',
    priorRoundText,
  };
  const dimensions = input.dimensions.map((name) => ({
    name,
    score: null,
    assessment: '本轮证据不足。',
    evidence: [],
  }));
  const valid = validateSecondRoundAssessmentResult(
    {
      summary: '本轮补充了方案调整过程，其他维度仍需核实。',
      dimensions,
      followUps: [],
      workSampleReview: [],
      priorRoundComparison: [
        {
          statement: '候选人能够主动调整方案。',
          status: 'supplemented',
          transcriptEvidence: ['我重新访谈了三位用户，并主动否定了原方案。'],
        },
      ],
    },
    input,
  );
  assert.equal(valid.priorRoundComparison[0].status, 'supplemented');
  assert.throws(
    () =>
      validateSecondRoundAssessmentResult(
        {
          ...valid,
          priorRoundComparison: [
            {
              statement: '候选人组织了访谈。',
              status: 'verified',
              transcriptEvidence: ['我组织了五位同学访谈。'],
            },
          ],
        },
        input,
      ),
    /复试对照引用无法在本轮对话中找到/,
  );
});
