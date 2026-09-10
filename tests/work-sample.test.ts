import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateWorkSampleAssessment,
  validateWorkSampleEvidenceFiles,
  validateWorkSampleReference,
  type WorkSampleAssessment,
} from '../lib/work-sample.ts';
import {
  AI_PM_WORK_SAMPLE_RUBRIC_VERSION,
  aiPmWorkSampleRubric,
} from '../lib/work-sample-rubric.ts';

const reference = {
  id: 'artifact-12345678',
  deviceId: 'device-12345678',
  name: 'ai-pm-work.zip',
  sha256: 'a'.repeat(64),
  bytes: 1024,
  modifiedAt: 1,
};
const dimensions =
  '用户洞察与问题定义、产品方案与范围取舍、AI 理解与产品化判断、自驱力与结果闭环';
const evidence = {
  path: 'docs/brief.md',
  excerpt: '目标用户是首次使用 AI 工具的运营人员',
};
const questions = Array.from({ length: 3 }, (_, index) => ({
  question: `请解释作品中的第 ${index + 1} 个关键判断。`,
  questionSource: 'work-sample' as const,
  dimensions: [index === 0 ? '用户洞察与问题定义' : '产品方案与范围取舍'],
  reason: '核实候选人自己的判断与取舍。',
  resumeEvidence: null,
  workSampleEvidence: evidence,
  listenFor: ['判断依据'],
  probes: ['如果假设不成立，你会如何调整？'],
}));
const assessment: WorkSampleAssessment = {
  rubricVersion: AI_PM_WORK_SAMPLE_RUBRIC_VERSION,
  artifact: {
    id: reference.id,
    name: reference.name,
    sha256: reference.sha256,
    bytes: reference.bytes,
    modifiedAt: reference.modifiedAt,
  },
  coverage: {
    analyzed: ['docs/brief.md', 'src/app.ts'],
    excluded: ['node_modules/'],
    unsupported: ['demo.bin'],
    truncated: false,
  },
  summary: '作品围绕运营人员的 AI 工作流展开。',
  dimensions: aiPmWorkSampleRubric.map(({ name }) => ({
    name,
    score: name === 'Demo 与表达' ? null : 3,
    assessment:
      name === 'Demo 与表达'
        ? '材料未覆盖可核实的演示，待核实。'
        : '按统一笔试目的形成的作品判断。',
    evidence: name === 'Demo 与表达' ? [] : [evidence],
  })),
  strengths: ['问题陈述具体。'],
  risks: ['尚未展示真实用户验证结果。'],
  questions,
};

void test('AI PM work sample rubric fixes the unified written-test purpose', () => {
  assert.equal(
    AI_PM_WORK_SAMPLE_RUBRIC_VERSION,
    'ai-pm-written-test-v1',
  );
  assert.deepEqual(
    aiPmWorkSampleRubric.map(({ name, priority }) => [name, priority]),
    [
      ['用户问题与场景理解', 15],
      ['产品方案与范围取舍', 20],
      ['AI 理解与产品判断', 25],
      ['验证与迭代设计', 15],
      ['产品化与商业判断', 10],
      ['Demo 与表达', 15],
    ],
  );
});

void test('work sample references accept only bounded public metadata', () => {
  assert.deepEqual(validateWorkSampleReference(reference), reference);
  for (const invalid of [
    { ...reference, id: 'short' },
    { ...reference, deviceId: '../device-12345678' },
    { ...reference, name: '../secret.zip' },
    { ...reference, name: 'work.txt' },
    { ...reference, sha256: 'z'.repeat(64) },
    { ...reference, bytes: 50 * 1024 * 1024 + 1 },
  ])
    assert.throws(() => validateWorkSampleReference(invalid));
});

void test('work sample assessment validates dimensions, scores and three grounded questions', () => {
  assert.deepEqual(
    validateWorkSampleAssessment(assessment, {
      reference,
      dimensionText: dimensions,
      questionCount: 3,
      existingQuestions: [],
    }),
    assessment,
  );
  for (const invalid of [
    { ...assessment, rubricVersion: undefined },
    { ...assessment, rubricVersion: 'unknown-rubric' },
    {
      ...assessment,
      dimensions: [{ ...assessment.dimensions[0], name: '未知维度' }],
    },
    {
      ...assessment,
      dimensions: [assessment.dimensions[1], assessment.dimensions[0]],
    },
    {
      ...assessment,
      dimensions: [{ ...assessment.dimensions[0], score: 6 }],
    },
    { ...assessment, questions: questions.slice(0, 2) },
    {
      ...assessment,
      questions: [
        { ...questions[0], workSampleEvidence: { ...evidence, path: '../x' } },
        ...questions.slice(1),
      ],
    },
    {
      ...assessment,
      questions: [
        { ...questions[0], workSampleEvidence: undefined },
        ...questions.slice(1),
      ],
    },
  ])
    assert.throws(() =>
      validateWorkSampleAssessment(invalid, {
        reference,
        dimensionText: dimensions,
        questionCount: 3,
        existingQuestions: [],
      }),
    );
});

void test('historical work sample results require the explicit compatibility path', () => {
  const { rubricVersion: _rubricVersion, ...historicalBase } = assessment;
  const historical: WorkSampleAssessment = {
    ...historicalBase,
    dimensions: [
      {
        name: '用户洞察与问题定义',
        score: 4,
        assessment: '历史结果按岗位维度整理。',
        evidence: [evidence],
      },
    ],
  };
  assert.throws(() =>
    validateWorkSampleAssessment(historical, {
      reference,
      dimensionText: dimensions,
      questionCount: 3,
      existingQuestions: [],
    }),
  );
  assert.deepEqual(
    validateWorkSampleAssessment(historical, {
      reference,
      dimensionText: dimensions,
      questionCount: 3,
      existingQuestions: [],
      allowLegacy: true,
    }),
    historical,
  );
});

void test('work sample evidence must exist verbatim in the referenced local file', async () => {
  const files = new Map([
    ['docs/brief.md', `# 方案\n${evidence.excerpt}\n`],
    ['src/app.ts', 'export const ready = true;'],
  ]);
  await validateWorkSampleEvidenceFiles(assessment, async (path) =>
    files.get(path),
  );
  await assert.rejects(() =>
    validateWorkSampleEvidenceFiles(
      {
        ...assessment,
        dimensions: [
          {
            ...assessment.dimensions[0],
            evidence: [{ ...evidence, excerpt: '不存在的作品原文' }],
          },
        ],
      },
      async (path) => files.get(path),
    ),
  );
});

void test('work sample questions cannot repeat an existing outline question', () => {
  assert.throws(() =>
    validateWorkSampleAssessment(assessment, {
      reference,
      dimensionText: dimensions,
      questionCount: 3,
      existingQuestions: [questions[0]],
    }),
  );
});
