import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportWrittenTestSupplement,
  validateWrittenTestSupplement,
  validateWrittenTestSupplementInput,
  writtenTestSupplementInstructionsFor,
  writtenTestSupplementInstructions,
  writtenTestSupplementOutputSchema,
  writtenTestSupplementSchema,
} from '../lib/written-test-supplement.ts';
import {
  calculateOutlineCoverage,
  type InterviewOutlineV2,
  type InterviewQuestionV2,
} from '../lib/interview-outline-v2.ts';
import { builtInRoleTemplates } from '../lib/default-role-templates.ts';

const resumeText = '姓名：张晓明\n负责 AI 助手的用户访谈与方案设计。';
const standards = {
  role: 'AI 产品经理（校招）',
  requirements: '理解用户问题并设计 AI 产品方案。',
  dimensionText: '用户洞察、产品判断、AI 理解、自驱力',
  focus: '重点考察自驱力。',
  scoringGuidance: '依据具体判断与取舍。',
  reportRequirements: '明确待核实事项。',
};
const existingQuestions = [
  '请讲一次你主动发现用户问题的经历。',
  '你如何把模糊需求转化为清晰问题？',
  '请讲一次你推动 AI 产品方案落地的经历。',
  '请讲一次你快速学习陌生领域的经历。',
  '请讲一次你与团队出现分歧的经历。',
  '请讲一次项目失败后的复盘。',
].map((question, index) => ({
  question,
  questionSource: index === 0 ? ('resume' as const) : ('role' as const),
  dimensions: [index === 0 ? '用户洞察' : '自驱力'],
  reason: '核实候选人的具体判断与行动。',
  resumeEvidence: index === 0 ? '负责 AI 助手的用户访谈与方案设计。' : null,
  listenFor: ['候选人自己的行动'],
  probes: ['你为什么这样判断？'],
}));

const rawInput = { ...standards, resumeText, existingQuestions };
const questions = [
  {
    question:
      '请复述你在笔试中如何定义核心用户问题，并说明排除了哪些次要问题。',
    questionSource: 'written-test' as const,
    dimensions: ['用户洞察', '产品判断'],
    reason: '核实问题定义与用户理解。',
    resumeEvidence: null,
    listenFor: ['问题边界', '用户证据'],
    probes: ['如果时间减半，你会保留什么？'],
  },
  {
    question: '请复述笔试方案中 AI 的核心价值，以及人与 AI 的责任边界。',
    questionSource: 'written-test' as const,
    dimensions: ['AI 理解'],
    reason: '核实 AI 价值与责任边界。',
    resumeEvidence: null,
    listenFor: ['AI 必要性', '用户控制'],
    probes: ['AI 失败时如何降级？'],
  },
  {
    question: '请说明你会如何验证笔试方案中最关键的产品假设。',
    questionSource: 'written-test' as const,
    dimensions: ['产品判断', '自驱力'],
    reason: '核实验证优先级与主动推进意识。',
    resumeEvidence: null,
    listenFor: ['关键指标', '最小验证'],
    probes: ['什么结果会让你停止该方案？'],
  },
];

void test('validates a full supplement snapshot and exactly three review questions', () => {
  const input = validateWrittenTestSupplementInput(rawInput);
  assert.deepEqual(input, rawInput);
  assert.deepEqual(validateWrittenTestSupplement({ questions }, input), {
    questions,
  });
});

void test('rejects invalid original outlines and malformed supplement questions', () => {
  assert.throws(() =>
    validateWrittenTestSupplementInput({
      ...rawInput,
      existingQuestions: existingQuestions.slice(0, 5),
    }),
  );
  const input = validateWrittenTestSupplementInput(rawInput);
  for (const invalid of [
    questions.slice(0, 2),
    [...questions, questions[0]],
    [{ ...questions[0], questionSource: 'role' }, ...questions.slice(1)],
    [{ ...questions[0], dimensions: ['未知维度'] }, ...questions.slice(1)],
    [
      { ...questions[0], resumeEvidence: '姓名：张晓明' },
      ...questions.slice(1),
    ],
    [{ ...questions[0], probes: [] }, ...questions.slice(1)],
    [{ ...questions[0], listenFor: [] }, ...questions.slice(1)],
    [questions[0], questions[0], questions[2]],
    [
      { ...questions[0], question: existingQuestions[0].question },
      ...questions.slice(1),
    ],
    [
      { ...questions[0], reason: '根据答卷，你已经展现出优秀判断。' },
      ...questions.slice(1),
    ],
  ])
    assert.throws(() =>
      validateWrittenTestSupplement({ questions: invalid }, input),
    );
});

void test('schema, prompt and markdown describe only the three-question supplement', () => {
  assert.equal(writtenTestSupplementSchema.properties.questions.minItems, 3);
  assert.equal(writtenTestSupplementSchema.properties.questions.maxItems, 3);
  assert.match(writtenTestSupplementInstructions, /没有看到候选人的实际答卷/);
  const markdown = exportWrittenTestSupplement(questions);
  assert.ok(markdown.startsWith('## 笔试复盘补充'));
  assert.deepEqual(
    [...markdown.matchAll(/^### (\d+)\. /gm)].map((match) => match[1]),
    ['7', '8', '9'],
  );
  assert.ok(markdown.includes(questions[2].question));
  assert.ok(markdown.includes('观察点：'));
  assert.ok(markdown.includes('追问：'));
});

function v2Outline(): InterviewOutlineV2 {
  const template = builtInRoleTemplates[0];
  const dimensions = template.dimensionText.split('、');
  const order = [4, 0, 1, 2, 3, 5, 6, 7];
  const all: InterviewQuestionV2[] = order.map((dimensionIndex, index) => ({
    id: `outline-${index + 1}`,
    question: `请说明经历${index + 1}的关键判断`,
    required: index < 5,
    estimatedMinutes: index < 5 ? 6 : 4,
    primaryDimension: dimensions[dimensionIndex],
    secondaryDimensions: [],
    source: 'role',
    goal: '核实具体判断和行动',
    resumeEvidence: null,
    workSampleEvidence: null,
    listenFor: ['个人判断依据'],
    riskSignals: ['只描述团队结论'],
    probes: [{ condition: '依据不清楚', question: '你怎样验证？' }],
  }));
  return {
    version: 2,
    estimatedMinutes: 30,
    requiredQuestions: all.slice(0, 5),
    reserveQuestions: all.slice(5),
    archivedReserveQuestions: [],
    coverage: calculateOutlineCoverage(all, dimensions),
  };
}

function v2WrittenQuestions(): InterviewQuestionV2[] {
  return builtInRoleTemplates[0].dimensionText
    .split('、')
    .slice(5)
    .map((primaryDimension, index) => ({
      id: `written-${index + 1}`,
      question: `请复述笔试${index + 1}的关键取舍`,
      required: false,
      estimatedMinutes: 4,
      primaryDimension,
      secondaryDimensions: [],
      source: 'written-test',
      goal: '核实候选人自己的判断',
      resumeEvidence: null,
      workSampleEvidence: null,
      listenFor: ['判断依据'],
      riskSignals: ['声称不记得取舍'],
      probes: [{ condition: '判断不清楚', question: '你为何这样选择？' }],
    }));
}

void test('V2 written-test supplement uses the current outline and a separate strict contract', () => {
  const template = builtInRoleTemplates[0];
  const raw = {
    ...template,
    resumeText,
    outlineVersion: 2 as const,
    outline: v2Outline(),
  };
  const input = validateWrittenTestSupplementInput(raw);
  const output = {
    version: 2 as const,
    kind: 'written-test' as const,
    questions: v2WrittenQuestions(),
  };
  assert.deepEqual(validateWrittenTestSupplement(output, input), output);
  assert.ok(writtenTestSupplementOutputSchema(2).required.includes('version'));
  assert.ok(!('outline' in writtenTestSupplementOutputSchema(2).properties));
  assert.match(writtenTestSupplementInstructionsFor(2), /候选题/);
  assert.doesNotMatch(writtenTestSupplementInstructionsFor(2), /六道题/);
});
