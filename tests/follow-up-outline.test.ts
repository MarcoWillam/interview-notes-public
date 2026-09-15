import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyFollowUpOutlineResult,
  validateFollowUpOutlineInput,
  validateFollowUpOutlineResult,
} from '../lib/follow-up-outline.ts';
import {
  followUpInputFixture,
  followUpResultFixture,
} from './fixtures/follow-up-outline.ts';
import { builtInRoleTemplates } from '../lib/default-role-templates.ts';
import { calculateOutlineCoverage } from '../lib/interview-outline-v2.ts';
import { calculateOutlineCoverageV3 } from '../lib/interview-outline-v3.ts';

void test('补充追问规范化关注点并固定返回两题', () => {
  const input = validateFollowUpOutlineInput({
    ...followUpInputFixture(),
    requestedFocus: '  自驱力与主动发现问题  ',
  });
  assert.equal(input.requestedFocus, '自驱力与主动发现问题');
  const result = validateFollowUpOutlineResult(
    { ...followUpResultFixture(), requestedFocus: input.requestedFocus },
    input,
  );
  assert.equal(result.questions.length, 2);
});

void test('补充追问拒绝过短关注点、长问题、重复题和伪造简历依据', () => {
  assert.throws(() =>
    validateFollowUpOutlineInput({
      ...followUpInputFixture(),
      requestedFocus: '自',
    }),
  );
  assert.throws(() =>
    validateFollowUpOutlineResult(
      {
        ...followUpResultFixture(),
        questions: followUpResultFixture().questions.map((item) => ({
          ...item,
          question:
            '这是一道明显超过三十个字符限制并且不适合现场直接提问的冗长主问题吗',
        })),
      },
      followUpInputFixture(),
    ),
  );
  assert.throws(() =>
    validateFollowUpOutlineResult(
      {
        ...followUpResultFixture(),
        questions: [
          followUpResultFixture().questions[0],
          followUpResultFixture().questions[0],
        ],
      },
      followUpInputFixture(),
    ),
  );
  assert.throws(() =>
    validateFollowUpOutlineResult(
      {
        ...followUpResultFixture(),
        questions: followUpResultFixture().questions.map((item) => ({
          ...item,
          resumeEvidence: '简历里不存在的经历',
        })),
      },
      followUpInputFixture(),
    ),
  );
});

void test('补充追问输入深度校验简历阅读及其嵌套对象', () => {
  const fixture = followUpInputFixture();
  assert.throws(() =>
    validateFollowUpOutlineInput({ ...fixture, resumeReading: {} }),
  );
  assert.throws(() =>
    validateFollowUpOutlineInput({
      ...fixture,
      resumeReading: {
        ...fixture.resumeReading,
        interviewQuestions: fixture.resumeReading.interviewQuestions?.map(
          (question) => ({ ...question, unexpected: 'field' }),
        ),
      },
    }),
  );
  assert.throws(() =>
    validateFollowUpOutlineInput({
      ...fixture,
      resumeReading: {
        ...fixture.resumeReading,
        summary: 'x'.repeat(4001),
      },
    }),
  );
});

void test('补充追问结果必须逐字匹配已规范化的关注点', () => {
  const input = validateFollowUpOutlineInput(followUpInputFixture());
  assert.throws(() =>
    validateFollowUpOutlineResult(
      { ...followUpResultFixture(), requestedFocus: ' 自驱力 ' },
      input,
    ),
  );
});

void test('条件追问问题至少包含两个字符', () => {
  const input = validateFollowUpOutlineInput(followUpInputFixture());
  assert.throws(() =>
    validateFollowUpOutlineResult(
      {
        ...followUpResultFixture(),
        questions: followUpResultFixture().questions.map((question) => ({
          ...question,
          probes: [{ ...question.probes[0], question: '?' }],
        })),
      },
      input,
    ),
  );
});

void test('V2 和 V3 提纲的条件追问对象也拒绝未知字段', () => {
  const template = builtInRoleTemplates[0];
  const dimensions = template.dimensionText.split('、');
  const questions = dimensions.map((dimension, index) => ({
    id: `outline-question-${index + 1}`,
    question: `请说明第${index + 1}次判断的依据？`,
    required: index < 5,
    estimatedMinutes: 6,
    primaryDimension: dimension,
    secondaryDimensions: [],
    source: 'role' as const,
    goal: '核实具体行动。',
    resumeEvidence: null,
    workSampleEvidence: null,
    listenFor: ['具体行动'],
    riskSignals: ['只说结论'],
    probes: [{ condition: '回答笼统', question: '你先做了哪一步？' }],
  }));
  const { interviewQuestions: _ignored, ...reading } = followUpInputFixture().resumeReading;
  const input = {
    ...followUpInputFixture(),
    role: template.role,
    requirements: template.requirements,
    dimensionText: template.dimensionText,
    focus: template.focus,
    scoringGuidance: template.scoringGuidance,
    reportRequirements: template.reportRequirements,
    outlineVersion: 2 as const,
    resumeReading: {
      ...reading,
      outline: {
        version: 2 as const,
        estimatedMinutes: 30,
        requiredQuestions: questions.slice(0, 5),
        reserveQuestions: questions.slice(5),
        archivedReserveQuestions: [],
        coverage: calculateOutlineCoverage(questions, dimensions),
      },
    },
  };
  const outline = input.resumeReading.outline;
  outline.requiredQuestions[0].probes = [
    Object.assign({}, outline.requiredQuestions[0].probes[0], {
      unexpected: 'field',
    }),
  ];
  assert.throws(() => validateFollowUpOutlineInput(input));

  const v3Question = (
    id: string,
    sourceIndex: number,
    dimension: string,
    required: boolean,
    secondaryDimensions: string[] = [],
  ) => ({
    ...questions[sourceIndex],
    id,
    question: `你会如何推进第${id}项校园项目？`,
    required,
    estimatedMinutes: 5,
    primaryDimension: dimension,
    secondaryDimensions,
  });
  const v3RequiredQuestions = [
    v3Question('v3-required-1', 0, dimensions[4], true),
    v3Question('v3-required-2', 1, dimensions[5], true),
    v3Question('v3-required-3', 2, dimensions[6], true),
    v3Question('v3-required-4', 3, dimensions[7], true),
    v3Question('v3-required-5', 4, dimensions[0], true, [dimensions[1]]),
    v3Question('v3-required-6', 5, dimensions[2], true, [dimensions[3]]),
  ];
  const v3ReserveQuestions = [
    v3Question('v3-reserve-1', 6, dimensions[0], false),
    v3Question('v3-reserve-2', 7, dimensions[3], false),
  ];
  const v3Input = {
    ...input,
    outlineVersion: 3 as const,
    resumeReading: {
      ...reading,
      outline: {
        version: 3 as const,
        estimatedMinutes: 30,
        requiredQuestions: v3RequiredQuestions,
        reserveQuestions: v3ReserveQuestions,
        archivedReserveQuestions: [],
        coverage: calculateOutlineCoverageV3(
          [...v3RequiredQuestions, ...v3ReserveQuestions],
          dimensions,
        ),
      },
    },
  };
  v3Input.resumeReading.outline.requiredQuestions[0].probes = [
    Object.assign({}, v3Input.resumeReading.outline.requiredQuestions[0].probes[0], {
      unexpected: 'field',
    }),
  ];
  assert.throws(() => validateFollowUpOutlineInput(v3Input));
});

void test('V1 legacy workSampleQuestions 会被保留并参与重复题校验', () => {
  const legacyQuestion = {
    question: '请复盘作品中最关键的一次取舍？',
    questionSource: 'role' as const,
    dimensions: ['自驱力'],
    reason: '核实作品中的个人判断。',
    resumeEvidence: null,
    listenFor: ['个人判断'],
    probes: ['当时你先做了哪一步？'],
  };
  const input = validateFollowUpOutlineInput({
    ...followUpInputFixture(),
    resumeReading: {
      ...followUpInputFixture().resumeReading,
      workSampleQuestions: [legacyQuestion],
    },
  });
  assert.equal(input.resumeReading.workSampleQuestions?.length, 1);
  assert.throws(() =>
    validateFollowUpOutlineResult(
      {
        ...followUpResultFixture(),
        questions: [
          { ...followUpResultFixture().questions[0], question: legacyQuestion.question },
          followUpResultFixture().questions[1],
        ],
      },
      input,
    ),
  );
});

void test('应用结果按 jobId 去重且不改写原提纲', () => {
  const first = applyFollowUpOutlineResult([], followUpResultFixture(), {
    id: 'group-12345678',
    jobId: 'job-12345678',
    createdAt: 1,
  });
  const repeated = applyFollowUpOutlineResult(
    first,
    followUpResultFixture(),
    {
      id: 'group-other123',
      jobId: 'job-12345678',
      createdAt: 2,
    },
  );
  assert.equal(repeated.length, 1);
});
