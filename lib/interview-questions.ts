export type QuestionSource = 'resume' | 'written-test' | 'role';

export type InterviewQuestion = {
  question: string;
  questionSource?: QuestionSource;
  dimensions: string[];
  reason: string;
  resumeEvidence: string | null;
  listenFor: string[];
  probes: string[];
};

function boundedText(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max || !value.trim())
    throw new Error('面试问题内容为空或超过长度限制。');
  return value.trim();
}

function stringList(
  value: unknown,
  min: number,
  max: number,
  itemMax: number,
): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new Error('面试问题列表长度不正确。');
  return value.map((item) => boundedText(item, itemMax));
}

export function validateQuestionItems(
  value: unknown,
  options: {
    expectedCount: number;
    allowedDimensions: Set<string>;
    allowedSources: Set<QuestionSource>;
    resumeText: string;
  },
): InterviewQuestion[] {
  if (!Array.isArray(value) || value.length !== options.expectedCount)
    throw new Error(`面试问题必须包含 ${options.expectedCount} 道。`);
  const questions = value.map((item: unknown) => {
    if (!item || typeof item !== 'object')
      throw new Error('面试问题格式不正确。');
    const question = item as Record<string, unknown>;
    const questionSource = question.questionSource as
      | QuestionSource
      | undefined;
    if (!questionSource || !options.allowedSources.has(questionSource))
      throw new Error('面试问题来源不正确。');
    const dimensions = stringList(question.dimensions, 1, 2, 60);
    if (
      dimensions.some((dimension) =>
        !options.allowedDimensions.has(dimension),
      )
    )
      throw new Error('面试问题包含未知评估维度。');
    const resumeEvidence = question.resumeEvidence;
    if (resumeEvidence !== null) {
      boundedText(resumeEvidence, 2000);
      if (!options.resumeText.includes(resumeEvidence as string))
        throw new Error('面试问题引用无法在简历原文中找到。');
    }
    if (questionSource === 'resume' && resumeEvidence === null)
      throw new Error('简历经历题必须包含原文依据。');
    if (questionSource !== 'resume' && resumeEvidence !== null)
      throw new Error('非简历题不能引用简历原文。');
    return {
      question: boundedText(question.question, 1000),
      questionSource,
      dimensions,
      reason: boundedText(question.reason, 2000),
      resumeEvidence: resumeEvidence as string | null,
      listenFor: stringList(question.listenFor, 1, 3, 1000),
      probes: stringList(question.probes, 1, 2, 1000),
    };
  });
  if (
    new Set(questions.map((question) => question.question)).size !==
    questions.length
  )
    throw new Error('面试问题不能重复。');
  return questions;
}

export const interviewQuestionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'question',
    'questionSource',
    'dimensions',
    'reason',
    'resumeEvidence',
    'listenFor',
    'probes',
  ],
  properties: {
    question: { type: 'string', minLength: 1, maxLength: 1000 },
    questionSource: {
      type: 'string',
      enum: ['resume', 'written-test', 'role'],
    },
    dimensions: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: { type: 'string', minLength: 1, maxLength: 60 },
    },
    reason: { type: 'string', minLength: 1, maxLength: 2000 },
    resumeEvidence: {
      type: ['string', 'null'],
      minLength: 1,
      maxLength: 2000,
    },
    listenFor: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: { type: 'string', minLength: 1, maxLength: 1000 },
    },
    probes: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: { type: 'string', minLength: 1, maxLength: 1000 },
    },
  },
};
