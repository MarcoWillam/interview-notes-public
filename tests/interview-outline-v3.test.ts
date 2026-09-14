import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateOutlineCoverageV3,
  interviewOutlineV3Schema,
  validateInterviewOutlineV3,
  type InterviewOutlineV3,
  type InterviewQuestionV3,
} from '../lib/interview-outline-v3.ts';
import { resumeOutlineV3Instructions } from '../lib/interview-outline-v3-prompt.ts';

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

const stems = [
  '最近有没有一件没人要求但你主动做的事？',
  '遇到陌生问题时你通常会怎么开始学？',
  '哪件事一度很难推进后来你怎么处理的？',
  '和同伴想法不同时你会怎么推动事情继续？',
  '同学说AI功能不好用你会先了解什么？',
  '为校园设计AI功能时你会从哪里开始？',
  '哪段经历最能说明你理解真实用户？',
  '如果验证结果不理想你会先调整什么？',
];

function question(
  index: number,
  primaryDimension: string,
  required: boolean,
  secondaryDimensions: string[] = [],
): InterviewQuestionV3 {
  return {
    id: `question-${index + 1}`,
    question: stems[index],
    required,
    estimatedMinutes: required ? 5 : 4,
    primaryDimension,
    secondaryDimensions,
    source: 'role',
    goal: '了解候选人的实际思考和行动方式',
    resumeEvidence: null,
    workSampleEvidence: null,
    listenFor: ['候选人自己的行动', '判断依据和后续反思'],
    riskSignals: ['只给结论，无法说明自己的行动'],
    probes: [{ condition: '回答比较笼统', question: '当时你先做了哪一步？' }],
  };
}

function validOutline(): InterviewOutlineV3 {
  const requiredQuestions = [
    question(0, dimensions[4], true),
    question(1, dimensions[5], true),
    question(2, dimensions[6], true),
    question(3, dimensions[7], true),
    question(4, dimensions[0], true, [dimensions[1]]),
    question(5, dimensions[2], true, [dimensions[3]]),
  ];
  const reserveQuestions = [
    question(6, dimensions[0], false),
    question(7, dimensions[3], false),
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

const context = {
  role: 'AI 产品经理（校招）',
  dimensions,
  resumeText: '姓名：林小满。主动组织校园用户访谈。',
  hasWrittenTest: false,
  hasWorkSample: false,
};

void test('V3 校招潜力提纲接受六道必问和两道候选题', () => {
  const outline = validateInterviewOutlineV3(validOutline(), context);
  assert.equal(outline.requiredQuestions.length, 6);
  assert.equal(outline.reserveQuestions.length, 2);
  assert.equal(
    interviewOutlineV3Schema.properties.requiredQuestions.minItems,
    6,
  );
  assert.equal(
    interviewOutlineV3Schema.properties.reserveQuestions.maxItems,
    2,
  );
  assert.equal(
    interviewOutlineV3Schema.properties.reserveQuestions.minItems,
    2,
  );
  assert.throws(
    () =>
      validateInterviewOutlineV3(
        { ...validOutline(), reserveQuestions: [] },
        context,
      ),
    /两道候选题/,
  );
});

void test('V3 前四题主验证通用潜力，后两题主验证岗位潜力', () => {
  const outline = validOutline();
  assert.throws(
    () =>
      validateInterviewOutlineV3(
        {
          ...outline,
          requiredQuestions: outline.requiredQuestions.map((item, index) =>
            index === 1 ? { ...item, primaryDimension: dimensions[0] } : item,
          ),
        },
        context,
      ),
    /前四道必问题.*通用素质/,
  );
  assert.throws(
    () =>
      validateInterviewOutlineV3(
        {
          ...outline,
          requiredQuestions: outline.requiredQuestions.map((item, index) =>
            index === 4 ? { ...item, primaryDimension: dimensions[4] } : item,
          ),
        },
        context,
      ),
    /后两道必问题.*岗位能力/,
  );
});

void test('V3 主问题允许 12–30 字并拒绝生硬面试腔', () => {
  const outline = validOutline();
  assert.throws(
    () =>
      validateInterviewOutlineV3(
        {
          ...outline,
          requiredQuestions: outline.requiredQuestions.map((item, index) =>
            index === 0 ? { ...item, question: '你'.repeat(31) } : item,
          ),
        },
        context,
      ),
    /12–30/,
  );
  assert.throws(
    () =>
      validateInterviewOutlineV3(
        {
          ...outline,
          requiredQuestions: outline.requiredQuestions.map((item, index) =>
            index === 0
              ? { ...item, question: '请系统阐述你主动解决问题的完整经历' }
              : item,
          ),
        },
        context,
      ),
    /自然、亲和/,
  );
  assert.throws(
    () =>
      validateInterviewOutlineV3(
        {
          ...outline,
          requiredQuestions: outline.requiredQuestions.map((item, index) =>
            index === 0
              ? { ...item, question: '你当时做了什么，最后结果怎么样？' }
              : item,
          ),
        },
        context,
      ),
    /一个问点/,
  );
  assert.throws(
    () =>
      validateInterviewOutlineV3(
        {
          ...outline,
          requiredQuestions: outline.requiredQuestions.map((item, index) =>
            index === 0
              ? { ...item, question: '你当时做了什么，为什么这样做？' }
              : item,
          ),
        },
        context,
      ),
    /一个问点/,
  );
});

void test('V3 生成指令明确潜力导向和亲和表达', () => {
  assert.match(resumeOutlineV3Instructions, /六道必问题/);
  assert.match(resumeOutlineV3Instructions, /两道候选题/);
  assert.match(resumeOutlineV3Instructions, /12–30/);
  assert.match(resumeOutlineV3Instructions, /亲和/);
  assert.match(resumeOutlineV3Instructions, /校园|课程|社团|个人项目/);
  assert.match(resumeOutlineV3Instructions, /前四道.*通用素质/);
  assert.match(resumeOutlineV3Instructions, /后两道.*岗位潜力/);
  assert.match(resumeOutlineV3Instructions, /用户运营约 60%.*数据增长约 40%/);
});

void test('AI 产品经理有笔试时只让后两道岗位题承担复盘', () => {
  const outline = validOutline();
  const requiredQuestions = outline.requiredQuestions.map((item, index) =>
    index >= 4 ? { ...item, source: 'written-test' as const } : item,
  );
  const validated = validateInterviewOutlineV3(
    {
      ...outline,
      requiredQuestions,
      coverage: calculateOutlineCoverageV3(
        [...requiredQuestions, ...outline.reserveQuestions],
        dimensions,
      ),
    },
    { ...context, hasWrittenTest: true },
  );
  assert.deepEqual(
    validated.requiredQuestions.slice(4).map(({ source }) => source),
    ['written-test', 'written-test'],
  );
});

void test('产品运营潜力提纲不依赖笔试或作品材料', () => {
  const source = validOutline();
  const requiredQuestions = source.requiredQuestions.map((item, index) =>
    index === 4
      ? {
          ...item,
          estimatedMinutes: 6,
          primaryDimension: dimensions[0],
          secondaryDimensions: [dimensions[1], dimensions[2]],
        }
      : index === 5
        ? {
            ...item,
            estimatedMinutes: 4,
            primaryDimension: dimensions[3],
            secondaryDimensions: [],
          }
        : item,
  );
  const candidate = {
    ...source,
    requiredQuestions,
    coverage: calculateOutlineCoverageV3(
      [...requiredQuestions, ...source.reserveQuestions],
      dimensions,
    ),
  };
  const outline = validateInterviewOutlineV3(candidate, {
    ...context,
    role: '产品运营（校招）',
    hasWrittenTest: true,
    hasWorkSample: true,
  });
  assert.equal(
    outline.requiredQuestions.every(({ source }) => source === 'role'),
    true,
  );
  assert.throws(
    () =>
      validateInterviewOutlineV3(
        {
          ...candidate,
          requiredQuestions: candidate.requiredQuestions.map((item, index) =>
            index === 4 ? { ...item, estimatedMinutes: 5 } : item,
          ),
          estimatedMinutes: 29,
        },
        { ...context, role: '产品运营（校招）' },
      ),
    /60%.*40%/,
  );
});

void test('后补笔试可放入候选区并保留六道原必问题', () => {
  const outline = validOutline();
  const reserveQuestions = outline.reserveQuestions.map((item) => ({
    ...item,
    source: 'written-test' as const,
  }));
  const validated = validateInterviewOutlineV3(
    {
      ...outline,
      reserveQuestions,
      coverage: calculateOutlineCoverageV3(
        [...outline.requiredQuestions, ...reserveQuestions],
        dimensions,
      ),
    },
    { ...context, hasWrittenTest: true },
  );
  assert.equal(
    validated.requiredQuestions
      .slice(4)
      .every(({ source }) => source === 'role'),
    true,
  );
  assert.equal(
    validated.reserveQuestions.every(({ source }) => source === 'written-test'),
    true,
  );
});
