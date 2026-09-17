import type {
  InterviewOutlineCoverage,
  InterviewQuestionV2,
} from './interview-outline-v2.ts';
import { resolveResumeEvidence } from './resume-evidence.ts';

export const INTERVIEW_OUTLINE_V3 = 3 as const;
export const V3_REQUIRED_QUESTIONS = 6;
export const V3_MAX_RESERVE_QUESTIONS = 2;
export const V3_MIN_QUESTION_LENGTH = 12;
export const V3_MAX_QUESTION_LENGTH = 30;

export type InterviewQuestionV3 = InterviewQuestionV2;
export type InterviewOutlineV3 = {
  version: 3;
  estimatedMinutes: number;
  requiredQuestions: InterviewQuestionV3[];
  reserveQuestions: InterviewQuestionV3[];
  archivedReserveQuestions: InterviewQuestionV3[];
  coverage: InterviewOutlineCoverage[];
};

export type OutlineV3Context = {
  role: string;
  dimensions: string[];
  resumeText: string;
  hasWrittenTest?: boolean;
  hasWorkSample?: boolean;
  allowExistingReviewSources?: boolean;
};

const sources = new Set<InterviewQuestionV3['source']>([
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
  if (length < V3_MIN_QUESTION_LENGTH || length > V3_MAX_QUESTION_LENGTH)
    throw new Error('面试主问题必须为 12–30 个字符。');
  if ((result.match(/[?？]/g) || []).length > 1)
    throw new Error('面试主问题只能包含一个问点。');
  if (/请(?:举例说明|系统阐述|详细介绍|全面分析)|证明你|谈谈你的/.test(result))
    throw new Error('面试主问题需要使用自然、亲和的表达。');
  const evidenceChain = result.match(/背景|过程|行动|结果|复盘|反思|收获/g);
  const interrogativeClauses = result
    .split(/[，,；;]/)
    .filter((clause) =>
      /什么|为什么|为何|怎么|如何|哪|是否|有没有|吗|呢/.test(clause),
    );
  if (
    (evidenceChain && new Set(evidenceChain).size >= 3) ||
    interrogativeClauses.length >= 2 ||
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

export function validateInterviewQuestionV3(
  value: unknown,
  expectedRequired: boolean,
  context: OutlineV3Context,
): InterviewQuestionV3 {
  if (!value || typeof value !== 'object')
    throw new Error('V3 面试问题格式不正确。');
  const raw = value as Record<string, unknown>;
  if (raw.required !== expectedRequired)
    throw new Error(
      expectedRequired ? '必问题标记不正确。' : '候选题标记不正确。',
    );
  if (
    !Number.isSafeInteger(raw.estimatedMinutes) ||
    Number(raw.estimatedMinutes) < 3 ||
    Number(raw.estimatedMinutes) > 6
  )
    throw new Error('每道问题预计用时必须为 3–6 分钟。');
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
  if (!sources.has(raw.source as InterviewQuestionV3['source']))
    throw new Error('面试问题来源不正确。');
  const source = raw.source as InterviewQuestionV3['source'];
  let resumeEvidence: string | null = null;
  if (source === 'resume') {
    const submittedEvidence = boundedText(raw.resumeEvidence, 2000, '简历依据');
    resumeEvidence = resolveResumeEvidence(
      context.resumeText,
      submittedEvidence,
    );
    if (!resumeEvidence) throw new Error('面试问题引用无法在简历原文中找到。');
  } else if (raw.resumeEvidence !== null) {
    throw new Error('非简历题不能引用简历原文。');
  }
  let workSampleEvidence: InterviewQuestionV3['workSampleEvidence'] = null;
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

export function calculateOutlineCoverageV3(
  questions: InterviewQuestionV3[],
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

export function validateInterviewOutlineV3(
  value: unknown,
  context: OutlineV3Context,
): InterviewOutlineV3 {
  if (!value || typeof value !== 'object')
    throw new Error('V3 面试提纲格式不正确。');
  if (
    context.dimensions.length !== 8 ||
    new Set(context.dimensions).size !== context.dimensions.length
  )
    throw new Error('V3 面试提纲需要八个不同的岗位维度。');
  const raw = value as Record<string, unknown>;
  if (raw.version !== INTERVIEW_OUTLINE_V3)
    throw new Error('V3 面试提纲版本不正确。');
  if (
    !Array.isArray(raw.requiredQuestions) ||
    raw.requiredQuestions.length !== V3_REQUIRED_QUESTIONS
  )
    throw new Error('V3 面试提纲必须包含六道必问题。');
  if (
    !Array.isArray(raw.reserveQuestions) ||
    raw.reserveQuestions.length !== V3_MAX_RESERVE_QUESTIONS
  )
    throw new Error('V3 面试提纲必须包含两道候选题。');
  if (!Array.isArray(raw.archivedReserveQuestions))
    throw new Error('历史候选题格式不正确。');
  const requiredQuestions = raw.requiredQuestions.map((question) =>
    validateInterviewQuestionV3(question, true, context),
  );
  const reserveQuestions = raw.reserveQuestions.map((question) =>
    validateInterviewQuestionV3(question, false, context),
  );
  const archivedReserveQuestions = raw.archivedReserveQuestions.map(
    (question) => validateInterviewQuestionV3(question, false, context),
  );
  const activeQuestions = [...requiredQuestions, ...reserveQuestions];
  const allQuestions = [...activeQuestions, ...archivedReserveQuestions];
  if (new Set(allQuestions.map(({ id }) => id)).size !== allQuestions.length)
    throw new Error('面试问题编号不能重复。');
  if (
    new Set(activeQuestions.map(({ question }) => question)).size !==
    activeQuestions.length
  )
    throw new Error('面试问题不能重复。');

  const generalDimensions = context.dimensions.slice(4);
  if (
    requiredQuestions
      .slice(0, 4)
      .some(
        (question, index) =>
          question.primaryDimension !== generalDimensions[index],
      )
  )
    throw new Error('前四道必问题必须依次主验证四项通用素质。');
  const roleDimensions = context.dimensions.slice(0, 4);
  const roleQuestions = requiredQuestions.slice(4);
  if (
    roleQuestions.some(
      ({ primaryDimension }) => !roleDimensions.includes(primaryDimension),
    )
  )
    throw new Error('后两道必问题必须主验证岗位能力与岗位潜力。');
  const roleCoverage = new Set(
    roleQuestions.flatMap((question) => [
      question.primaryDimension,
      ...question.secondaryDimensions,
    ]),
  );
  if (roleDimensions.some((dimension) => !roleCoverage.has(dimension)))
    throw new Error('后两道岗位潜力题需要共同覆盖四项岗位能力。');

  const expectedReviewSource = context.hasWorkSample
    ? 'work-sample'
    : context.hasWrittenTest
      ? 'written-test'
      : undefined;
  if (context.role === '产品运营（校招）') {
    if (
      allQuestions.some(
        ({ source }) => source === 'written-test' || source === 'work-sample',
      )
    )
      throw new Error('产品运营提纲不能包含笔试或作品复盘题。');
    if (
      !roleDimensions.slice(0, 3).includes(roleQuestions[0].primaryDimension) ||
      roleQuestions[1].primaryDimension !== roleDimensions[3] ||
      roleQuestions[0].estimatedMinutes !== 6 ||
      roleQuestions[1].estimatedMinutes !== 4
    )
      throw new Error(
        '产品运营岗位潜力题须按用户运营 60%、数据增长 40% 组织。',
      );
  } else if (context.role === 'AI 产品经理（校招）') {
    const isReview = ({ source }: InterviewQuestionV3) =>
      source === 'written-test' || source === 'work-sample';
    const requiredReview = roleQuestions.filter(isReview);
    const reserveReview = reserveQuestions.filter(isReview);
    if (context.allowExistingReviewSources) {
      if (
        requiredQuestions.slice(0, 4).some(isReview) ||
        !(
          (requiredReview.length === 0 && reserveReview.length === 0) ||
          (requiredReview.length === 2 && reserveReview.length === 0) ||
          (requiredReview.length === 0 && reserveReview.length === 2)
        )
      )
        throw new Error('复盘题只能完整放在后两道必问题或两道候选题中。');
    } else if (expectedReviewSource) {
      const initialReview =
        roleQuestions.every(({ source }) => source === expectedReviewSource) &&
        reserveReview.length === 0;
      const lateReview =
        requiredReview.length === 0 &&
        reserveQuestions.every(({ source }) => source === expectedReviewSource);
      if (!initialReview && !lateReview)
        throw new Error('笔试或作品复盘题须完整放在岗位潜力题或候选题中。');
    } else if (requiredReview.length || reserveReview.length) {
      throw new Error('提纲问题来源与当前笔试或作品状态不一致。');
    }
  }

  const estimatedMinutes = requiredQuestions.reduce(
    (total, question) => total + question.estimatedMinutes,
    0,
  );
  if (estimatedMinutes > 32)
    throw new Error('六道必问题预计用时不能超过 32 分钟。');
  if (raw.estimatedMinutes !== estimatedMinutes)
    throw new Error('提纲预计用时与必问题不一致。');
  const coverage = calculateOutlineCoverageV3(
    activeQuestions,
    context.dimensions,
  );
  if (coverage.some(({ status }) => status === 'uncovered'))
    throw new Error('岗位评估维度没有全部覆盖。');
  if (JSON.stringify(raw.coverage) !== JSON.stringify(coverage))
    throw new Error('能力覆盖矩阵与问题不一致。');
  return {
    version: INTERVIEW_OUTLINE_V3,
    estimatedMinutes,
    requiredQuestions,
    reserveQuestions,
    archivedReserveQuestions,
    coverage,
  };
}

const sourceLabels: Record<InterviewQuestionV3['source'], string> = {
  role: '岗位通用',
  resume: '简历经历',
  'written-test': '笔试复盘',
  'work-sample': '笔试作品',
};

function exportQuestion(question: InterviewQuestionV3, number: number) {
  return [
    `### ${number}. ${question.question}`,
    '',
    `预计用时：${question.estimatedMinutes} 分钟`,
    '',
    `主评估维度：${question.primaryDimension}`,
    '',
    `辅助评估维度：${question.secondaryDimensions.join('、') || '无'}`,
    '',
    `来源：${sourceLabels[question.source]}`,
    '',
    `验证目标：${question.goal}`,
    ...(question.resumeEvidence ? ['', `> ${question.resumeEvidence}`] : []),
    ...(question.workSampleEvidence
      ? [
          '',
          `作品依据：${question.workSampleEvidence.path}`,
          '',
          `> ${question.workSampleEvidence.excerpt}`,
        ]
      : []),
    '',
    '观察点：',
    '',
    ...question.listenFor.map((item) => `- ${item}`),
    '',
    '风险信号：',
    '',
    ...question.riskSignals.map((item) => `- ${item}`),
    '',
    '条件追问：',
    '',
    ...question.probes.map(
      (probe) => `- 当${probe.condition}时：${probe.question}`,
    ),
  ];
}

export function exportInterviewOutlineV3(outline: InterviewOutlineV3) {
  return [
    '## 六道必问题',
    '',
    `预计总时长：${outline.estimatedMinutes} 分钟`,
    ...outline.requiredQuestions.flatMap((question, index) => [
      '',
      ...exportQuestion(question, index + 1),
    ]),
    '',
    '## 候选题',
    '',
    ...(outline.reserveQuestions.length
      ? outline.reserveQuestions.flatMap((question, index) => [
          ...exportQuestion(question, index + 1),
          '',
        ])
      : ['当前没有候选题。', '']),
    '## 能力覆盖',
    '',
    ...outline.coverage.map(
      (item) =>
        `- ${item.dimension}：${item.status}（主问题 ${item.primaryQuestionIds.join('、') || '无'}；辅助问题 ${item.secondaryQuestionIds.join('、') || '无'}）`,
    ),
  ].join('\n');
}

export const interviewQuestionV3Schema = {
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
      minLength: V3_MIN_QUESTION_LENGTH,
      maxLength: V3_MAX_QUESTION_LENGTH,
    },
    required: { type: 'boolean' },
    estimatedMinutes: { type: 'integer', minimum: 3, maximum: 6 },
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

export const interviewOutlineV3Schema = {
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
    version: { type: 'integer', enum: [INTERVIEW_OUTLINE_V3] },
    estimatedMinutes: { type: 'integer', minimum: 18, maximum: 32 },
    requiredQuestions: {
      type: 'array',
      minItems: V3_REQUIRED_QUESTIONS,
      maxItems: V3_REQUIRED_QUESTIONS,
      items: interviewQuestionV3Schema,
    },
    reserveQuestions: {
      type: 'array',
      minItems: V3_MAX_RESERVE_QUESTIONS,
      maxItems: V3_MAX_RESERVE_QUESTIONS,
      items: interviewQuestionV3Schema,
    },
    archivedReserveQuestions: {
      type: 'array',
      minItems: 0,
      maxItems: 24,
      items: interviewQuestionV3Schema,
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
