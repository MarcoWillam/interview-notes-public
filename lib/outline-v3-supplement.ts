import {
  calculateOutlineCoverageV3,
  interviewQuestionV3Schema,
  validateInterviewQuestionV3,
  type InterviewOutlineV3,
  type InterviewQuestionV3,
} from './interview-outline-v3.ts';

export type OutlineV3SupplementResult = {
  version: 3;
  kind: 'written-test' | 'work-sample';
  questions: InterviewQuestionV3[];
};

export type OutlineV3SupplementInput = {
  kind: 'written-test' | 'work-sample';
  outline: InterviewOutlineV3;
  dimensions: string[];
};

export function validateOutlineV3Supplement(
  value: unknown,
  input: OutlineV3SupplementInput,
): OutlineV3SupplementResult {
  if (!value || typeof value !== 'object')
    throw new Error('V3 补充题格式不正确。');
  const raw = value as Record<string, unknown>;
  if (raw.version !== 3 || raw.kind !== input.kind)
    throw new Error('V3 补充题版本或类型不正确。');
  if (!Array.isArray(raw.questions) || raw.questions.length !== 2)
    throw new Error('V3 补充题必须包含两道候选题。');
  const questions = raw.questions.map((question) =>
    validateInterviewQuestionV3(question, false, {
      role: 'AI 产品经理（校招）',
      dimensions: input.dimensions,
      resumeText: '',
    }),
  );
  if (questions.some(({ source }) => source !== input.kind))
    throw new Error('V3 补充题来源与任务类型不一致。');
  const existingQuestions = [
    ...input.outline.requiredQuestions,
    ...input.outline.reserveQuestions,
    ...input.outline.archivedReserveQuestions,
  ];
  const existingIds = new Set(existingQuestions.map(({ id }) => id));
  const requiredText = new Set(
    input.outline.requiredQuestions.map(({ question }) => question),
  );
  if (
    new Set(questions.map(({ id }) => id)).size !== questions.length ||
    new Set(questions.map(({ question }) => question)).size !==
      questions.length ||
    questions.some(
      (question) =>
        existingIds.has(question.id) || requiredText.has(question.question),
    )
  )
    throw new Error('V3 补充题不能与现有问题或彼此重复。');
  return { version: 3, kind: input.kind, questions };
}

export function applyOutlineV3Supplement(
  outline: InterviewOutlineV3,
  result: OutlineV3SupplementResult,
): InterviewOutlineV3 {
  const archivedById = new Map(
    [...outline.archivedReserveQuestions, ...outline.reserveQuestions].map(
      (question) => [question.id, question],
    ),
  );
  const reserveQuestions = result.questions.map((question) => ({
    ...question,
  }));
  const dimensions = outline.coverage.map(({ dimension }) => dimension);
  return {
    ...outline,
    requiredQuestions: outline.requiredQuestions.map((question) => ({
      ...question,
    })),
    reserveQuestions,
    archivedReserveQuestions: [...archivedById.values()],
    coverage: calculateOutlineCoverageV3(
      [...outline.requiredQuestions, ...reserveQuestions],
      dimensions,
    ),
  };
}

export function outlineV3SupplementSchema(
  kind: 'written-test' | 'work-sample',
) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['version', 'kind', 'questions'],
    properties: {
      version: { type: 'integer', enum: [3] },
      kind: { type: 'string', enum: [kind] },
      questions: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: interviewQuestionV3Schema,
      },
    },
  } as const;
}
