export type QuestionSource = 'resume' | 'written-test' | 'work-sample' | 'role';

export type WorkSampleEvidence = {
  path: string;
  excerpt: string;
};

export type InterviewQuestion = {
  question: string;
  questionSource?: QuestionSource;
  dimensions: string[];
  reason: string;
  resumeEvidence: string | null;
  workSampleEvidence?: WorkSampleEvidence;
  listenFor: string[];
  probes: string[];
};

export const MIN_MAIN_QUESTION_LENGTH = 12;
export const MAX_MAIN_QUESTION_LENGTH = 30;

function boundedText(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max || !value.trim())
    throw new Error('面试问题内容为空或超过长度限制。');
  return value.trim();
}

export function conciseQuestion(value: unknown): string {
  const result = boundedText(value, 1000);
  const length = Array.from(result).length;
  if (length < MIN_MAIN_QUESTION_LENGTH || length > MAX_MAIN_QUESTION_LENGTH)
    throw new Error('面试主问题必须为 12–30 个字符。');
  if ((result.match(/[?？]/g) || []).length > 1)
    throw new Error('面试主问题只能包含一个问点。');
  const evidenceChain = result.match(/背景|过程|行动|结果|复盘|反思|收获/g);
  const enumerationSeparators = result.match(
    /[、，,]|(?:与|和|及)(?=[\p{Script=Han}]{2,8}(?:[？?。]|$))/gu,
  );
  if (
    (evidenceChain && new Set(evidenceChain).size >= 3) ||
    (enumerationSeparators && enumerationSeparators.length >= 3) ||
    /(?:并|且)(?:说明|分析|介绍|复盘|验证|评估|比较|提出|给出)|以及(?:结果|复盘|反思|验证|评估)|分别(?:说明|介绍|分析|验证|评估)/.test(
      result,
    )
  )
    throw new Error('面试主问题只能包含一个问点。');
  return result;
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

export function safeWorkSamplePath(value: unknown): string {
  const path = boundedText(value, 500).replaceAll('\\', '/');
  if (
    path.startsWith('/') ||
    /^[a-z]:\//i.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('作品证据路径不安全。');
  return path;
}

export function validateWorkSampleEvidence(value: unknown): WorkSampleEvidence {
  if (!value || typeof value !== 'object')
    throw new Error('作品证据格式不正确。');
  const evidence = value as Record<string, unknown>;
  return {
    path: safeWorkSamplePath(evidence.path),
    excerpt: boundedText(evidence.excerpt, 4000),
  };
}

export function validateQuestionItems(
  value: unknown,
  options: {
    expectedCount: number;
    allowedDimensions: Set<string>;
    allowedSources: Set<QuestionSource>;
    resumeText: string;
    conciseQuestions?: boolean;
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
      dimensions.some((dimension) => !options.allowedDimensions.has(dimension))
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
    const workSampleEvidence =
      question.workSampleEvidence === undefined ||
      question.workSampleEvidence === null
        ? undefined
        : validateWorkSampleEvidence(question.workSampleEvidence);
    if (questionSource === 'work-sample' && !workSampleEvidence)
      throw new Error('作品复盘题必须包含文件依据。');
    if (questionSource !== 'work-sample' && workSampleEvidence)
      throw new Error('非作品题不能引用作品文件。');
    return {
      question: options.conciseQuestions
        ? conciseQuestion(question.question)
        : boundedText(question.question, 1000),
      questionSource,
      dimensions,
      reason: boundedText(question.reason, 2000),
      resumeEvidence: resumeEvidence as string | null,
      ...(workSampleEvidence ? { workSampleEvidence } : {}),
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
    'workSampleEvidence',
    'listenFor',
    'probes',
  ],
  properties: {
    question: {
      type: 'string',
      minLength: MIN_MAIN_QUESTION_LENGTH,
      maxLength: MAX_MAIN_QUESTION_LENGTH,
    },
    questionSource: {
      type: 'string',
      enum: ['resume', 'written-test', 'work-sample', 'role'],
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
    workSampleEvidence: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['path', 'excerpt'],
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 500 },
        excerpt: { type: 'string', minLength: 1, maxLength: 4000 },
      },
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
