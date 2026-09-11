import {
  interviewQuestionSchema,
  validateQuestionItems,
  type InterviewQuestion,
} from './interview-questions.ts';
import {
  normalizeStandards,
  validateStandards,
  type InterviewStandards,
} from './standards.ts';

export type WrittenTestSupplementInput = InterviewStandards & {
  resumeText: string;
  existingQuestions: InterviewQuestion[];
};
export type WrittenTestSupplementResult = {
  questions: InterviewQuestion[];
};

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max || !value.trim())
    throw new Error('笔试复盘资料为空或超过长度限制。');
  return value.trim();
}

function dimensions(value: InterviewStandards) {
  return new Set(
    value.dimensionText
      .split(/[、,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function questionText(question: InterviewQuestion) {
  return [
    question.question,
    question.reason,
    ...question.listenFor,
    ...question.probes,
  ].join('\n');
}

export function validateWrittenTestSupplementInput(
  value: unknown,
): WrittenTestSupplementInput {
  if (!value || typeof value !== 'object')
    throw new Error('笔试复盘资料格式不正确。');
  const raw = value as Record<string, unknown>;
  const standards = normalizeStandards(raw);
  validateStandards(standards, false);
  const resumeText = text(raw.resumeText, 30000);
  const existingQuestions = validateQuestionItems(raw.existingQuestions, {
    expectedCount: 6,
    allowedDimensions: dimensions(standards),
    allowedSources: new Set(['resume', 'role']),
    resumeText,
  });
  if (
    existingQuestions.some((question) =>
      /笔试|答卷/.test(questionText(question)),
    )
  )
    throw new Error('原提纲必须是无笔试的常规提纲。');
  return { ...standards, resumeText, existingQuestions };
}

export function validateWrittenTestSupplement(
  value: unknown,
  input: WrittenTestSupplementInput,
  options: { conciseQuestions?: boolean } = {},
): WrittenTestSupplementResult {
  if (!value || typeof value !== 'object')
    throw new Error('笔试复盘结果格式不正确。');
  const questions = validateQuestionItems(
    (value as Record<string, unknown>).questions,
    {
      expectedCount: 3,
      allowedDimensions: dimensions(input),
      allowedSources: new Set(['written-test']),
      resumeText: input.resumeText,
      conciseQuestions: options.conciseQuestions,
    },
  );
  const existing = new Set(
    input.existingQuestions.map((question) => question.question.trim()),
  );
  if (questions.some((question) => existing.has(question.question.trim())))
    throw new Error('补充题不能与原面试提纲重复。');
  if (
    questions.some((question) =>
      /已阅读答卷|根据答卷|从答卷中|你的答案显示/.test(questionText(question)),
    )
  )
    throw new Error('不能声称已经读取候选人答卷。');
  return { questions };
}

export const writtenTestSupplementInstructions =
  '你是 AI 产品经理校招面试准备助手。请基于输入的岗位标准和既有笔试考量框架，只补充三道笔试复盘面试题。三题需共同覆盖问题定义与用户理解、方案范围与取舍、AI 核心价值、人与 AI 的责任边界、用户控制、失败降级和验证假设，要求候选人复述自己的判断、取舍与验证方法。你没有看到候选人的实际答卷，不得声称已经阅读答卷或知道其答案，不得编造答卷细节。新问题不得与 existingQuestions 中的六道题重复。每题 question 必须是可直接念出的 12–30 字短句，只核实一个核心判断，最多一个问号；背景和细节拆入 reason、listenFor 与 probes。questionSource 必须为 written-test，resumeEvidence 和 workSampleEvidence 必须为 null；dimensions 只能使用输入 dimensionText 中的一至两个原名。每题提供提问理由、一至三个观察点和一至两个追问。不评分、不推荐录用，只返回符合结构的 JSON。';

export const writtenTestSupplementSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        ...interviewQuestionSchema,
        properties: {
          ...interviewQuestionSchema.properties,
          questionSource: { type: 'string', enum: ['written-test'] },
          resumeEvidence: { type: 'null' },
        },
      },
    },
  },
};

export function exportWrittenTestSupplement(
  questions: InterviewQuestion[],
): string {
  return [
    '## 笔试复盘补充',
    '',
    '追加 3 道复盘题；系统未读取候选人的实际答卷。',
    ...questions.flatMap((question, index) => [
      '',
      `### ${index + 7}. ${question.question}`,
      '',
      `维度：${question.dimensions.join('、')}`,
      '',
      `提问理由：${question.reason}`,
      '',
      '观察点：',
      '',
      ...question.listenFor.map((item) => '- ' + item),
      '',
      '追问：',
      '',
      ...question.probes.map((item) => '- ' + item),
    ]),
  ].join('\n');
}
