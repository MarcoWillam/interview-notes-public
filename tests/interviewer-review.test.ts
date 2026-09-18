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

void test('rejects numeric ratings while allowing ordinary counts in review prose', () => {
  for (const rating of [
    '岗位覆盖为 3/5，经历深挖仍可改进。',
    '岗位覆盖 8 分（满分 10 分）。',
    '问题表达达到 3 级水平。',
    '证据核实为 80%。',
    '经历深挖达到四星。',
    '本轮提问得分约为 80。',
    '整体表现为 4 颗星。',
    '问题表达为两星。',
  ]) {
    const scored = availableReview();
    scored.summary = rating;
    assert.throws(
      () => validateInterviewerReview(scored, transcript),
      /数字评分/,
    );
  }

  const counted = availableReview();
  counted.summary =
    '记录日期为 2026/9/18，覆盖了 4/5 个岗位维度，仍需继续核实。';
  counted.rewrites[0].improvedQuestion =
    '用户满意度只有 3 分，你会如何验证改版有效？';
  counted.missedFollowUps[0].suggestedQuestion =
    '覆盖率只有 80%，你当时怎样判断样本是否足够？';
  counted.dimensions[0].assessment =
    '本轮只有 3 分钟用于经历深挖，仍识别到关键行动。';
  counted.rewrites[0].issue =
    '没有追问用户满意度只有 3 分的原因。';
  counted.rewrites[0].purpose = '评分前还需核实 3 个经历。';
  assert.equal(
    validateInterviewerReview(counted, transcript).status,
    'available',
  );

  const scoredIssue = availableReview();
  scoredIssue.rewrites[0].issue = '这个问题只能打 2 分。';
  assert.throws(
    () => validateInterviewerReview(scoredIssue, transcript),
    /数字评分/,
  );

  const implicitIssueRating = availableReview();
  implicitIssueRating.rewrites[0].issue = '这个问题达到 4/5，仍需改进。';
  assert.throws(
    () => validateInterviewerReview(implicitIssueRating, transcript),
    /数字评分/,
  );

  const implicitPurposeRating = availableReview();
  implicitPurposeRating.rewrites[0].purpose = '改写后仅有 2 分。';
  assert.throws(
    () => validateInterviewerReview(implicitPurposeRating, transcript),
    /数字评分/,
  );

  const implicitDimensionRating = availableReview();
  implicitDimensionRating.dimensions[0].assessment = '达到 80%，仍有缺口。';
  assert.throws(
    () => validateInterviewerReview(implicitDimensionRating, transcript),
    /数字评分/,
  );

  const implicitPriorityRating = availableReview();
  implicitPriorityRating.priorities = ['争取提升到 4/5。'];
  assert.throws(
    () => validateInterviewerReview(implicitPriorityRating, transcript),
    /数字评分/,
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
