import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyOutlineV3Supplement,
  outlineV3SupplementSchema,
  validateOutlineV3Supplement,
} from '../lib/outline-v3-supplement.ts';
import {
  calculateOutlineCoverageV3,
  type InterviewOutlineV3,
  type InterviewQuestionV3,
} from '../lib/interview-outline-v3.ts';

const dimensions = [
  '岗位一',
  '岗位二',
  '岗位三',
  '岗位四',
  '自驱',
  '学习',
  '挑战',
  '协作',
];
const question = (
  id: string,
  primaryDimension: string,
  required: boolean,
  source: InterviewQuestionV3['source'] = 'role',
): InterviewQuestionV3 => ({
  id,
  question: `这是一道自然友好的问题${id}？`,
  required,
  estimatedMinutes: required ? 5 : 4,
  primaryDimension,
  secondaryDimensions: [],
  source,
  goal: '核实具体判断',
  resumeEvidence: null,
  workSampleEvidence: null,
  listenFor: ['具体行动'],
  riskSignals: ['缺少依据'],
  probes: [{ condition: '回答笼统', question: '你当时先做了什么？' }],
});

function outline(): InterviewOutlineV3 {
  const requiredQuestions = [
    question('q1', dimensions[4], true),
    question('q2', dimensions[5], true),
    question('q3', dimensions[6], true),
    question('q4', dimensions[7], true),
    {
      ...question('q5', dimensions[0], true),
      secondaryDimensions: [dimensions[1]],
    },
    {
      ...question('q6', dimensions[2], true),
      secondaryDimensions: [dimensions[3]],
    },
  ];
  const reserveQuestions = [
    question('r1', dimensions[0], false),
    question('r2', dimensions[1], false),
  ];
  return {
    version: 3,
    estimatedMinutes: 30,
    requiredQuestions,
    reserveQuestions,
    archivedReserveQuestions: [],
    coverage: calculateOutlineCoverageV3(
      [...requiredQuestions, ...reserveQuestions],
      dimensions,
    ),
  };
}

void test('V3 补充流程用两道复盘题替换两道候选题', () => {
  const original = outline();
  const questions = [
    question('w1', dimensions[0], false, 'written-test'),
    question('w2', dimensions[2], false, 'written-test'),
  ];
  const result = validateOutlineV3Supplement(
    { version: 3, kind: 'written-test', questions },
    { kind: 'written-test', outline: original, dimensions },
  );
  const next = applyOutlineV3Supplement(original, result);
  assert.equal(next.requiredQuestions.length, 6);
  assert.deepEqual(next.reserveQuestions, questions);
  assert.deepEqual(next.archivedReserveQuestions, original.reserveQuestions);
  assert.equal(
    outlineV3SupplementSchema('written-test').properties.questions.maxItems,
    2,
  );
});

void test('V3 补充流程拒绝三道候选题', () => {
  const original = outline();
  const questions = ['w1', 'w2', 'w3'].map((id, index) =>
    question(id, dimensions[index], false, 'written-test'),
  );
  assert.throws(
    () =>
      validateOutlineV3Supplement(
        { version: 3, kind: 'written-test', questions },
        { kind: 'written-test', outline: original, dimensions },
      ),
    /两道候选题/,
  );
});
