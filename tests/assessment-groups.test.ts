import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_PM_PRODUCT_COMPETENCY_NAMES,
  GENERAL_COMPETENCY_NAMES,
  PRODUCT_OPERATIONS_COMPETENCY_NAMES,
  groupAssessmentDimensions,
} from '../lib/assessment-groups.ts';

const dimensions = (names: readonly string[]) =>
  names.map((name, index) => ({ name, score: index + 1 }));

void test('AI product manager assessment shows four general competencies before product competencies', () => {
  const groups = groupAssessmentDimensions(
    'AI 产品经理（校招）',
    dimensions([
      ...AI_PM_PRODUCT_COMPETENCY_NAMES,
      ...GENERAL_COMPETENCY_NAMES,
    ]),
  );
  assert.deepEqual(
    groups.map((group) => ({
      title: group.title,
      names: group.dimensions.map(({ name }) => name),
    })),
    [
      { title: '通用素质能力', names: [...GENERAL_COMPETENCY_NAMES] },
      { title: '产品能力', names: [...AI_PM_PRODUCT_COMPETENCY_NAMES] },
    ],
  );
});

void test('product operations assessment shows general competencies before operations competencies', () => {
  const groups = groupAssessmentDimensions(
    '候选人 · 产品运营（校招）',
    dimensions([
      ...PRODUCT_OPERATIONS_COMPETENCY_NAMES,
      ...GENERAL_COMPETENCY_NAMES,
    ]),
  );
  assert.deepEqual(
    groups.map((group) => ({
      title: group.title,
      names: group.dimensions.map(({ name }) => name),
    })),
    [
      { title: '通用素质能力', names: [...GENERAL_COMPETENCY_NAMES] },
      {
        title: '运营能力',
        names: [...PRODUCT_OPERATIONS_COMPETENCY_NAMES],
      },
    ],
  );
});

void test('unsupported, incomplete, duplicate and custom dimension sets keep their original flat order', () => {
  const cases = [
    {
      role: 'AI 研发（校招）',
      names: ['工程基础', '团队精神与沟通协作'],
    },
    {
      role: 'AI 产品经理（校招）',
      names: [
        ...AI_PM_PRODUCT_COMPETENCY_NAMES,
        ...GENERAL_COMPETENCY_NAMES,
      ].slice(0, -1),
    },
    {
      role: 'AI 产品经理（校招）',
      names: [
        ...AI_PM_PRODUCT_COMPETENCY_NAMES,
        ...GENERAL_COMPETENCY_NAMES.slice(0, -1),
        '学习力',
      ],
    },
    {
      role: '自定义产品岗位',
      names: [...AI_PM_PRODUCT_COMPETENCY_NAMES, ...GENERAL_COMPETENCY_NAMES],
    },
  ];
  for (const item of cases) {
    const value = dimensions(item.names);
    assert.deepEqual(groupAssessmentDimensions(item.role, value), [
      { title: null, dimensions: value },
    ]);
  }
});
