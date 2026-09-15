import assert from 'node:assert/strict';
import test from 'node:test';
import type { CloudInterview } from '../lib/cloud-interview.ts';
import {
  interviewDraft,
  reconcileInterviewDraft,
  sameInterviewDraft,
} from '../lib/interview-draft-merge.ts';

const base: CloudInterview = {
  id: 'record-a',
  createdAt: 1,
  updatedAt: 1,
  candidate: '候选人 A',
  role: 'AI 产品经理',
  requirements: '岗位要求',
  dimensionText: '自驱力',
  focus: '',
  scoringGuidance: '',
  reportRequirements: '',
  resumeText: '简历',
  resumeName: '简历.docx',
  resumeReading: null,
  transcript: '原面试记录',
  transcriptName: '',
  reviewed: false,
  report: null,
  conclusion: '',
  confirmed: false,
  outlineSupplements: [],
};

void test('strict draft equality ignores metadata, key order and absent optional undefined', () => {
  const { transcriptName: _removed, ...left } = interviewDraft(base);
  assert.equal(
    sameInterviewDraft(left, { transcriptName: undefined, ...left }),
    true,
  );
  assert.equal(
    sameInterviewDraft(left, { ...left, transcriptName: '面试.md' }),
    false,
  );
  assert.equal(
    sameInterviewDraft(
      interviewDraft(base),
      interviewDraft({ ...base, updatedAt: 99 }),
    ),
    true,
  );
});

void test('an unchanged visible draft keeps newer task fields from the persisted record', () => {
  const local = interviewDraft(base);
  const remote = interviewDraft({
    ...base,
    updatedAt: 2,
    conclusion: '任务生成的新结论',
    followUpOutlineJobId: 'job-new',
  });
  const result = reconcileInterviewDraft(interviewDraft(base), local, remote);
  assert.equal(result.kind, 'clean');
  assert.deepEqual(result.draft, remote);
});

void test('disjoint local notes and remote task results merge without dropping either side', () => {
  const local = { ...interviewDraft(base), focus: '面试官新增备注' };
  const remote = interviewDraft({
    ...base,
    updatedAt: 2,
    conclusion: '任务生成的新结论',
    followUpOutlineJobId: 'job-new',
  });
  const result = reconcileInterviewDraft(interviewDraft(base), local, remote);
  assert.equal(result.kind, 'write');
  assert.equal(result.draft.focus, '面试官新增备注');
  assert.equal(result.draft.conclusion, '任务生成的新结论');
  assert.equal(result.draft.followUpOutlineJobId, 'job-new');
});

void test('same-field edits and a missing common base are conflicts', () => {
  const local = { ...interviewDraft(base), transcript: '本页面修改' };
  const remote = { ...interviewDraft(base), transcript: '后台任务修改' };
  assert.equal(
    reconcileInterviewDraft(interviewDraft(base), local, remote).kind,
    'conflict',
  );
  assert.equal(
    reconcileInterviewDraft(undefined, local, remote).kind,
    'conflict',
  );
});

void test('a local-only edit writes normally when persisted data still matches the base', () => {
  const local = { ...interviewDraft(base), focus: '面试官新增备注' };
  const result = reconcileInterviewDraft(
    interviewDraft(base),
    local,
    interviewDraft(base),
  );
  assert.equal(result.kind, 'write');
  assert.deepEqual(result.draft, local);
});
