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
const revision = outlineRevision({ resumeText, standards, reading });
const input = validateOutlineRegenerationInput({
  ...standards,
  resumeText,
  revision,
  interviewQuestions: reading.interviewQuestions,
  writtenTestSupplement: null,
  workSample: null,
});

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
