import assert from 'node:assert/strict';
import test from 'node:test';
import {
  spokenSecondRoundQuestion,
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

const depthAngles = [
  'decision',
  'tradeoff',
  'failure',
  'counterfactual',
  'transfer',
  'collaboration',
] as const;

function v2Question(index: number, overrides = {}) {
  return {
    ...question(index),
    contextSummary: '初试说明了项目过程，但个人判断依据仍不清楚。',
    contextType: 'initial-interview',
    depthAngle: depthAngles[index % depthAngles.length],
    resumeContext: { type: 'project', label: '校园项目' },
    ...overrides,
  };
}

void test('spoken follow-up questions name a grounded project once', () => {
  const item = v2Question(0, {
    question: '监测看板上线后，你如何证明它产生了价值？',
    resumeContext: { type: 'project', label: '医疗客服 AI 模型优化项目' },
  });
  assert.equal(
    spokenSecondRoundQuestion({ question: item.question, resumeContext: { type: 'project', label: '医疗客服 AI 模型优化项目' } }),
    '在医疗客服 AI 模型优化项目中，监测看板上线后，你如何证明它产生了价值？',
  );
  assert.equal(
    spokenSecondRoundQuestion({ question: '在医疗客服 AI 模型优化项目中，你如何验证价值？', resumeContext: { type: 'project', label: '医疗客服 AI 模型优化项目' } }),
    '在医疗客服 AI 模型优化项目中，你如何验证价值？',
  );
  assert.equal(
    spokenSecondRoundQuestion({ question: item.question, resumeContext: { type: 'unspecified', label: '简历中未明确具体项目' } }),
    item.question,
  );
  assert.equal(
    spokenSecondRoundQuestion({ question: item.question, resumeContext: { type: 'internship', label: '海外独立站--产品运营实习生' } }),
    '在“海外独立站--产品运营实习生”这段实习中，监测看板上线后，你如何证明它产生了价值？',
  );
});

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

void test('validates a V2 outline with concise context and varied depth angles', () => {
  const result = validateSecondRoundOutlineResult(
    {
      digest,
      outline: {
        version: 2,
        recommendedMinutes: { min: 45, max: 60 },
        summary: '重点判断候选人的决策、取舍、复盘与迁移潜力。',
        requiredQuestions: Array.from({ length: 6 }, (_, index) =>
          v2Question(index),
        ),
        reserveQuestions: [
          v2Question(6, {
            id: 'reserve-1',
            question: '如果用户反对，你会怎样调整方案？',
            resumeEvidence: null,
            resumeContext: null,
            contextType: 'role',
            depthAngle: 'evidence',
          }),
        ],
      },
    },
    baseInput,
  );
  assert.equal(result.outline.version, 2);
  assert.equal(result.outline.requiredQuestions.length, 6);
  assert.equal(
    result.outline.requiredQuestions[0].question,
    '在校园项目中，当时你为何选择第1种验证方式？',
  );
  assert.deepEqual(validateSecondRoundOutlineResult(result, baseInput), result);
});

void test('V2 limits written-test questions and requires four depth angles', () => {
  const outline = {
    version: 2,
    recommendedMinutes: { min: 45, max: 60 },
    summary: '重点判断候选人的决策、取舍、复盘与迁移潜力。',
    requiredQuestions: Array.from({ length: 6 }, (_, index) =>
      v2Question(index),
    ),
    reserveQuestions: [],
  };
  assert.throws(
    () =>
      validateSecondRoundOutlineResult(
        {
          digest,
          outline: {
            ...outline,
            requiredQuestions: outline.requiredQuestions.map((item, index) =>
              index < 2 ? { ...item, contextType: 'written-test' } : item,
            ),
          },
        },
        baseInput,
      ),
    /笔试题相关问题最多 1 道/,
  );
  assert.throws(
    () =>
      validateSecondRoundOutlineResult(
        {
          digest,
          outline: {
            ...outline,
            requiredQuestions: outline.requiredQuestions.map((item) => ({
              ...item,
              depthAngle: 'decision',
            })),
          },
        },
        baseInput,
      ),
    /至少覆盖 4 种深挖角度/,
  );
});

void test('V2 keeps context and validation goals concise', () => {
  const outline = {
    version: 2,
    recommendedMinutes: { min: 45, max: 60 },
    summary: '重点判断候选人的决策、取舍、复盘与迁移潜力。',
    requiredQuestions: Array.from({ length: 6 }, (_, index) =>
      v2Question(index),
    ),
    reserveQuestions: [],
  };
  assert.throws(
    () =>
      validateSecondRoundOutlineResult(
        {
          digest,
          outline: {
            ...outline,
            requiredQuestions: [
              v2Question(0, { goal: '判断能力。' }),
              ...outline.requiredQuestions.slice(1),
            ],
          },
        },
        baseInput,
      ),
    /复试问题目的须为 12–40 字/,
  );
  assert.throws(
    () =>
      validateSecondRoundOutlineResult(
        {
          digest,
          outline: {
            ...outline,
            requiredQuestions: [
              v2Question(0, { contextSummary: '背景太短。' }),
              ...outline.requiredQuestions.slice(1),
            ],
          },
        },
        baseInput,
      ),
    /提问背景须为 12–60 字/,
  );
});

void test('V2 resume evidence requires a grounded source label', () => {
  const validQuestions = Array.from({ length: 6 }, (_, index) =>
    v2Question(index),
  );
  const validateFirst = (overrides: Record<string, unknown>) =>
    validateSecondRoundOutlineResult(
      {
        digest,
        outline: {
          version: 2,
          recommendedMinutes: { min: 45, max: 60 },
          summary: '重点判断候选人的决策、取舍、复盘与迁移潜力。',
          requiredQuestions: [
            v2Question(0, overrides),
            ...validQuestions.slice(1),
          ],
          reserveQuestions: [],
        },
      },
      baseInput,
    );
  assert.throws(
    () => validateFirst({ resumeContext: null }),
    /简历依据必须标注来源/,
  );
  assert.throws(
    () =>
      validateFirst({
        resumeContext: { type: 'project', label: '不存在的项目' },
      }),
    /简历来源无法在候选人简历中找到/,
  );
  assert.throws(
    () =>
      validateFirst({
        resumeContext: { type: 'unspecified', label: '项目归属不清楚' },
      }),
    /简历中未明确具体项目/,
  );
  assert.throws(
    () => validateFirst({ resumeEvidence: null }),
    /未引用简历时不能标注简历来源/,
  );
  assert.equal(
    validateFirst({
      resumeContext: {
        type: 'unspecified',
        label: '简历中未明确具体项目',
      },
    }).outline.version,
    2,
  );
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
      report: {
        summary: '本轮补充了方案调整过程，其他维度仍需核实。',
        dimensions,
        followUps: [],
        workSampleReview: [],
      },
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
