import {
  calculateOutlineCoverage,
  interviewQuestionV2Schema,
  validateInterviewQuestionV2,
  type InterviewOutlineV2,
  type InterviewQuestionV2,
} from './interview-outline-v2.ts';

export type OutlineV2SupplementResult = {
  version: 2;
  kind: 'written-test' | 'work-sample';
  questions: InterviewQuestionV2[];
};

export type OutlineV2SupplementInput = {
  kind: 'written-test' | 'work-sample';
  outline: InterviewOutlineV2;
  dimensions: string[];
};

export function validateOutlineV2Supplement(
  value: unknown,
  input: OutlineV2SupplementInput,
): OutlineV2SupplementResult {
  if (!value || typeof value !== 'object')
    throw new Error('V2 补充题格式不正确。');
  const raw = value as Record<string, unknown>;
  if (raw.version !== 2 || raw.kind !== input.kind)
    throw new Error('V2 补充题版本或类型不正确。');
  if (!Array.isArray(raw.questions) || raw.questions.length !== 3)
    throw new Error('V2 补充题必须包含三道候选题。');
  const questions = raw.questions.map((question) =>
    validateInterviewQuestionV2(question, false, {
      role: 'AI 产品经理（校招）',
      dimensions: input.dimensions,
      resumeText: '',
      requireProductCore: false,
    }),
  );
  if (questions.some((question) => question.source !== input.kind))
    throw new Error('V2 补充题来源与任务类型不一致。');
  const existingQuestions = [
    ...input.outline.requiredQuestions,
    ...input.outline.reserveQuestions,
    ...input.outline.archivedReserveQuestions,
  ];
  const existingIds = new Set(existingQuestions.map((question) => question.id));
  const requiredText = new Set(
    input.outline.requiredQuestions.map((question) => question.question),
  );
  if (
    new Set(questions.map((question) => question.id)).size !==
      questions.length ||
    new Set(questions.map((question) => question.question)).size !==
      questions.length ||
    questions.some(
      (question) =>
        existingIds.has(question.id) || requiredText.has(question.question),
    )
  )
    throw new Error('V2 补充题不能与现有问题或彼此重复。');
  const coverage = calculateOutlineCoverage(
    [...input.outline.requiredQuestions, ...questions],
    input.dimensions,
  );
  if (coverage.some((item) => item.status === 'uncovered'))
    throw new Error('V2 补充题替换候选区后必须保持八项维度全部覆盖。');
  return { version: 2, kind: input.kind, questions };
}

export function applyOutlineV2Supplement(
  outline: InterviewOutlineV2,
  result: OutlineV2SupplementResult,
): InterviewOutlineV2 {
  const existingQuestions = [
    ...outline.requiredQuestions,
    ...outline.reserveQuestions,
    ...outline.archivedReserveQuestions,
  ];
  const existingIds = new Set(existingQuestions.map(({ id }) => id));
  const requiredText = new Set(
    outline.requiredQuestions.map(({ question }) => question),
  );
  if (
    new Set(result.questions.map(({ id }) => id)).size !==
      result.questions.length ||
    new Set(result.questions.map(({ question }) => question)).size !==
      result.questions.length ||
    result.questions.some(
      (question) =>
        existingIds.has(question.id) || requiredText.has(question.question),
    )
  )
    throw new Error('V2 补充题不能与现有问题或彼此重复。');
  const archivedById = new Map(
    [...outline.archivedReserveQuestions, ...outline.reserveQuestions].map(
      (question) => [question.id, question],
    ),
  );
  const reserveQuestions = result.questions.map((question) => ({
    ...question,
  }));
  const dimensions = outline.coverage.map(({ dimension }) => dimension);
  const coverage = calculateOutlineCoverage(
    [...outline.requiredQuestions, ...reserveQuestions],
    dimensions,
  );
  if (coverage.some((item) => item.status === 'uncovered'))
    throw new Error('V2 补充题替换候选区后必须保持八项维度全部覆盖。');
  return {
    ...outline,
    requiredQuestions: outline.requiredQuestions.map((question) => ({
      ...question,
    })),
    reserveQuestions,
    archivedReserveQuestions: [...archivedById.values()],
    coverage,
  };
}

export function outlineV2SupplementSchema(
  kind: 'written-test' | 'work-sample',
) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['version', 'kind', 'questions'],
    properties: {
      version: { type: 'integer', enum: [2] },
      kind: { type: 'string', enum: [kind] },
      questions: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: interviewQuestionV2Schema,
      },
    },
  } as const;
}
