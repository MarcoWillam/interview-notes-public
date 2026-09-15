import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyFollowUpOutlineResult,
  validateFollowUpOutlineInput,
  validateFollowUpOutlineResult,
} from '../lib/follow-up-outline.ts';
import {
  followUpInputFixture,
  followUpResultFixture,
} from './fixtures/follow-up-outline.ts';

void test('补充追问规范化关注点并固定返回两题', () => {
  const input = validateFollowUpOutlineInput({
    ...followUpInputFixture(),
    requestedFocus: '  自驱力与主动发现问题  ',
  });
  assert.equal(input.requestedFocus, '自驱力与主动发现问题');
  const result = validateFollowUpOutlineResult(
    { ...followUpResultFixture(), requestedFocus: input.requestedFocus },
    input,
  );
  assert.equal(result.questions.length, 2);
});

void test('补充追问拒绝过短关注点、长问题、重复题和伪造简历依据', () => {
  assert.throws(() =>
    validateFollowUpOutlineInput({
      ...followUpInputFixture(),
      requestedFocus: '自',
    }),
  );
  assert.throws(() =>
    validateFollowUpOutlineResult(
      {
        ...followUpResultFixture(),
        questions: followUpResultFixture().questions.map((item) => ({
          ...item,
          question:
            '这是一道明显超过三十个字符限制并且不适合现场直接提问的冗长主问题吗',
        })),
      },
      followUpInputFixture(),
    ),
  );
  assert.throws(() =>
    validateFollowUpOutlineResult(
      {
        ...followUpResultFixture(),
        questions: [
          followUpResultFixture().questions[0],
          followUpResultFixture().questions[0],
        ],
      },
      followUpInputFixture(),
    ),
  );
  assert.throws(() =>
    validateFollowUpOutlineResult(
      {
        ...followUpResultFixture(),
        questions: followUpResultFixture().questions.map((item) => ({
          ...item,
          resumeEvidence: '简历里不存在的经历',
        })),
      },
      followUpInputFixture(),
    ),
  );
});

void test('补充追问输入深度校验简历阅读及其嵌套对象', () => {
  const fixture = followUpInputFixture();
  assert.throws(() =>
    validateFollowUpOutlineInput({ ...fixture, resumeReading: {} }),
  );
  assert.throws(() =>
    validateFollowUpOutlineInput({
      ...fixture,
      resumeReading: {
        ...fixture.resumeReading,
        interviewQuestions: fixture.resumeReading.interviewQuestions?.map(
          (question) => ({ ...question, unexpected: 'field' }),
        ),
      },
    }),
  );
  assert.throws(() =>
    validateFollowUpOutlineInput({
      ...fixture,
      resumeReading: {
        ...fixture.resumeReading,
        summary: 'x'.repeat(4001),
      },
    }),
  );
});

void test('补充追问结果必须逐字匹配已规范化的关注点', () => {
  const input = validateFollowUpOutlineInput(followUpInputFixture());
  assert.throws(() =>
    validateFollowUpOutlineResult(
      { ...followUpResultFixture(), requestedFocus: ' 自驱力 ' },
      input,
    ),
  );
});

void test('条件追问问题至少包含两个字符', () => {
  const input = validateFollowUpOutlineInput(followUpInputFixture());
  assert.throws(() =>
    validateFollowUpOutlineResult(
      {
        ...followUpResultFixture(),
        questions: followUpResultFixture().questions.map((question) => ({
          ...question,
          probes: [{ ...question.probes[0], question: '?' }],
        })),
      },
      input,
    ),
  );
});

void test('应用结果按 jobId 去重且不改写原提纲', () => {
  const first = applyFollowUpOutlineResult([], followUpResultFixture(), {
    id: 'group-12345678',
    jobId: 'job-12345678',
    createdAt: 1,
  });
  const repeated = applyFollowUpOutlineResult(
    first,
    followUpResultFixture(),
    {
      id: 'group-other123',
      jobId: 'job-12345678',
      createdAt: 2,
    },
  );
  assert.equal(repeated.length, 1);
});
