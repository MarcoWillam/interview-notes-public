import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canApplyOutlineRegeneration,
  canRegenerateOutline,
  createOutlineRegenerationInput,
} from '../lib/outline-regeneration-workflow.ts';
import {
  calculateOutlineCoverage,
  type InterviewQuestionV2,
} from '../lib/interview-outline-v2.ts';
import { builtInRoleTemplates } from '../lib/default-role-templates.ts';

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
      reading: {
        ...reading,
        interviewQuestions: reading.interviewQuestions.map((question) => ({
          ...question,
          questionSource: undefined,
        })),
      },
    }),
    false,
  );
  assert.equal(
    canRegenerateOutline({
      ...state,
      preparationJobIds: [undefined, 'work-job-1'],
    }),
    false,
  );
});

void test('regeneration input reuses persisted resume and current outline', async () => {
  const input = await createOutlineRegenerationInput({
    resumeText: '负责用户访谈并整理需求。',
    standards,
    reading,
  });
  if (input.outlineVersion === 2) throw new Error('expected V1 fixture');
  assert.equal(input.interviewQuestions.length, 6);
  assert.match(input.revision, /^outline-/);
  assert.equal(input.writtenTestSupplement, null);
});

void test('completed outline only applies to the unchanged active record', async () => {
  const input = await createOutlineRegenerationInput({
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

void test('V2 outline is eligible and its complete snapshot enters regeneration input', async () => {
  const template = builtInRoleTemplates[0];
  const dimensions = template.dimensionText.split('、');
  const order = [4, 0, 1, 2, 3, 5, 6, 7];
  const all: InterviewQuestionV2[] = order.map((dimensionIndex, index) => ({
    id: `workflow-v2-${index + 1}`,
    question: `请说明经历${index + 1}的关键判断`,
    required: index < 5,
    estimatedMinutes: index < 5 ? 6 : 4,
    primaryDimension: dimensions[dimensionIndex],
    secondaryDimensions: [],
    source: 'role',
    goal: '核实具体行动',
    resumeEvidence: null,
    workSampleEvidence: null,
    listenFor: ['判断依据'],
    riskSignals: ['缺少个人行动'],
    probes: [{ condition: '依据不清楚', question: '你怎样验证？' }],
  }));
  const outline = {
    version: 2 as const,
    estimatedMinutes: 30,
    requiredQuestions: all.slice(0, 5),
    reserveQuestions: all.slice(5),
    archivedReserveQuestions: [],
    coverage: calculateOutlineCoverage(all, dimensions),
  };
  const v2Reading = {
    ...reading,
    interviewQuestions: undefined,
    outline,
  };
  const state = {
    resumeText: '负责用户访谈并整理需求。',
    reading: v2Reading,
    transcript: '',
    report: null,
    confirmed: false,
  };
  assert.equal(canRegenerateOutline(state), true);
  const input = await createOutlineRegenerationInput({
    resumeText: state.resumeText,
    standards: template,
    reading: v2Reading,
  });
  assert.equal(input.outlineVersion, 2);
  assert.deepEqual('outline' in input ? input.outline : null, outline);
});
