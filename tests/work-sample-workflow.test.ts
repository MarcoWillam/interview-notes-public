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
