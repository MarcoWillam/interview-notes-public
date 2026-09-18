import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOutlineRegeneration,
  outlineRevision,
  validateOutlineRegenerationInput,
  validateOutlineRegenerationResult,
} from '../lib/outline-regeneration.ts';
import type { InterviewQuestion } from '../lib/interview-questions.ts';
import type { ResumeReading } from '../lib/resume-reading.ts';
import {
  calculateOutlineCoverage,
  type InterviewOutlineV2,
  type InterviewQuestionV2,
} from '../lib/interview-outline-v2.ts';
import { calculateOutlineCoverageV3 } from '../lib/interview-outline-v3.ts';
import { builtInRoleTemplates } from '../lib/default-role-templates.ts';

const standards = {
  role: 'AI 产品经理（校招）',
  requirements: '理解用户问题',
  dimensionText: '用户洞察、自驱力',
  focus: '核实个人行动',
  scoringGuidance: '基于证据',
  reportRequirements: '列出边界',
};
const resumeText = '候选人负责访谈用户，并完成需求梳理。';
const question = (index: number): InterviewQuestion => ({
  question: `请说明第${index + 1}个项目中你的具体行动。`,
  questionSource: index === 0 ? 'resume' : 'role',
  dimensions: ['用户洞察'],
  reason: '核实个人行动。',
  resumeEvidence: index === 0 ? '候选人负责访谈用户' : null,
  listenFor: ['具体事实'],
  probes: ['结果如何验证？'],
});
const reading: ResumeReading = {
  summary: '候选人有产品经历。',
  sections: [
    { name: '教育背景', items: [] },
    { name: '工作经历', items: [] },
    { name: '项目经验', items: [] },
    { name: '技能', items: [] },
  ],
  followUps: [],
  interviewQuestions: Array.from({ length: 6 }, (_, index) => question(index)),
};
const revision = await outlineRevision({ resumeText, standards, reading });
const input = validateOutlineRegenerationInput({
  ...standards,
  resumeText,
  revision,
  interviewQuestions: reading.interviewQuestions,
  writtenTestSupplement: null,
  workSample: null,
});
if (input.outlineVersion !== undefined && input.outlineVersion !== 1)
  throw new Error('expected V1 fixture');

void test('outline regeneration preserves counts and source positions', () => {
  const result = validateOutlineRegenerationResult(
    {
      revision,
      interviewQuestions: input.interviewQuestions.map((item, index) => ({
        ...item,
        question: `请说明第${index + 1}次判断的实际依据？`,
      })),
      writtenTestSupplement: null,
      workSampleQuestions: null,
    },
    input,
  );
  const updated = applyOutlineRegeneration(reading, result);
  assert.equal(updated.summary, reading.summary);
  assert.equal(updated.interviewQuestions?.length, 6);
  assert.equal(updated.interviewQuestions?.[0].questionSource, 'resume');
});

void test('stale revisions and changed source positions are rejected', () => {
  const result = {
    revision: 'outline-stale',
    interviewQuestions: input.interviewQuestions,
    writtenTestSupplement: null,
    workSampleQuestions: null,
  };
  assert.throws(
    () => validateOutlineRegenerationResult(result, input),
    /记录已变化/,
  );
  assert.throws(
    () =>
      validateOutlineRegenerationResult(
        {
          ...result,
          revision,
          interviewQuestions: input.interviewQuestions.map((item, index) => ({
            ...item,
            question: `请说明第${index + 1}次判断的实际依据？`,
            questionSource: index === 0 ? 'role' : item.questionSource,
            resumeEvidence: null,
          })),
        },
        input,
      ),
    /来源顺序/,
  );
});

void test('V3 regeneration keeps verified resume evidence and recalculates derived coverage', () => {
  const template = builtInRoleTemplates[0];
  const dimensionNames = template.dimensionText.split('、');
  const source = '姓名：林小满。主动组织校园用户访谈。';
  const makeQuestion = (index: number) => ({
    id: `v3-${index + 1}`,
    question: `在校园活动中你会怎样处理第${index + 1}个问题？`,
    required: index < 6,
    estimatedMinutes: index < 6 ? 5 : 4,
    primaryDimension:
      index < 4 ? dimensionNames[index + 4] : dimensionNames[index - 4],
    secondaryDimensions:
      index === 4 || index === 5 ? [dimensionNames[index - 2]] : [],
    source: index === 0 ? ('resume' as const) : ('role' as const),
    goal: '核实候选人的实际行动',
    resumeEvidence: index === 0 ? '主动组织校园用户访谈' : null,
    workSampleEvidence: null,
    listenFor: ['本人行动'],
    riskSignals: ['只有笼统结论'],
    probes: [{ condition: '回答笼统', question: '你先做了什么？' }],
  });
  const questions = Array.from({ length: 8 }, (_, index) =>
    makeQuestion(index),
  );
  const outline = {
    version: 3 as const,
    estimatedMinutes: 30,
    requiredQuestions: questions.slice(0, 6),
    reserveQuestions: questions.slice(6),
    archivedReserveQuestions: [],
    coverage: calculateOutlineCoverageV3(questions, dimensionNames),
  };
  const existing = validateOutlineRegenerationInput({
    ...template,
    resumeText: source,
    revision: 'outline-v3-regression',
    outlineVersion: 3,
    outline,
    workSample: null,
  });
  const regenerated = {
    ...outline,
    requiredQuestions: outline.requiredQuestions.map((item, index) =>
      index === 0
        ? { ...item, resumeEvidence: '候选人主动组织大型访谈' }
        : item,
    ),
    coverage: [],
  };
  const coverageOnly = validateOutlineRegenerationResult(
    {
      outlineVersion: 3,
      revision: existing.revision,
      outline: { ...regenerated, requiredQuestions: outline.requiredQuestions },
    },
    existing,
  );
  if (!('outlineVersion' in coverageOnly) || coverageOnly.outlineVersion !== 3)
    throw new Error('V3 result expected');
  assert.deepEqual(coverageOnly.outline.coverage, outline.coverage);
  const result = validateOutlineRegenerationResult(
    { outlineVersion: 3, revision: existing.revision, outline: regenerated },
    existing,
  );
  if (!('outlineVersion' in result) || result.outlineVersion !== 3)
    throw new Error('V3 result expected');
  assert.equal(
    result.outline.requiredQuestions[0].resumeEvidence,
    '主动组织校园用户访谈',
  );
  assert.deepEqual(result.outline.coverage, outline.coverage);
  assert.throws(
    () =>
      validateOutlineRegenerationResult(
        {
          outlineVersion: 3,
          revision: existing.revision,
          outline: {
            ...outline,
            requiredQuestions: outline.requiredQuestions.map((item, index) =>
              index === 0
                ? { ...item, source: 'role', resumeEvidence: null }
                : item,
            ),
          },
        },
        existing,
      ),
    /来源顺序/,
  );
});

void test('initially embedded work-sample questions stay identical in both views', async () => {
  const workSampleEvidence = {
    path: 'brief.md',
    excerpt: '目标用户是首次使用 AI 工具的运营人员',
  };
  const workQuestions: InterviewQuestion[] = Array.from(
    { length: 3 },
    (_, index) => ({
      ...question(index + 1),
      question: `请解释作品中第${index + 1}个关键判断与依据。`,
      questionSource: 'work-sample',
      resumeEvidence: null,
      workSampleEvidence,
    }),
  );
  const embeddedQuestions = [...reading.interviewQuestions!];
  embeddedQuestions.splice(1, 3, ...workQuestions);
  const workSample = {
    artifact: {
      id: 'artifact-12345678',
      name: '作品.zip',
      sha256: 'a'.repeat(64),
      bytes: 1024,
      modifiedAt: 1,
    },
    coverage: {
      analyzed: ['brief.md'],
      excluded: [],
      unsupported: [],
      truncated: false,
    },
    summary: '作品摘要。',
    dimensions: [
      {
        name: '用户洞察',
        score: 3,
        assessment: '有明确问题描述。',
        evidence: [workSampleEvidence],
      },
    ],
    strengths: ['问题明确。'],
    risks: ['验证不足。'],
    questions: workQuestions,
  };
  const workReading: ResumeReading = {
    ...reading,
    interviewQuestions: embeddedQuestions,
    workSample,
  };
  const workRevision = await outlineRevision({
    resumeText,
    standards,
    reading: workReading,
  });
  const workInput = validateOutlineRegenerationInput({
    ...standards,
    resumeText,
    revision: workRevision,
    interviewQuestions: embeddedQuestions,
    writtenTestSupplement: null,
    workSample,
  });
  const replacements = embeddedQuestions.map((item, index) => ({
    ...item,
    question: `请说明第${index + 1}项判断的核心依据？`,
  }));
  const output = {
    revision: workRevision,
    interviewQuestions: replacements,
    writtenTestSupplement: null,
    workSampleQuestions: replacements.slice(1, 4),
  };
  const result = validateOutlineRegenerationResult(output, workInput);
  const updated = applyOutlineRegeneration(workReading, result);
  assert.deepEqual(
    updated.workSample?.questions,
    updated.interviewQuestions?.slice(1, 4),
  );
  assert.throws(
    () =>
      validateOutlineRegenerationResult(
        {
          ...output,
          workSampleQuestions: output.workSampleQuestions.map((item, index) =>
            index === 0 ? { ...item, reason: '不同理由。' } : item,
          ),
        },
        workInput,
      ),
    /保持一致/,
  );
});

function v2Outline(): InterviewOutlineV2 {
  const dimensions = builtInRoleTemplates[0].dimensionText.split('、');
  const order = [4, 0, 1, 2, 3, 5, 6, 7];
  const all: InterviewQuestionV2[] = order.map((dimensionIndex, index) => ({
    id: `v2-${index + 1}`,
    question: `请说明经历${index + 1}的关键判断`,
    required: index < 5,
    estimatedMinutes: index < 5 ? 6 : 4,
    primaryDimension: dimensions[dimensionIndex],
    secondaryDimensions: [],
    source: 'role',
    goal: '核实具体判断与行动',
    resumeEvidence: null,
    workSampleEvidence: null,
    listenFor: ['个人判断依据'],
    riskSignals: ['只描述团队结论'],
    probes: [{ condition: '依据不清楚', question: '你怎样验证？' }],
  }));
  return {
    version: 2,
    estimatedMinutes: 30,
    requiredQuestions: all.slice(0, 5),
    reserveQuestions: all.slice(5),
    archivedReserveQuestions: [],
    coverage: calculateOutlineCoverage(all, dimensions),
  };
}

void test('V2 regeneration replaces only the outline under the current revision', async () => {
  const template = builtInRoleTemplates[0];
  const outline = v2Outline();
  const v2Reading: ResumeReading = {
    ...reading,
    interviewQuestions: undefined,
    outline,
  };
  const v2Revision = await outlineRevision({
    resumeText,
    standards: template,
    reading: v2Reading,
  });
  const v2Input = validateOutlineRegenerationInput({
    ...template,
    resumeText,
    revision: v2Revision,
    outlineVersion: 2,
    outline,
    workSample: null,
  });
  assert.equal(v2Input.outlineVersion, 2);
  const replacement: InterviewOutlineV2 = {
    ...outline,
    requiredQuestions: outline.requiredQuestions.map((item, index) => ({
      ...item,
      question: `请说明决策${index + 1}的核心依据`,
    })),
    reserveQuestions: outline.reserveQuestions.map((item, index) => ({
      ...item,
      question: `请说明挑战${index + 1}的应对方法`,
    })),
  };
  const result = validateOutlineRegenerationResult(
    {
      outlineVersion: 2,
      revision: v2Revision,
      outline: replacement,
    },
    v2Input,
  );
  const next = applyOutlineRegeneration(v2Reading, result);
  assert.deepEqual(next.outline, replacement);
  assert.equal(next.summary, v2Reading.summary);
  assert.equal(next.interviewQuestions, undefined);
  assert.throws(
    () =>
      validateOutlineRegenerationResult(
        { outlineVersion: 2, revision: 'outline-stale', outline: replacement },
        v2Input,
      ),
    /记录已变化/,
  );
  assert.throws(
    () =>
      validateOutlineRegenerationResult(
        {
          outlineVersion: 2,
          revision: v2Revision,
          outline: {
            ...replacement,
            requiredQuestions: replacement.requiredQuestions.map(
              (item, index) =>
                index === 1
                  ? { ...item, source: 'written-test', resumeEvidence: null }
                  : item,
            ),
          },
        },
        v2Input,
      ),
    /来源顺序/,
  );
});
