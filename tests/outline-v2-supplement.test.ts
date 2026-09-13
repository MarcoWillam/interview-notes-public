import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOutlineV2Supplement,
  validateOutlineV2Supplement,
} from '../lib/outline-v2-supplement.ts';
import {
  calculateOutlineCoverage,
  type InterviewOutlineV2,
  type InterviewQuestionV2,
} from '../lib/interview-outline-v2.ts';

const dimensions = [
  '用户洞察与问题定义',
  '产品方案与范围取舍',
  'AI 理解与产品化判断',
  '数据验证与迭代意识',
  '自驱力与结果闭环',
  '学习力',
  '挑战力与韧性',
  '团队精神与沟通协作',
];

function question(
  id: string,
  primaryDimension: string,
  required: boolean,
): InterviewQuestionV2 {
  return {
    id,
    question: `请说明${id.includes('work') ? '作品' : id.includes('written') ? '笔试' : '经历'}${id.slice(-1)}的关键判断`,
    required,
    estimatedMinutes: required ? 6 : 4,
    primaryDimension,
    secondaryDimensions: [],
    source: 'role',
    goal: '核实候选人的具体判断',
    resumeEvidence: null,
    workSampleEvidence: null,
    listenFor: ['具体判断依据'],
    riskSignals: ['只描述团队结论'],
    probes: [{ condition: '依据不清楚', question: '你当时如何验证？' }],
  };
}

function currentOutline(): InterviewOutlineV2 {
  const questions = dimensions.map((dimension, index) =>
    question(`原题${index + 1}`, dimension, index < 5),
  );
  return {
    version: 2,
    estimatedMinutes: 30,
    requiredQuestions: questions.slice(0, 5),
    reserveQuestions: questions.slice(5),
    archivedReserveQuestions: [],
    coverage: calculateOutlineCoverage(questions, dimensions),
  };
}

function supplementQuestions(
  kind: 'written-test' | 'work-sample',
  generation = 1,
): InterviewQuestionV2[] {
  return dimensions.slice(5).map((dimension, index) => ({
    ...question(`${kind}-${generation}-${index + 1}`, dimension, false),
    source: kind,
    workSampleEvidence:
      kind === 'work-sample'
        ? { path: `src/answer-${index + 1}.ts`, excerpt: '关键方案实现' }
        : null,
  }));
}

void test('V2 后补笔试用三道新题替换候选区并归档旧题', () => {
  const outline = currentOutline();
  const result = validateOutlineV2Supplement(
    {
      version: 2,
      kind: 'written-test',
      questions: supplementQuestions('written-test'),
    },
    { kind: 'written-test', outline, dimensions },
  );
  const next = applyOutlineV2Supplement(outline, result);
  assert.deepEqual(next.reserveQuestions, supplementQuestions('written-test'));
  assert.deepEqual(next.archivedReserveQuestions, outline.reserveQuestions);
  assert.deepEqual(next.requiredQuestions, outline.requiredQuestions);
  assert.deepEqual(
    next.coverage,
    calculateOutlineCoverage(
      [...next.requiredQuestions, ...next.reserveQuestions],
      dimensions,
    ),
  );
});

void test('V2 补充拒绝错误题量、标记、来源、维度和重复主问题', () => {
  const outline = currentOutline();
  const valid = supplementQuestions('written-test');
  const context = { kind: 'written-test' as const, outline, dimensions };
  for (const questions of [
    valid.slice(1),
    [...valid, valid[0]],
    [{ ...valid[0], required: true }, ...valid.slice(1)],
    [{ ...valid[0], source: 'role' as const }, ...valid.slice(1)],
    [{ ...valid[0], primaryDimension: '未知维度' }, ...valid.slice(1)],
    [
      { ...valid[0], question: outline.requiredQuestions[0].question },
      ...valid.slice(1),
    ],
  ])
    assert.throws(() =>
      validateOutlineV2Supplement(
        { version: 2, kind: 'written-test', questions },
        context,
      ),
    );
});

void test('V2 补充题不能复用当前或历史候选题编号', () => {
  const outline = currentOutline();
  outline.archivedReserveQuestions = [
    question('历史候选题-1', dimensions[5], false),
  ];
  const currentCollision = supplementQuestions('written-test');
  currentCollision[0] = {
    ...currentCollision[0],
    id: outline.reserveQuestions[0].id,
  };
  const archivedCollision = supplementQuestions('written-test');
  archivedCollision[0] = {
    ...archivedCollision[0],
    id: outline.archivedReserveQuestions[0].id,
  };
  for (const questions of [currentCollision, archivedCollision])
    assert.throws(
      () =>
        validateOutlineV2Supplement(
          { version: 2, kind: 'written-test', questions },
          { kind: 'written-test', outline, dimensions },
        ),
      /重复/,
    );
});

void test('V2 补充题替换候选区后仍须覆盖全部八项维度', () => {
  const outline = currentOutline();
  const questions = supplementQuestions('written-test').map(
    (item, index) => ({
      ...item,
      id: `coverage-gap-${index + 1}`,
      question: `请说明验证方案${index + 1}的关键判断`,
      primaryDimension: dimensions[5],
      secondaryDimensions: [],
    }),
  );
  assert.throws(
    () =>
      validateOutlineV2Supplement(
        { version: 2, kind: 'written-test', questions },
        { kind: 'written-test', outline, dimensions },
      ),
    /全部覆盖/,
  );
});

void test('V2 作品补充要求安全相对路径和逐字文件依据', () => {
  const outline = currentOutline();
  const valid = supplementQuestions('work-sample');
  const context = { kind: 'work-sample' as const, outline, dimensions };
  assert.equal(
    validateOutlineV2Supplement(
      { version: 2, kind: 'work-sample', questions: valid },
      context,
    ).questions.length,
    3,
  );
  assert.throws(() =>
    validateOutlineV2Supplement(
      {
        version: 2,
        kind: 'work-sample',
        questions: [
          { ...valid[0], workSampleEvidence: null },
          ...valid.slice(1),
        ],
      },
      context,
    ),
  );
  assert.throws(() =>
    validateOutlineV2Supplement(
      {
        version: 2,
        kind: 'work-sample',
        questions: [
          {
            ...valid[0],
            workSampleEvidence: { path: '../secret.txt', excerpt: 'x' },
          },
          ...valid.slice(1),
        ],
      },
      context,
    ),
  );
});

void test('再次补充会累计且按编号去重归档候选题历史', () => {
  const outline = currentOutline();
  const first = applyOutlineV2Supplement(outline, {
    version: 2,
    kind: 'written-test',
    questions: supplementQuestions('written-test'),
  });
  const second = applyOutlineV2Supplement(first, {
    version: 2,
    kind: 'work-sample',
    questions: supplementQuestions('work-sample'),
  });
  assert.deepEqual(second.archivedReserveQuestions, [
    ...outline.reserveQuestions,
    ...supplementQuestions('written-test'),
  ]);
  const repeated = applyOutlineV2Supplement(second, {
    version: 2,
    kind: 'written-test',
    questions: supplementQuestions('written-test', 2),
  });
  assert.equal(
    new Set(repeated.archivedReserveQuestions.map(({ id }) => id)).size,
    9,
  );
});
