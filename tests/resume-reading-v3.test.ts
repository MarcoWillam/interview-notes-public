import assert from 'node:assert/strict';
import test from 'node:test';
import { builtInRoleTemplates } from '../lib/default-role-templates.ts';
import {
  calculateOutlineCoverageV3,
  type InterviewOutlineV3,
  type InterviewQuestionV3,
} from '../lib/interview-outline-v3.ts';
import {
  resumeInstructionsFor,
  resumeOutputSchema,
  validateResumeInput,
  validateResumeReading,
} from '../lib/resume-reading.ts';
import {
  AI_PM_WORK_SAMPLE_RUBRIC_VERSION,
  aiPmWorkSampleRubric,
} from '../lib/work-sample-rubric.ts';

const template = builtInRoleTemplates[0];
const dimensions = template.dimensionText.split('、');
const resumeText = '姓名：林小满。主动组织校园用户访谈并完成两轮验证。';
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

function question(
  index: number,
  primaryDimension: string,
  required: boolean,
  secondaryDimensions: string[] = [],
): InterviewQuestionV3 {
  return {
    id: `v3-${index + 1}`,
    question: stems[index],
    required,
    estimatedMinutes: required ? 5 : 4,
    primaryDimension,
    secondaryDimensions,
    source: 'role',
    goal: '了解候选人的实际思考和行动方式',
    resumeEvidence: null,
    workSampleEvidence: null,
    listenFor: ['候选人自己的行动'],
    riskSignals: ['无法说明自己的行动'],
    probes: [{ condition: '回答笼统', question: '当时你先做了哪一步？' }],
  };
}

function outline(): InterviewOutlineV3 {
  const requiredQuestions = [
    question(0, dimensions[4], true),
    question(1, dimensions[5], true),
    question(2, dimensions[6], true),
    question(3, dimensions[7], true),
    question(4, dimensions[0], true, [dimensions[1]]),
    question(5, dimensions[2], true, [dimensions[3]]),
  ];
  const reserveQuestions = [
    question(6, dimensions[0], false),
    question(7, dimensions[3], false),
  ];
  return {
    version: 3,
    estimatedMinutes: 30,
    requiredQuestions,
    reserveQuestions,
    archivedReserveQuestions: [],
    coverage: calculateOutlineCoverageV3(
      [...requiredQuestions, ...reserveQuestions],
      dimensions,
    ),
  };
}

const input = {
  ...template,
  resumeText,
  hasWrittenTest: false,
  outlineVersion: 3 as const,
};

const reading = {
  candidateName: '林小满',
  candidateNameEvidence: '姓名：林小满',
  summary: '候选人经历来自简历自述，仍待面试核实。',
  sections: [
    { name: '教育背景', items: [] },
    { name: '工作经历', items: [] },
    {
      name: '项目经验',
      items: [{ text: '组织用户访谈', evidence: '主动组织校园用户访谈' }],
    },
    { name: '技能', items: [] },
  ],
  followUps: [],
  outline: outline(),
};

void test('简历阅读入口接受 V3 并返回六加二潜力提纲', () => {
  assert.equal(validateResumeInput(input).outlineVersion, 3);
  const validated = validateResumeReading(reading, input);
  assert.equal(validated.outline?.version, 3);
  assert.equal(validated.outline?.requiredQuestions.length, 6);
  assert.equal(validated.outline?.reserveQuestions.length, 2);
});

void test('V3 简历阅读使用潜力提纲指令和严格输出结构', () => {
  assert.match(resumeInstructionsFor(3), /V3 校招潜力/);
  const schema = resumeOutputSchema(3);
  assert.deepEqual(schema.properties.outline.properties.version.enum, [3]);
  assert.equal(
    schema.properties.outline.properties.requiredQuestions.minItems,
    6,
  );
  assert.equal(
    schema.properties.outline.properties.reserveQuestions.maxItems,
    2,
  );
});

void test('后补作品结果可与候选区的两道作品题一起重新校验', () => {
  const source = outline();
  const evidence = {
    path: 'docs/brief.md',
    excerpt: '目标用户是首次使用 AI 工具的运营人员',
  };
  const reserveQuestions = source.reserveQuestions.map((item) => ({
    ...item,
    source: 'work-sample' as const,
    workSampleEvidence: evidence,
  }));
  const lateOutline = {
    ...source,
    reserveQuestions,
    coverage: calculateOutlineCoverageV3(
      [...source.requiredQuestions, ...reserveQuestions],
      dimensions,
    ),
  };
  const reference = {
    id: 'artifact-12345678',
    deviceId: 'device-12345678',
    name: '作品.zip',
    sha256: 'a'.repeat(64),
    bytes: 1024,
    modifiedAt: 1,
  };
  const workSample = {
    rubricVersion: AI_PM_WORK_SAMPLE_RUBRIC_VERSION,
    artifact: {
      id: reference.id,
      name: reference.name,
      sha256: reference.sha256,
      bytes: reference.bytes,
      modifiedAt: reference.modifiedAt,
    },
    coverage: {
      analyzed: ['docs/brief.md'],
      excluded: [],
      unsupported: [],
      truncated: false,
    },
    summary: '作品围绕运营人员的 AI 工作流展开。',
    dimensions: aiPmWorkSampleRubric.map(({ name }) => ({
      name,
      score: null,
      assessment: '作品信息仍需在面试中核实。',
      evidence: [],
    })),
    strengths: ['问题描述清楚。'],
    risks: ['验证过程仍待核实。'],
    questions: reserveQuestions.map((item) => ({
      question: item.question,
      questionSource: 'work-sample' as const,
      dimensions: [item.primaryDimension],
      reason: item.goal,
      resumeEvidence: null,
      workSampleEvidence: item.workSampleEvidence!,
      listenFor: item.listenFor,
      probes: item.probes.map(({ question }) => question),
    })),
  };
  const validated = validateResumeReading(
    { ...reading, outline: lateOutline, workSample },
    { ...input, hasWrittenTest: true, workSample: reference },
  );
  assert.equal(validated.workSample?.questions.length, 2);
  assert.deepEqual(validated.outline?.reserveQuestions, reserveQuestions);
});
