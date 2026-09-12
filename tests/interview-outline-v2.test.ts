import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateInterviewOutlineV2,
  type InterviewOutlineV2,
  type InterviewQuestionV2,
  type OutlineV2Context,
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

const resumeEvidence = '负责访谈十二名用户并重新定义问题';

function context(): OutlineV2Context {
  return {
    role: 'AI 产品经理（校招）',
    dimensions,
    resumeText: `项目经历：${resumeEvidence}，完成原型验证。`,
    requireProductCore: true,
  };
}

function question(
  id: string,
  text: string,
  primaryDimension: string,
  required: boolean,
  source: InterviewQuestionV2['source'] = 'role',
): InterviewQuestionV2 {
  return {
    id,
    question: text,
    required,
    estimatedMinutes: required ? 6 : 4,
    primaryDimension,
    secondaryDimensions: [],
    source,
    goal: `核实${primaryDimension}的具体行为`,
    resumeEvidence: source === 'resume' ? resumeEvidence : null,
    workSampleEvidence: null,
    listenFor: ['个人行动', '可验证结果'],
    riskSignals: ['只描述团队成果'],
    probes: [{ condition: '个人行动不清楚', question: '你具体负责了哪一步？' }],
  };
}

function validOutline(): InterviewOutlineV2 {
  const requiredQuestions = [
    question(
      'required-drive',
      '讲讲你主动推动问题落地的经历',
      dimensions[4],
      true,
    ),
    question(
      'required-user',
      '你怎样识别用户的真实问题',
      dimensions[0],
      true,
      'resume',
    ),
    question(
      'required-scope',
      '你如何决定产品范围取舍',
      dimensions[1],
      true,
    ),
    question(
      'required-ai',
      '你如何判断任务是否适合使用AI',
      dimensions[2],
      true,
    ),
    question(
      'required-data',
      '你怎样验证方案是否真正有效',
      dimensions[3],
      true,
    ),
  ];
  const reserveQuestions = [
    question(
      'reserve-learning',
      '你快速掌握新领域的方法是什么',
      dimensions[5],
      false,
    ),
    question(
      'reserve-challenge',
      '最困难的一次项目挑战是什么',
      dimensions[6],
      false,
    ),
    question(
      'reserve-team',
      '你如何推动团队形成一致决定',
      dimensions[7],
      false,
    ),
  ];
  return {
    version: 2,
    estimatedMinutes: 30,
    requiredQuestions,
    reserveQuestions,
    archivedReserveQuestions: [],
    coverage: dimensions.map((dimension) => {
      const primaryQuestionIds = [...requiredQuestions, ...reserveQuestions]
        .filter((item) => item.primaryDimension === dimension)
        .map((item) => item.id);
      return {
        dimension,
        primaryQuestionIds,
        secondaryQuestionIds: [],
        status: 'covered' as const,
      };
    }),
  };
}

void test('V2 提纲接受五道必问和三道候选题', () => {
  const outline = validateInterviewOutlineV2(validOutline(), context());
  assert.equal(outline.version, 2);
  assert.equal(outline.requiredQuestions.length, 5);
  assert.equal(outline.reserveQuestions.length, 3);
  assert.equal(outline.estimatedMinutes, 30);
});

void test('V2 提纲拒绝错误题量和错误必问标记', () => {
  const outline = validOutline();
  assert.throws(
    () =>
      validateInterviewOutlineV2(
        { ...outline, requiredQuestions: outline.requiredQuestions.slice(1) },
        context(),
      ),
    /五道必问题/,
  );
  assert.throws(
    () =>
      validateInterviewOutlineV2(
        {
          ...outline,
          reserveQuestions: [
            ...outline.reserveQuestions,
            question('reserve-extra', '你如何复盘一次失败的尝试', dimensions[5], false),
          ],
        },
        context(),
      ),
    /候选题不能超过三道/,
  );
  assert.throws(
    () =>
      validateInterviewOutlineV2(
        {
          ...outline,
          requiredQuestions: outline.requiredQuestions.map((item, index) =>
            index === 0 ? { ...item, required: false } : item,
          ),
        },
        context(),
      ),
    /必问题标记/,
  );
});

void test('V2 提纲拒绝超长复合问题、重复问题和超时计划', () => {
  const outline = validOutline();
  for (const invalid of [
    '太短吗',
    '请你详细介绍这个项目的背景过程行动结果复盘以及你从中获得的所有经验',
    '你如何定义问题并说明过程以及复盘结果',
  ]) {
    assert.throws(
      () =>
        validateInterviewOutlineV2(
          {
            ...outline,
            requiredQuestions: outline.requiredQuestions.map((item, index) =>
              index === 0 ? { ...item, question: invalid } : item,
            ),
          },
          context(),
        ),
      /主问题|一个问点/,
    );
  }
  assert.throws(
    () =>
      validateInterviewOutlineV2(
        {
          ...outline,
          reserveQuestions: outline.reserveQuestions.map((item, index) =>
            index === 0
              ? { ...item, question: outline.requiredQuestions[0].question }
              : item,
          ),
        },
        context(),
      ),
    /不能重复/,
  );
  assert.throws(
    () =>
      validateInterviewOutlineV2(
        {
          ...outline,
          estimatedMinutes: 35,
          requiredQuestions: outline.requiredQuestions.map((item) => ({
            ...item,
            estimatedMinutes: 7,
          })),
        },
        context(),
      ),
    /32 分钟/,
  );
});

void test('V2 提纲拒绝未知维度、缺失核心主覆盖和伪造覆盖矩阵', () => {
  const outline = validOutline();
  assert.throws(
    () =>
      validateInterviewOutlineV2(
        {
          ...outline,
          reserveQuestions: outline.reserveQuestions.map((item, index) =>
            index === 0 ? { ...item, primaryDimension: '未知维度' } : item,
          ),
        },
        context(),
      ),
    /未知评估维度/,
  );
  assert.throws(
    () =>
      validateInterviewOutlineV2(
        {
          ...outline,
          requiredQuestions: outline.requiredQuestions.map((item) =>
            item.primaryDimension === dimensions[4]
              ? { ...item, primaryDimension: dimensions[5] }
              : item,
          ),
        },
        context(),
      ),
    /自驱力/,
  );
  assert.throws(
    () =>
      validateInterviewOutlineV2(
        {
          ...outline,
          coverage: outline.coverage.map((item, index) =>
            index === 0 ? { ...item, status: 'weak' as const } : item,
          ),
        },
        context(),
      ),
    /覆盖矩阵/,
  );
});

void test('V2 提纲验证来源证据、辅助维度和作品路径', () => {
  const outline = validOutline();
  assert.throws(
    () =>
      validateInterviewOutlineV2(
        {
          ...outline,
          requiredQuestions: outline.requiredQuestions.map((item, index) =>
            index === 1 ? { ...item, resumeEvidence: '简历中不存在' } : item,
          ),
        },
        context(),
      ),
    /简历原文/,
  );
  assert.throws(
    () =>
      validateInterviewOutlineV2(
        {
          ...outline,
          reserveQuestions: outline.reserveQuestions.map((item, index) =>
            index === 0
              ? { ...item, secondaryDimensions: [item.primaryDimension] }
              : item,
          ),
        },
        context(),
      ),
    /维度不能重复/,
  );
  const workQuestion = {
    ...outline.requiredQuestions[1],
    source: 'work-sample' as const,
    resumeEvidence: null,
    workSampleEvidence: { path: '../secret.txt', excerpt: '原文' },
  };
  assert.throws(
    () =>
      validateInterviewOutlineV2(
        {
          ...outline,
          requiredQuestions: outline.requiredQuestions.map((item, index) =>
            index === 1 ? workQuestion : item,
          ),
        },
        context(),
      ),
    /作品证据路径/,
  );
});
