import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasReviewableSpeakerLabels,
  interviewerReviewDimensions,
  interviewerReviewSchema,
  validateInterviewerReview,
} from '../lib/interviewer-review.ts';

const transcript = [
  '[10:03] 面试官：在校园助手项目中，你为什么先做访谈？',
  '候选人: 因为我先观察到同学经常找不到办事入口。',
  '- 面试官：方便说说你具体访谈了哪些人吗？',
  '候选人：我访谈了五位同学，但没有记录完整数据。',
].join('\n');

function availableReview() {
  return {
    status: 'available' as const,
    reason: null,
    summary: '提问能够围绕项目继续核实，岗位维度覆盖仍可更完整。',
    dimensions: interviewerReviewDimensions.map((name, index) => ({
      name,
      level: index < 2 ? ('表现较好' as const) : ('可以改进' as const),
      assessment: `${name}有明确行为依据。`,
      evidence: [
        index % 2
          ? '方便说说你具体访谈了哪些人吗？'
          : '在校园助手项目中，你为什么先做访谈？',
      ],
    })),
    strengths: ['能够带入具体项目提问。', '会继续核实候选人的具体行动。'],
    priorities: ['补充结果验证和复盘问题。'],
    rewrites: [
      {
        originalQuestion: '方便说说你具体访谈了哪些人吗？',
        issue: '只核实了对象，没有继续了解访谈如何影响方案。',
        improvedQuestion: '这些访谈后来怎样影响了你的方案？',
        purpose: '判断用户洞察能否转化为产品决策。',
      },
    ],
    missedFollowUps: [
      {
        candidateSignal: '我访谈了五位同学，但没有记录完整数据。',
        suggestedQuestion: '当时没有完整数据，你是怎样判断访谈结论可靠的？',
        purpose: '核实证据意识与判断边界。',
      },
    ],
  };
}

void test('recognizes explicit interviewer and candidate labels in common transcript formats', () => {
  assert.equal(hasReviewableSpeakerLabels(transcript), true);
  assert.equal(
    hasReviewableSpeakerLabels('面试官：请介绍项目\n只有未标记的回答'),
    false,
  );
  assert.equal(hasReviewableSpeakerLabels('候选人：只有回答'), false);
});

void test('validates a fixed qualitative interviewer review with role-owned quotes', () => {
  const result = validateInterviewerReview(availableReview(), transcript);
  assert.equal(result.status, 'available');
  assert.deepEqual(
    result.dimensions.map(({ name }) => name),
    interviewerReviewDimensions,
  );
  assert.equal(result.rewrites[0].improvedQuestion.includes('怎样'), true);
});

void test('rejects quotes attributed to the wrong speaker', () => {
  const review = availableReview();
  assert.throws(
    () =>
      validateInterviewerReview(
        {
          ...review,
          rewrites: [
            {
              ...review.rewrites[0],
              originalQuestion: '我访谈了五位同学，但没有记录完整数据。',
            },
          ],
        },
        transcript,
      ),
    /面试官引用/,
  );
  assert.throws(
    () =>
      validateInterviewerReview(
        {
          ...review,
          missedFollowUps: [
            {
              ...review.missedFollowUps[0],
              candidateSignal: '方便说说你具体访谈了哪些人吗？',
            },
          ],
        },
        transcript,
      ),
    /候选人引用/,
  );
});

void test('requires deterministic unavailable output when speaker labels are incomplete', () => {
  const unavailable = {
    status: 'unavailable',
    reason: 'speaker-labels-missing',
    summary: null,
    dimensions: [],
    strengths: [],
    priorities: [],
    rewrites: [],
    missedFollowUps: [],
  };
  assert.deepEqual(
    validateInterviewerReview(unavailable, '候选人：只有回答'),
    unavailable,
  );
  assert.throws(
    () => validateInterviewerReview(availableReview(), '候选人：只有回答'),
    /说话人标记/,
  );
  assert.throws(
    () => validateInterviewerReview(unavailable, transcript),
    /说话人标记完整/,
  );
});

void test('schema requires the stable fields used by structured Codex output', () => {
  assert.deepEqual(interviewerReviewSchema.required, [
    'status',
    'reason',
    'summary',
    'dimensions',
    'strengths',
    'priorities',
    'rewrites',
    'missedFollowUps',
  ]);
  assert.equal(interviewerReviewSchema.additionalProperties, false);
});
