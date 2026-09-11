import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canApplyOutlineRegeneration,
  canRegenerateOutline,
  createOutlineRegenerationInput,
} from '../lib/outline-regeneration-workflow.ts';

const reading = {
  summary: '简历自述。',
  sections: [
    { name: '教育背景', items: [] },
    { name: '工作经历', items: [] },
    { name: '项目经验', items: [] },
    { name: '技能', items: [] },
  ],
  followUps: [],
  interviewQuestions: Array.from({ length: 6 }, (_, index) => ({
    question: `请说明第${index + 1}个项目中你的具体行动。`,
    questionSource: index ? ('role' as const) : ('resume' as const),
    dimensions: ['用户洞察'],
    reason: '核实行动。',
    resumeEvidence: index ? null : '负责用户访谈',
    listenFor: ['事实'],
    probes: ['结果如何？'],
  })),
};
const standards = {
  role: '产品经理',
  requirements: '用户理解',
  dimensionText: '用户洞察',
  focus: '个人行动',
  scoringGuidance: '依据证据',
  reportRequirements: '列出边界',
};

void test('outline can regenerate once before an interview starts', () => {
  const state = {
    resumeText: '负责用户访谈并整理需求。',
    reading,
    transcript: '',
    report: null,
    confirmed: false,
  };
  assert.equal(canRegenerateOutline(state), true);
  assert.equal(
    canRegenerateOutline({ ...state, transcript: '候选人：回答' }),
    false,
  );
  assert.equal(canRegenerateOutline({ ...state, regeneratedAt: 1 }), false);
  assert.equal(canRegenerateOutline({ ...state, activeJobId: 'job-1' }), false);
  assert.equal(
    canRegenerateOutline({
      ...state,
      preparationJobIds: [undefined, 'work-job-1'],
    }),
    false,
  );
});

void test('regeneration input reuses persisted resume and current outline', () => {
  const input = createOutlineRegenerationInput({
    resumeText: '负责用户访谈并整理需求。',
    standards,
    reading,
  });
  assert.equal(input.interviewQuestions.length, 6);
  assert.match(input.revision, /^outline-/);
  assert.equal(input.writtenTestSupplement, null);
});

void test('completed outline only applies to the unchanged active record', () => {
  const input = createOutlineRegenerationInput({
    resumeText: '负责用户访谈并整理需求。',
    standards,
    reading,
  });
  const current = {
    submittedRecordId: 'record-12345678',
    currentRecordId: 'record-12345678',
    submittedInput: input,
    currentInput: input,
    transcript: '',
    report: null,
    confirmed: false,
  };
  assert.equal(canApplyOutlineRegeneration(current), true);
  assert.equal(
    canApplyOutlineRegeneration({
      ...current,
      currentRecordId: 'record-87654321',
    }),
    false,
  );
  assert.equal(
    canApplyOutlineRegeneration({ ...current, transcript: '面试已开始' }),
    false,
  );
});
