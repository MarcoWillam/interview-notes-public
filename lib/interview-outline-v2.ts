export const INTERVIEW_OUTLINE_V2 = 2 as const;
export const V2_REQUIRED_QUESTIONS = 5;
export const V2_MAX_RESERVE_QUESTIONS = 3;
export const V2_MIN_QUESTION_LENGTH = 8;
export const V2_MAX_QUESTION_LENGTH = 24;

export type InterviewQuestionV2 = {
  id: string;
  question: string;
  required: boolean;
  estimatedMinutes: number;
  primaryDimension: string;
  secondaryDimensions: string[];
  source: 'role' | 'resume' | 'written-test' | 'work-sample';
  goal: string;
  resumeEvidence: string | null;
  workSampleEvidence: { path: string; excerpt: string } | null;
  listenFor: string[];
  riskSignals: string[];
  probes: { condition: string; question: string }[];
};

export type InterviewOutlineCoverage = {
  dimension: string;
  primaryQuestionIds: string[];
  secondaryQuestionIds: string[];
  status: 'covered' | 'weak' | 'uncovered';
};

export type InterviewOutlineV2 = {
  version: 2;
  estimatedMinutes: number;
  requiredQuestions: InterviewQuestionV2[];
  reserveQuestions: InterviewQuestionV2[];
  archivedReserveQuestions: InterviewQuestionV2[];
  coverage: InterviewOutlineCoverage[];
};

export type OutlineV2Context = {
  role: string;
  dimensions: string[];
  resumeText: string;
  requireProductCore: boolean;
  hasWrittenTest?: boolean;
  hasWorkSample?: boolean;
};

const sources = new Set<InterviewQuestionV2['source']>([
  'role',
  'resume',
  'written-test',
  'work-sample',
]);

function boundedText(value: unknown, maximum: number, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    throw new Error(`${label}为空或超过长度限制。`);
  return value.trim();
}

function stringList(
  value: unknown,
  minimum: number,
  maximum: number,
  itemMaximum: number,
  label: string,
) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    throw new Error(`${label}数量不正确。`);
  return value.map((item) => boundedText(item, itemMaximum, label));
}

function mainQuestion(value: unknown) {
  const result = boundedText(value, 1000, '面试主问题');
  const length = Array.from(result).length;
  if (length < V2_MIN_QUESTION_LENGTH || length > V2_MAX_QUESTION_LENGTH)
    throw new Error('面试主问题必须为 8–24 个字符。');
  if ((result.match(/[?？]/g) || []).length > 1)
    throw new Error('面试主问题只能包含一个问点。');
  const evidenceChain = result.match(/背景|过程|行动|结果|复盘|反思|收获/g);
  const enumerationSeparators = result.match(/[、，,与和及]/g);
  if (
    (evidenceChain && new Set(evidenceChain).size >= 3) ||
    (enumerationSeparators && enumerationSeparators.length >= 2) ||
    /(?:并|且)(?:说明|分析|介绍|复盘|验证|评估|比较|提出|给出)|以及(?:结果|复盘|反思|验证|评估)|分别(?:说明|介绍|分析|验证|评估)/.test(
      result,
    )
  )
    throw new Error('面试主问题只能包含一个问点。');
  return result;
}

function safeWorkSamplePath(value: unknown) {
  const path = boundedText(value, 500, '作品证据路径').replaceAll('\\', '/');
  if (
    path.startsWith('/') ||
    /^[a-z]:\//i.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('作品证据路径不安全。');
  return path;
}

function validateQuestion(
  value: unknown,
  expectedRequired: boolean,
  context: OutlineV2Context,
): InterviewQuestionV2 {
  if (!value || typeof value !== 'object')
    throw new Error('V2 面试问题格式不正确。');
  const raw = value as Record<string, unknown>;
  if (raw.required !== expectedRequired)
    throw new Error(
      expectedRequired ? '必问题标记不正确。' : '候选题标记不正确。',
    );
  if (
    !Number.isSafeInteger(raw.estimatedMinutes) ||
    Number(raw.estimatedMinutes) < 3 ||
    Number(raw.estimatedMinutes) > 7
  )
    throw new Error('每道问题预计用时必须为 3–7 分钟。');
  const primaryDimension = boundedText(raw.primaryDimension, 60, '主评估维度');
  if (!context.dimensions.includes(primaryDimension))
    throw new Error('面试问题包含未知评估维度。');
  const secondaryDimensions = stringList(
    raw.secondaryDimensions,
    0,
    2,
    60,
    '辅助评估维度',
  );
  if (
    new Set([primaryDimension, ...secondaryDimensions]).size !==
    secondaryDimensions.length + 1
  )
    throw new Error('主维度和辅助维度不能重复。');
  if (secondaryDimensions.some((item) => !context.dimensions.includes(item)))
    throw new Error('面试问题包含未知评估维度。');
  if (!sources.has(raw.source as InterviewQuestionV2['source']))
    throw new Error('面试问题来源不正确。');
  const source = raw.source as InterviewQuestionV2['source'];
  let resumeEvidence: string | null = null;
  if (source === 'resume') {
    resumeEvidence = boundedText(raw.resumeEvidence, 2000, '简历依据');
    if (!context.resumeText.includes(resumeEvidence))
      throw new Error('面试问题引用无法在简历原文中找到。');
  } else if (raw.resumeEvidence !== null) {
    throw new Error('非简历题不能引用简历原文。');
  }
  let workSampleEvidence: InterviewQuestionV2['workSampleEvidence'] = null;
  if (source === 'work-sample') {
    if (!raw.workSampleEvidence || typeof raw.workSampleEvidence !== 'object')
      throw new Error('作品题必须包含文件依据。');
    const evidence = raw.workSampleEvidence as Record<string, unknown>;
    workSampleEvidence = {
      path: safeWorkSamplePath(evidence.path),
      excerpt: boundedText(evidence.excerpt, 4000, '作品依据'),
    };
  } else if (raw.workSampleEvidence !== null) {
    throw new Error('非作品题不能引用作品文件。');
  }
  if (
    !Array.isArray(raw.probes) ||
    raw.probes.length < 1 ||
    raw.probes.length > 2
  )
    throw new Error('条件追问数量不正确。');
  const probes = raw.probes.map((value) => {
    if (!value || typeof value !== 'object')
      throw new Error('条件追问格式不正确。');
    const probe = value as Record<string, unknown>;
    return {
      condition: boundedText(probe.condition, 500, '追问条件'),
      question: boundedText(probe.question, 500, '追问问题'),
    };
  });
  return {
    id: boundedText(raw.id, 100, '问题编号'),
    question: mainQuestion(raw.question),
    required: expectedRequired,
    estimatedMinutes: Number(raw.estimatedMinutes),
    primaryDimension,
    secondaryDimensions,
    source,
    goal: boundedText(raw.goal, 1000, '验证目标'),
    resumeEvidence,
    workSampleEvidence,
    listenFor: stringList(raw.listenFor, 1, 3, 1000, '观察点'),
    riskSignals: stringList(raw.riskSignals, 1, 3, 1000, '风险信号'),
    probes,
  };
}

export function calculateOutlineCoverage(
  questions: InterviewQuestionV2[],
  dimensions: string[],
): InterviewOutlineCoverage[] {
  return dimensions.map((dimension) => {
    const primaryQuestionIds = questions
      .filter((question) => question.primaryDimension === dimension)
      .map((question) => question.id);
    const secondaryQuestionIds = questions
      .filter((question) => question.secondaryDimensions.includes(dimension))
      .map((question) => question.id);
    return {
      dimension,
      primaryQuestionIds,
      secondaryQuestionIds,
      status: primaryQuestionIds.length
        ? 'covered'
        : secondaryQuestionIds.length
          ? 'weak'
          : 'uncovered',
    };
  });
}

export function validateInterviewOutlineV2(
  value: unknown,
  context: OutlineV2Context,
): InterviewOutlineV2 {
  if (!value || typeof value !== 'object')
    throw new Error('V2 面试提纲格式不正确。');
  if (
    context.dimensions.length !== 8 ||
    new Set(context.dimensions).size !== context.dimensions.length
  )
    throw new Error('V2 面试提纲需要八个不同的岗位维度。');
  const raw = value as Record<string, unknown>;
  if (raw.version !== INTERVIEW_OUTLINE_V2)
    throw new Error('V2 面试提纲版本不正确。');
  if (
    !Array.isArray(raw.requiredQuestions) ||
    raw.requiredQuestions.length !== V2_REQUIRED_QUESTIONS
  )
    throw new Error('V2 面试提纲必须包含五道必问题。');
  if (
    !Array.isArray(raw.reserveQuestions) ||
    raw.reserveQuestions.length > V2_MAX_RESERVE_QUESTIONS
  )
    throw new Error('V2 面试候选题不能超过三道。');
  if (!Array.isArray(raw.archivedReserveQuestions))
    throw new Error('历史候选题格式不正确。');
  const requiredQuestions = raw.requiredQuestions.map((question) =>
    validateQuestion(question, true, context),
  );
  const reserveQuestions = raw.reserveQuestions.map((question) =>
    validateQuestion(question, false, context),
  );
  const archivedReserveQuestions = raw.archivedReserveQuestions.map(
    (question) => validateQuestion(question, false, context),
  );
  const activeQuestions = [...requiredQuestions, ...reserveQuestions];
  const allQuestions = [...activeQuestions, ...archivedReserveQuestions];
  if (
    new Set(allQuestions.map((question) => question.id)).size !==
    allQuestions.length
  )
    throw new Error('面试问题编号不能重复。');
  if (
    new Set(activeQuestions.map((question) => question.question)).size !==
    activeQuestions.length
  )
    throw new Error('面试问题不能重复。');
  const requiredSources = requiredQuestions.map((question) => question.source);
  const expectedReviewSource = context.hasWorkSample
    ? 'work-sample'
    : context.hasWrittenTest
      ? 'written-test'
      : undefined;
  if (context.role === '产品运营（校招）') {
    if (
      allQuestions.some(
        (question) =>
          question.source === 'written-test' ||
          question.source === 'work-sample',
      )
    )
      throw new Error('产品运营提纲不能包含笔试或作品复盘题。');
  } else if (context.role === 'AI 产品经理（校招）') {
    if (
      expectedReviewSource &&
      requiredSources
        .slice(1, 4)
        .some((source) => source !== expectedReviewSource)
    )
      throw new Error(
        `第 2–4 题必须为${expectedReviewSource === 'work-sample' ? '作品' : '笔试'}复盘题。`,
      );
    if (
      expectedReviewSource &&
      allQuestions.some(
        (question, index) =>
          question.source === expectedReviewSource &&
          !(index >= 1 && index <= 3),
      )
    )
      throw new Error(
        `只有第 2–4 题可以是${expectedReviewSource === 'work-sample' ? '作品' : '笔试'}复盘题。`,
      );
    if (
      allQuestions.some((question) =>
        context.hasWorkSample
          ? question.source === 'written-test'
          : question.source === 'work-sample',
      )
    )
      throw new Error('提纲问题来源与当前作品状态不一致。');
    if (
      !expectedReviewSource &&
      allQuestions.some(
        (question) =>
          question.source === 'written-test' ||
          question.source === 'work-sample',
      )
    )
      throw new Error('无笔试或作品时不能生成复盘题。');
  }
  const estimatedMinutes = requiredQuestions.reduce(
    (total, question) => total + question.estimatedMinutes,
    0,
  );
  if (estimatedMinutes > 32)
    throw new Error('五道必问题预计用时不能超过 32 分钟。');
  if (raw.estimatedMinutes !== estimatedMinutes)
    throw new Error('提纲预计用时与必问题不一致。');
  const requiredPrimary = new Set(
    requiredQuestions.map((question) => question.primaryDimension),
  );
  if (!requiredPrimary.has('自驱力与结果闭环'))
    throw new Error('自驱力必须由必问题主验证。');
  if (
    context.requireProductCore &&
    context.dimensions
      .slice(0, 4)
      .some((dimension) => !requiredPrimary.has(dimension))
  )
    throw new Error('四项岗位专业能力必须由必问题主验证。');
  const coverage = calculateOutlineCoverage(
    activeQuestions,
    context.dimensions,
  );
  if (coverage.some((item) => item.status === 'uncovered'))
    throw new Error('岗位评估维度没有全部覆盖。');
  if (JSON.stringify(raw.coverage) !== JSON.stringify(coverage))
    throw new Error('能力覆盖矩阵与问题不一致。');
  return {
    version: INTERVIEW_OUTLINE_V2,
    estimatedMinutes,
    requiredQuestions,
    reserveQuestions,
    archivedReserveQuestions,
    coverage,
  };
}

const questionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'question',
    'required',
    'estimatedMinutes',
    'primaryDimension',
    'secondaryDimensions',
    'source',
    'goal',
    'resumeEvidence',
    'workSampleEvidence',
    'listenFor',
    'riskSignals',
    'probes',
  ],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 100 },
    question: {
      type: 'string',
      minLength: V2_MIN_QUESTION_LENGTH,
      maxLength: V2_MAX_QUESTION_LENGTH,
    },
    required: { type: 'boolean' },
    estimatedMinutes: { type: 'integer', minimum: 3, maximum: 7 },
    primaryDimension: { type: 'string', minLength: 1, maxLength: 60 },
    secondaryDimensions: {
      type: 'array',
      minItems: 0,
      maxItems: 2,
      items: { type: 'string', minLength: 1, maxLength: 60 },
    },
    source: {
      type: 'string',
      enum: ['role', 'resume', 'written-test', 'work-sample'],
    },
    goal: { type: 'string', minLength: 1, maxLength: 1000 },
    resumeEvidence: { type: ['string', 'null'], maxLength: 2000 },
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
    riskSignals: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: { type: 'string', minLength: 1, maxLength: 1000 },
    },
    probes: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['condition', 'question'],
        properties: {
          condition: { type: 'string', minLength: 1, maxLength: 500 },
          question: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
    },
  },
} as const;

export const interviewOutlineV2Schema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'version',
    'estimatedMinutes',
    'requiredQuestions',
    'reserveQuestions',
    'archivedReserveQuestions',
    'coverage',
  ],
  properties: {
    version: { type: 'integer', enum: [INTERVIEW_OUTLINE_V2] },
    estimatedMinutes: { type: 'integer', minimum: 15, maximum: 32 },
    requiredQuestions: {
      type: 'array',
      minItems: V2_REQUIRED_QUESTIONS,
      maxItems: V2_REQUIRED_QUESTIONS,
      items: questionSchema,
    },
    reserveQuestions: {
      type: 'array',
      minItems: 0,
      maxItems: V2_MAX_RESERVE_QUESTIONS,
      items: questionSchema,
    },
    archivedReserveQuestions: {
      type: 'array',
      minItems: 0,
      maxItems: 24,
      items: questionSchema,
    },
    coverage: {
      type: 'array',
      minItems: 8,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'dimension',
          'primaryQuestionIds',
          'secondaryQuestionIds',
          'status',
        ],
        properties: {
          dimension: { type: 'string', minLength: 1, maxLength: 60 },
          primaryQuestionIds: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 100 },
          },
          secondaryQuestionIds: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 100 },
          },
          status: { type: 'string', enum: ['covered', 'weak', 'uncovered'] },
        },
      },
    },
  },
} as const;
