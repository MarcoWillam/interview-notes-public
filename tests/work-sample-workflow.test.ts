import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyInitialWorkSample,
  applyLateWorkSample,
  canSubmitWorkSample,
  workSampleStatusLabel,
} from '../lib/work-sample-workflow.ts';
import type { ResumeReading } from '../lib/resume-reading.ts';
import type { WorkSampleAssessment } from '../lib/work-sample.ts';
import {
  calculateOutlineCoverage,
  type InterviewOutlineV2,
  type InterviewQuestionV2,
} from '../lib/interview-outline-v2.ts';
import {
  calculateOutlineCoverageV3,
  type InterviewOutlineV3,
  type InterviewQuestionV3,
} from '../lib/interview-outline-v3.ts';

const question = (index: number, source: 'role' | 'work-sample' = 'role') => ({
  question: `${source === 'work-sample' ? '作品' : '原提纲'}问题 ${index + 1}`,
  questionSource: source,
  dimensions: ['用户洞察与问题定义'],
  reason: '核实判断过程。',
  resumeEvidence: null,
  ...(source === 'work-sample'
    ? { workSampleEvidence: { path: 'brief.md', excerpt: '目标用户' } }
    : {}),
  listenFor: ['判断依据'],
  probes: ['如何验证？'],
});
const reading: ResumeReading = {
  summary: '待核实',
  sections: ['教育背景', '工作经历', '项目经验', '技能'].map((name) => ({
    name,
    items: [],
  })),
  followUps: [],
  interviewQuestions: Array.from({ length: 6 }, (_, index) => question(index)),
};
const workSample: WorkSampleAssessment = {
  artifact: {
    id: 'artifact-12345678',
    name: 'candidate.zip',
    sha256: 'd'.repeat(64),
    bytes: 1024,
    modifiedAt: 123,
  },
  coverage: {
    analyzed: ['brief.md'],
    excluded: [],
    unsupported: [],
    truncated: false,
  },
  summary: '作品观察待面试核实。',
  dimensions: [
    {
      name: '用户洞察与问题定义',
      score: 4,
      assessment: '目标用户明确。',
      evidence: [{ path: 'brief.md', excerpt: '目标用户' }],
    },
  ],
  strengths: ['目标明确'],
  risks: ['验证待核实'],
  questions: Array.from({ length: 3 }, (_, index) =>
    question(index, 'work-sample'),
  ),
};

const state = {
  sourceTemplateId: 'builtin-campus-ai-product-manager',
  hasWrittenTest: false,
  resumeReading: reading,
  workSample: null,
  workSampleJobId: undefined,
};

void test('only a locked AI PM outline without successful or active work can submit', () => {
  assert.equal(canSubmitWorkSample(state), true);
  assert.equal(
    canSubmitWorkSample({
      ...state,
      sourceTemplateId: 'builtin-campus-ai-engineering',
    }),
    false,
  );
  assert.equal(canSubmitWorkSample({ ...state, resumeReading: null }), false);
  assert.equal(canSubmitWorkSample({ ...state, workSample }), false);
  assert.equal(
    canSubmitWorkSample({ ...state, workSampleJobId: 'job-12345678' }),
    false,
  );
});

void test('late success preserves the locked outline, sets written-test state, and applies only once', () => {
  const original = structuredClone(reading.interviewQuestions);
  const next = applyLateWorkSample(state, workSample);
  assert.equal(next.hasWrittenTest, true);
  assert.deepEqual(next.resumeReading?.interviewQuestions, original);
  assert.deepEqual(
    next.resumeReading?.workSample?.questions,
    workSample.questions,
  );
  assert.equal(next.workSampleJobId, undefined);
  assert.equal(workSampleStatusLabel(next), '有笔试 · 作品已分析');
  assert.throws(
    () => applyLateWorkSample(next, workSample),
    /只能成功分析一次/,
  );
});

void test('initial success takes the combined reading result and clears its active job', () => {
  const combined = { ...reading, workSample };
  const next = applyInitialWorkSample(
    { ...state, hasWrittenTest: true, workSampleJobId: 'job-12345678' },
    combined,
  );
  assert.equal(next.hasWrittenTest, true);
  assert.equal(next.workSample?.artifact.id, workSample.artifact.id);
  assert.equal(next.workSampleJobId, undefined);
  assert.deepEqual(next.resumeReading, combined);
});

const v2Dimensions = [
  '用户洞察与问题定义',
  '产品方案与范围取舍',
  'AI 理解与产品化判断',
  '数据验证与迭代意识',
  '自驱力与结果闭环',
  '学习力',
  '挑战力与韧性',
  '团队精神与沟通协作',
];

function v2Question(index: number, required: boolean): InterviewQuestionV2 {
  return {
    id: `v2-${index + 1}`,
    question: `请说明经历${index + 1}的关键判断`,
    required,
    estimatedMinutes: required ? 6 : 4,
    primaryDimension: v2Dimensions[[4, 0, 1, 2, 3, 5, 6, 7][index]],
    secondaryDimensions: [],
    source: 'role',
    goal: '核实具体判断',
    resumeEvidence: null,
    workSampleEvidence: null,
    listenFor: ['判断依据'],
    riskSignals: ['缺少个人行动'],
    probes: [{ condition: '依据不清楚', question: '你怎样验证？' }],
  };
}

void test('late V2 work replaces reserve questions while preserving required questions', () => {
  const all = Array.from({ length: 8 }, (_, index) =>
    v2Question(index, index < 5),
  );
  const outline: InterviewOutlineV2 = {
    version: 2,
    estimatedMinutes: 30,
    requiredQuestions: all.slice(0, 5),
    reserveQuestions: all.slice(5),
    archivedReserveQuestions: [],
    coverage: calculateOutlineCoverage(all, v2Dimensions),
  };
  const supplementQuestions = workSample.questions.map((item, index) => ({
    ...v2Question(index + 5, false),
    id: `work-${index + 1}`,
    question: item.question,
    source: 'work-sample' as const,
    workSampleEvidence: item.workSampleEvidence!,
  }));
  const v2State = {
    ...state,
    resumeReading: { ...reading, interviewQuestions: undefined, outline },
  };
  assert.equal(canSubmitWorkSample(v2State), true);
  const next = applyLateWorkSample(v2State, {
    version: 2,
    workSample,
    outlineSupplement: {
      version: 2,
      kind: 'work-sample',
      questions: supplementQuestions,
    },
  });
  assert.deepEqual(
    next.resumeReading.outline?.requiredQuestions,
    outline.requiredQuestions,
  );
  assert.deepEqual(
    next.resumeReading.outline?.reserveQuestions,
    supplementQuestions,
  );
  assert.deepEqual(
    next.resumeReading.outline?.archivedReserveQuestions,
    outline.reserveQuestions,
  );
  assert.equal(next.workSample.artifact.id, workSample.artifact.id);
});

const v3Stems = [
  '最近有没有一件没人要求但你主动做的事？',
  '遇到陌生问题时你通常会怎么开始学？',
  '哪件事一度很难推进后来你怎么处理的？',
  '和同伴想法不同时你会怎么推动事情继续？',
  '同学说AI功能不好用你会先了解什么？',
  '为校园设计AI功能时你会从哪里开始？',
  '这份作品里哪个取舍最值得我们聊聊？',
  '如果重新验证一次你最想先调整什么？',
];

function v3Question(index: number, required: boolean): InterviewQuestionV3 {
  return {
    id: `v3-${index + 1}`,
    question: v3Stems[index],
    required,
    estimatedMinutes: required ? 5 : 4,
    primaryDimension: v2Dimensions[[4, 5, 6, 7, 0, 2, 1, 3][index]],
    secondaryDimensions:
      index === 4 ? [v2Dimensions[1]] : index === 5 ? [v2Dimensions[3]] : [],
    source: 'role',
    goal: '了解候选人的实际思考和行动方式',
    resumeEvidence: null,
    workSampleEvidence: null,
    listenFor: ['候选人自己的判断依据'],
    riskSignals: ['只给结论，无法说明自己的行动'],
    probes: [{ condition: '回答比较笼统', question: '当时你先做了哪一步？' }],
  };
}

void test('late V3 work keeps six required questions and replaces two reserve questions', () => {
  const all = Array.from({ length: 8 }, (_, index) =>
    v3Question(index, index < 6),
  );
  const outline: InterviewOutlineV3 = {
    version: 3,
    estimatedMinutes: 30,
    requiredQuestions: all.slice(0, 6),
    reserveQuestions: all.slice(6),
    archivedReserveQuestions: [],
    coverage: calculateOutlineCoverageV3(all, v2Dimensions),
  };
  const supplementQuestions = all.slice(6).map((item, index) => ({
    ...item,
    id: `v3-work-${index + 1}`,
    question: workSample.questions[index].question,
    source: 'work-sample' as const,
    workSampleEvidence: workSample.questions[index].workSampleEvidence!,
  }));
  const v3State = {
    ...state,
    resumeReading: { ...reading, interviewQuestions: undefined, outline },
  };
  const next = applyLateWorkSample(v3State, {
    version: 3,
    workSample: { ...workSample, questions: workSample.questions.slice(0, 2) },
    outlineSupplement: {
      version: 3,
      kind: 'work-sample',
      questions: supplementQuestions,
    },
  });
  assert.deepEqual(
    next.resumeReading.outline?.requiredQuestions,
    outline.requiredQuestions,
  );
  assert.deepEqual(
    next.resumeReading.outline?.reserveQuestions,
    supplementQuestions,
  );
  assert.deepEqual(
    next.resumeReading.outline?.archivedReserveQuestions,
    outline.reserveQuestions,
  );
});
