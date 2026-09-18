import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateWorkSampleAssessment,
  validateWorkSampleInput,
  validateWorkSampleAnalysisResult,
  validateWorkSampleEvidenceFiles,
  validateWorkSampleReference,
  exportWorkSampleAssessment,
  workSampleInstructionsFor,
  workSampleEmbeddedInstructionsFor,
  workSampleOutputSchema,
  workSampleRubricLabel,
  type WorkSampleAssessment,
} from '../lib/work-sample.ts';
import {
  AI_PM_WORK_SAMPLE_RUBRIC_VERSION,
  aiPmWorkSampleRubric,
} from '../lib/work-sample-rubric.ts';
import { builtInRoleTemplates } from '../lib/default-role-templates.ts';
import {
  calculateOutlineCoverageV3,
  type InterviewOutlineV3,
  type InterviewQuestionV3,
} from '../lib/interview-outline-v3.ts';

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
  assert.equal(AI_PM_WORK_SAMPLE_RUBRIC_VERSION, 'ai-pm-written-test-v1');
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

void test('V3 work sample contract returns two friendly review questions', () => {
  const schema = workSampleOutputSchema(3);
  if (!('version' in schema.properties)) throw new Error('expected V3 schema');
  assert.deepEqual(schema.properties.version.enum, [3]);
  assert.equal(schema.properties.workSample.properties.questions.maxItems, 2);
  assert.equal(
    schema.properties.outlineSupplement.properties.questions.maxItems,
    2,
  );
  assert.match(workSampleInstructionsFor(3), /两道/);
  assert.match(workSampleInstructionsFor(3), /12–30/);
  assert.match(workSampleInstructionsFor(3), /亲和/);
  assert.match(workSampleEmbeddedInstructionsFor(3), /恰好两道/);
  assert.doesNotMatch(workSampleEmbeddedInstructionsFor(3), /恰好三道/);
});

void test('work sample output schema restricts every interview question to role dimensions', () => {
  const allowedDimensions = ['用户洞察与问题定义', '产品方案与范围取舍'];
  const schema = workSampleOutputSchema(3, allowedDimensions) as {
    properties: {
      workSample: {
        properties: {
          questions: {
            items: {
              properties: {
                dimensions: { items: { enum: string[] } };
              };
            };
          };
        };
      };
      outlineSupplement: {
        properties: {
          questions: {
            items: {
              properties: {
                primaryDimension: { enum: string[] };
                secondaryDimensions: { items: { enum: string[] } };
              };
            };
          };
        };
      };
    };
  };
  const assessmentQuestion =
    schema.properties.workSample.properties.questions.items.properties;
  const outlineQuestion =
    schema.properties.outlineSupplement.properties.questions.items.properties;
  assert.deepEqual(assessmentQuestion.dimensions.items.enum, allowedDimensions);
  assert.deepEqual(outlineQuestion.primaryDimension.enum, allowedDimensions);
  assert.deepEqual(
    outlineQuestion.secondaryDimensions.items.enum,
    allowedDimensions,
  );
});

function v3Outline(): InterviewOutlineV3 {
  const roleDimensions = builtInRoleTemplates[0].dimensionText.split('、');
  const stems = [
    '最近有没有一件没人要求但你主动做的事？',
    '遇到陌生问题时你通常会怎么开始学？',
    '哪件事一度很难推进后来你怎么处理的？',
    '和同伴想法不同时你会怎么推动事情继续？',
    '同学说AI功能不好用你会先了解什么？',
    '为校园设计AI功能时你会从哪里开始？',
    '哪段经历最能说明你理解真实用户？',
    '如果验证结果不理想你会先调整什么？',
  ];
  const order = [4, 5, 6, 7, 0, 2, 1, 3];
  const all: InterviewQuestionV3[] = stems.map((question, index) => ({
    id: `work-v3-${index + 1}`,
    question,
    required: index < 6,
    estimatedMinutes: index < 6 ? 5 : 4,
    primaryDimension: roleDimensions[order[index]],
    secondaryDimensions:
      index === 4
        ? [roleDimensions[1]]
        : index === 5
          ? [roleDimensions[3]]
          : [],
    source: 'role',
    goal: '了解候选人的实际思考和行动方式',
    resumeEvidence: null,
    workSampleEvidence: null,
    listenFor: ['候选人自己的行动'],
    riskSignals: ['无法说明自己的行动'],
    probes: [{ condition: '回答笼统', question: '当时你先做了哪一步？' }],
  }));
  return {
    version: 3,
    estimatedMinutes: 30,
    requiredQuestions: all.slice(0, 6),
    reserveQuestions: all.slice(6),
    archivedReserveQuestions: [],
    coverage: calculateOutlineCoverageV3(all, roleDimensions),
  };
}

void test('V3 later work submission accepts the six-plus-two outline', () => {
  const template = builtInRoleTemplates[0];
  const input = {
    ...template,
    resumeText: '姓名：林小满。完成校园 AI 项目。',
    workSample: reference,
    outlineVersion: 3 as const,
    outline: v3Outline(),
  };
  const validated = validateWorkSampleInput(input);
  assert.equal(validated.outlineVersion, 3);
  assert.equal(validated.outline.requiredQuestions.length, 6);
});

void test('V3 validates two matching work-review questions', () => {
  const template = builtInRoleTemplates[0];
  const input = validateWorkSampleInput({
    ...template,
    resumeText: '姓名：林小满。完成校园 AI 项目。',
    workSample: reference,
    outlineVersion: 3,
    outline: v3Outline(),
  });
  assert.equal(input.outlineVersion, 3);
  const workSample = {
    ...assessment,
    questions: assessment.questions.slice(0, 2),
  };
  const supplementQuestions = input.outline.reserveQuestions.map(
    (question, index) => ({
      ...question,
      id: `work-review-${index + 1}`,
      question: workSample.questions[index].question,
      source: 'work-sample' as const,
      resumeEvidence: null,
      workSampleEvidence: evidence,
    }),
  );
  const result = {
    version: 3 as const,
    workSample,
    outlineSupplement: {
      version: 3 as const,
      kind: 'work-sample' as const,
      questions: supplementQuestions,
    },
  };
  assert.deepEqual(validateWorkSampleAnalysisResult(result, input), result);
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
  assert.equal(workSampleRubricLabel(historical), '历史评估口径');
  assert.match(exportWorkSampleAssessment(historical), /历史评估口径/);
});

void test('current work sample exports name the unified assessment basis without a total', () => {
  assert.equal(workSampleRubricLabel(assessment), '依据统一笔试目的评估');
  const markdown = exportWorkSampleAssessment(assessment);
  assert.match(markdown, /评估口径：依据统一笔试目的评估/);
  for (const { name } of aiPmWorkSampleRubric)
    assert.match(markdown, new RegExp(name));
  assert.doesNotMatch(markdown, /100 分/);
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
