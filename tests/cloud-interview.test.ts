import { followUpGroupFixture } from './fixtures/follow-up-outline.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CLOUD_INTERVIEW_BYTES,
  interviewSummary,
  validateCloudInterview,
  validateCloudVersionReason,
} from '../lib/cloud-interview.ts';

const record = {
  id: 'record-12345678',
  createdAt: 100,
  updatedAt: 200,
  candidate: '测试候选人',
  role: 'AI 产品经理（校招）',
  requirements: '理解用户问题并推动方案落地',
  dimensionText: '自驱力、学习力、产品思维',
  focus: '潜力与可培养性',
  resumeText: '姓名：测试候选人。负责校园项目。',
  resumeName: '测试候选人简历.pdf',
  resumeReading: null,
  transcript: '候选人：我主动组织了五次用户访谈。',
  transcriptName: '面试记录.txt',
  reviewed: true,
  report: null,
  conclusion: '',
  confirmed: false,
  sourceTemplateId: 'builtin-campus-ai-product-manager',
  outlineVersion: 3 as const,
  hasWrittenTest: false,
  writtenTestConfirmed: true,
};

void test('cloud interview accepts the current local record shape', () => {
  const value = validateCloudInterview(record);
  assert.deepEqual(value, record);
  assert.equal(interviewSummary(value, 3).revision, 3);
  assert.equal(interviewSummary(value, 3).candidate, '测试候选人');
  assert.equal(interviewSummary(value, 3).role, 'AI 产品经理（校招）');
});

void test('cloud interview rejects malformed core fields and local binary data', () => {
  assert.throws(
    () => validateCloudInterview({ ...record, candidate: 1 }),
    /候选人信息/,
  );
  assert.throws(
    () => validateCloudInterview({ ...record, audio: new Blob(['secret']) }),
    /不支持的字段/,
  );
  assert.throws(
    () => validateCloudInterview({ ...record, unknown: true }),
    /不支持的字段/,
  );
});

void test('cloud interview enforces the serialized two MiB ceiling', () => {
  assert.throws(
    () =>
      validateCloudInterview({
        ...record,
        report: { padding: 'x'.repeat(MAX_CLOUD_INTERVIEW_BYTES) },
      }),
    /超过 2 MiB/,
  );
});

void test('cloud version reasons use a closed business vocabulary', () => {
  assert.equal(validateCloudVersionReason('outline-generated'), 'outline-generated');
  assert.throws(() => validateCloudVersionReason('arbitrary-event'), /版本原因/);
});

void test('cloud records accept legacy and follow-up fields with strict group validation', () => {
  assert.equal(validateCloudInterview(record).outlineSupplements, undefined);
  const next = {
    ...record,
    outlineSupplements: [followUpGroupFixture()],
    followUpOutlineJobId: 'follow-up-running-job',
  };
  assert.deepEqual(validateCloudInterview(next), next);
  assert.throws(
    () =>
      validateCloudInterview({
        ...next,
        followUpOutlineJobId: 'x'.repeat(101),
      }),
    /补充/,
  );
  for (const invalid of [
    null,
    [{}],
    [{ ...followUpGroupFixture(), questions: [] }],
    [{ ...followUpGroupFixture(), unknown: true }],
  ]) {
    assert.throws(
      () => validateCloudInterview({ ...record, outlineSupplements: invalid }),
      /补充/,
    );
  }
  for (const reason of [
    'follow-up-outline-generated',
    'follow-up-outline-deleted',
  ])
    assert.equal(validateCloudVersionReason(reason), reason);
});

void test('cloud records accept strict second-round task source hashes', () => {
  const hash = 'a'.repeat(64);
  const next = {
    ...record,
    secondRoundOutlineSourceHash: hash,
    secondRoundAssessmentSourceHash: hash,
  };
  assert.deepEqual(validateCloudInterview(next), next);
  for (const invalid of ['short', 'A'.repeat(64), 'g'.repeat(64)]) {
    assert.throws(
      () =>
        validateCloudInterview({
          ...record,
          secondRoundOutlineSourceHash: invalid,
        }),
      /复试提纲任务来源/,
    );
  }
});
