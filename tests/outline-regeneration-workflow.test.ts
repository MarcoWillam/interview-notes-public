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
import {
  calculateOutlineCoverageV3,
  type InterviewQuestionV3,
} from '../lib/interview-outline-v3.ts';

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
  if (input.outlineVersion !== undefined && input.outlineVersion !== 1)
    throw new Error('expected V1 fixture');
  assert.equal(input.interviewQuestions.length, 6);
  assert.match(input.revision, /^outline-/);
  assert.equal(input.writtenTestSupplement, null);
});

void test('regeneration gives a specific recovery message when saved resume text is missing', async () => {
  await assert.rejects(
    () => createOutlineRegenerationInput({ resumeText: ' ', standards, reading }),
    /重新上传或粘贴/,
  );
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

void test('V3 potential outline is eligible and keeps its six-plus-two snapshot', async () => {
  const template = builtInRoleTemplates[0];
  const dimensions = template.dimensionText.split('、');
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
    id: `workflow-v3-${index + 1}`,
    question,
    required: index < 6,
    estimatedMinutes: index < 6 ? 5 : 4,
    primaryDimension: dimensions[order[index]],
    secondaryDimensions:
      index === 4 ? [dimensions[1]] : index === 5 ? [dimensions[3]] : [],
    source: 'role',
    goal: '了解候选人的实际思考和行动方式',
    resumeEvidence: null,
    workSampleEvidence: null,
    listenFor: ['候选人自己的行动'],
    riskSignals: ['无法说明自己的行动'],
    probes: [{ condition: '回答笼统', question: '当时你先做了哪一步？' }],
  }));
  const outline = {
    version: 3 as const,
    estimatedMinutes: 30,
    requiredQuestions: all.slice(0, 6),
    reserveQuestions: all.slice(6),
    archivedReserveQuestions: [],
    coverage: calculateOutlineCoverageV3(all, dimensions),
  };
  const experienceMap = {
    version: 1 as const,
    summary: '识别到用户访谈经历。',
    experiences: [{
      id: 'project-1', sourceOrder: 1, type: 'project' as const,
      name: '简历中未明确具体项目', nameEvidence: null,
      organization: null, period: null, role: null, context: null,
      actions: [{ text: '用户访谈与需求整理', evidence: '负责用户访谈并整理需求' }],
      decisions: [], collaboration: [], outcomes: [], reflection: [],
      evidence: ['负责用户访谈并整理需求'],
      dimensionSignals: [dimensions[0]], missingInformation: [],
    }],
    coverage: [{ source: '负责用户访谈并整理需求', experienceId: 'project-1', status: 'mapped' as const }],
    unresolvedItems: [],
  };
  const v3Reading = {
    ...reading,
    interviewQuestions: undefined,
    outline,
    experienceMap,
  };
  const state = {
    resumeText: '负责用户访谈并整理需求。',
    reading: v3Reading,
    transcript: '',
    report: null,
    confirmed: false,
  };
  assert.equal(canRegenerateOutline(state), true);
  const input = await createOutlineRegenerationInput({
    resumeText: state.resumeText,
    standards: template,
    reading: v3Reading,
  });
  assert.equal(input.outlineVersion, 3);
  assert.deepEqual('outline' in input ? input.outline : null, outline);
  assert.deepEqual(
    'experienceMap' in input ? input.experienceMap : null,
    experienceMap,
  );
});
