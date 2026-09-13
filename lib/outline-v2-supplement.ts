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
  const requiredIds = new Set(
    input.outline.requiredQuestions.map((question) => question.id),
  );
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
        requiredIds.has(question.id) || requiredText.has(question.question),
    )
  )
    throw new Error('V2 补充题不能与必问题或彼此重复。');
  return { version: 2, kind: input.kind, questions };
}

export function applyOutlineV2Supplement(
  outline: InterviewOutlineV2,
  result: OutlineV2SupplementResult,
): InterviewOutlineV2 {
  const archivedById = new Map(
    [...outline.archivedReserveQuestions, ...outline.reserveQuestions].map(
      (question) => [question.id, question],
    ),
  );
  const reserveQuestions = result.questions.map((question) => ({
    ...question,
  }));
  return {
    ...outline,
    requiredQuestions: outline.requiredQuestions.map((question) => ({
      ...question,
    })),
    reserveQuestions,
    archivedReserveQuestions: [...archivedById.values()],
    coverage: calculateOutlineCoverage(
      [...outline.requiredQuestions, ...reserveQuestions],
      outline.coverage.map(({ dimension }) => dimension),
    ),
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
