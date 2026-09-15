import type { ResumeReading } from './resume-reading.ts';

export type FollowUpOutlineInput = {
  role: string;
  requirements: string;
  dimensionText: string;
  focus: string;
  scoringGuidance: string;
  reportRequirements: string;
  resumeText: string;
  resumeReading: ResumeReading;
  outlineVersion: 1 | 2 | 3;
  requestedFocus: string;
  existingSupplements: FollowUpOutlineGroup[];
};

export type FollowUpOutlineQuestion = {
  id: string;
  question: string;
  goal: string;
  resumeEvidence: string | null;
  listenFor: string[];
  riskSignals: string[];
  probes: Array<{ condition: string; question: string }>;
};

export type FollowUpOutlineResult = {
  version: 1;
  requestedFocus: string;
  questions: [FollowUpOutlineQuestion, FollowUpOutlineQuestion];
};

export type FollowUpOutlineGroup = FollowUpOutlineResult & {
  id: string;
  jobId: string;
  createdAt: number;
};

const inputFields = [
  'role',
  'requirements',
  'dimensionText',
  'focus',
  'scoringGuidance',
  'reportRequirements',
  'resumeText',
  'resumeReading',
  'outlineVersion',
  'requestedFocus',
  'existingSupplements',
] as const;

const resumeReadingFields = [
  'candidateName',
  'candidateNameEvidence',
  'interviewQuestions',
  'outline',
  'writtenTestSupplement',
  'workSample',
  'workSampleQuestions',
  'summary',
  'sections',
  'followUps',
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) throw new Error(`${label}包含未知字段：${extras.join('、')}`);
}

function boundedText(
  value: unknown,
  maximum: number,
  label: string,
  options: { allowEmpty?: boolean } = {},
) {
  if (typeof value !== 'string' || value.length > maximum) {
    throw new Error(`${label}为空或超过长度限制。`);
  }
  const result = value.trim();
  if (!options.allowEmpty && !result) throw new Error(`${label}不能为空。`);
  return result;
}

function characterLength(value: string) {
  return Array.from(value).length;
}

export function normalizeRequestedFocus(value: unknown) {
  if (typeof value !== 'string') throw new Error('补充关注点不能为空。');
  const result = value.trim();
  const length = characterLength(result);
  if (length < 2 || length > 200)
    throw new Error('补充关注点必须为 2–200 个字符。');
  return result;
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
  const result = boundedText(value, 200, '补充主问题');
  const length = characterLength(result);
  if (length < 12 || length > 30)
    throw new Error('补充主问题必须为 12–30 个字符。');
  if ((result.match(/[?？]/g) || []).length > 1)
    throw new Error('补充主问题只能包含一个问点。');
  if (/请(?:举例说明|系统阐述|详细介绍|全面分析)|证明你|谈谈你的/.test(result))
    throw new Error('补充主问题需要使用自然、亲和的表达。');
  const interrogativeClauses = result
    .split(/[，,；;]/)
    .filter((clause) => /什么|为什么|为何|怎么|如何|哪|是否|有没有|吗|呢/.test(clause));
  if (interrogativeClauses.length >= 2)
    throw new Error('补充主问题只能包含一个问点。');
  return result;
}

function questionId(value: unknown) {
  const result = boundedText(value, 80, '补充问题编号');
  if (characterLength(result) < 8) throw new Error('补充问题编号过短。');
  return result;
}

function validateQuestion(value: unknown, resumeText?: string) {
  if (!record(value)) throw new Error('补充问题格式不正确。');
  exactKeys(
    value,
    ['id', 'question', 'goal', 'resumeEvidence', 'listenFor', 'riskSignals', 'probes'],
    '补充问题',
  );
  const resumeEvidence =
    value.resumeEvidence === null
      ? null
      : boundedText(value.resumeEvidence, 300, '简历依据');
  if (
    resumeEvidence !== null &&
    resumeText !== undefined &&
    !resumeText.includes(resumeEvidence)
  )
    throw new Error('补充问题引用无法在简历原文中找到。');
  if (!Array.isArray(value.probes) || value.probes.length < 1 || value.probes.length > 2)
    throw new Error('条件追问数量不正确。');
  const probes = value.probes.map((item) => {
    if (!record(item)) throw new Error('条件追问格式不正确。');
    exactKeys(item, ['condition', 'question'], '条件追问');
    return {
      condition: boundedText(item.condition, 120, '追问条件'),
      question: boundedText(item.question, 80, '追问问题'),
    };
  });
  return {
    id: questionId(value.id),
    question: mainQuestion(value.question),
    goal: (() => {
      const goal = boundedText(value.goal, 300, '验证目标');
      if (characterLength(goal) < 2) throw new Error('验证目标过短。');
      return goal;
    })(),
    resumeEvidence,
    listenFor: stringList(value.listenFor, 2, 4, 160, '观察点'),
    riskSignals: stringList(value.riskSignals, 1, 3, 160, '风险信号'),
    probes,
  } satisfies FollowUpOutlineQuestion;
}

function normalizedQuestionText(value: string) {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[?？。！!]+$/u, '')
    .toLocaleLowerCase();
}

function questionText(value: unknown): string | undefined {
  if (!record(value) || typeof value.question !== 'string') return undefined;
  return value.question;
}

function collectExistingQuestionTexts(input: FollowUpOutlineInput) {
  const result: string[] = [];
  const reading = input.resumeReading as ResumeReading & {
    workSampleQuestions?: unknown;
  };
  const addQuestions = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      const text = questionText(item);
      if (text) result.push(text);
    }
  };
  if (input.outlineVersion === 1) {
    addQuestions(reading.interviewQuestions);
    addQuestions(reading.writtenTestSupplement);
    addQuestions(reading.workSampleQuestions);
    addQuestions(reading.workSample && reading.workSample.questions);
  } else {
    const outline = reading.outline as
      | (ResumeReading['outline'] & {
          requiredQuestions?: unknown;
          reserveQuestions?: unknown;
          archivedReserveQuestions?: unknown;
        })
      | undefined;
    addQuestions(outline?.requiredQuestions);
    addQuestions(outline?.reserveQuestions);
    addQuestions(outline?.archivedReserveQuestions);
  }
  for (const group of input.existingSupplements)
    for (const question of group.questions) result.push(question.question);
  return result;
}

function collectExistingQuestionIds(input: FollowUpOutlineInput) {
  const result: string[] = [];
  const reading = input.resumeReading as ResumeReading & {
    workSampleQuestions?: unknown;
  };
  const addQuestions = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (record(item) && typeof item.id === 'string') result.push(item.id);
    }
  };
  if (input.outlineVersion === 1) {
    addQuestions(reading.interviewQuestions);
    addQuestions(reading.writtenTestSupplement);
    addQuestions(reading.workSampleQuestions);
    addQuestions(reading.workSample && reading.workSample.questions);
  } else {
    const outline = reading.outline as Record<string, unknown> | undefined;
    addQuestions(outline?.requiredQuestions);
    addQuestions(outline?.reserveQuestions);
    addQuestions(outline?.archivedReserveQuestions);
  }
  for (const group of input.existingSupplements)
    for (const question of group.questions) result.push(question.id);
  return result;
}

function validateResultShape(value: unknown, resumeText?: string, expectedFocus?: string) {
  if (!record(value)) throw new Error('补充追问结果格式不正确。');
  exactKeys(value, ['version', 'requestedFocus', 'questions'], '补充追问结果');
  if (value.version !== 1) throw new Error('补充追问结果版本不正确。');
  const requestedFocus = normalizeRequestedFocus(value.requestedFocus);
  if (expectedFocus !== undefined && requestedFocus !== expectedFocus)
    throw new Error('补充追问关注点与当前请求不一致。');
  if (!Array.isArray(value.questions) || value.questions.length !== 2)
    throw new Error('补充追问必须包含恰好两道问题。');
  const questions = value.questions.map((question) =>
    validateQuestion(question, resumeText),
  );
  if (new Set(questions.map(({ id }) => id)).size !== questions.length)
    throw new Error('补充问题编号不能重复。');
  if (
    new Set(questions.map(({ question }) => normalizedQuestionText(question))).size !==
    questions.length
  )
    throw new Error('补充问题不能重复。');
  return {
    version: 1 as const,
    requestedFocus,
    questions: questions as [FollowUpOutlineQuestion, FollowUpOutlineQuestion],
  } satisfies FollowUpOutlineResult;
}

function validateGroup(value: unknown, resumeText?: string) {
  if (!record(value)) throw new Error('补充追问分组格式不正确。');
  exactKeys(
    value,
    ['version', 'requestedFocus', 'questions', 'id', 'jobId', 'createdAt'],
    '补充追问分组',
  );
  const { id: rawId, jobId: rawJobId, createdAt, ...rawResult } = value;
  const result = validateResultShape(rawResult, resumeText);
  const id = boundedText(rawId, 100, '补充追问分组编号');
  const jobId = boundedText(rawJobId, 100, '补充追问任务编号');
  if (characterLength(id) < 8 || characterLength(jobId) < 8)
    throw new Error('补充追问分组或任务编号过短。');
  if (!Number.isSafeInteger(createdAt) || Number(createdAt) < 0)
    throw new Error('补充追问创建时间无效。');
  return { ...result, id, jobId, createdAt: Number(createdAt) };
}

export function validateFollowUpOutlineInput(value: unknown): FollowUpOutlineInput {
  if (!record(value)) throw new Error('补充追问输入格式不正确。');
  exactKeys(value, inputFields, '补充追问输入');
  const role = boundedText(value.role, 200, '岗位');
  const requirements = boundedText(value.requirements, 10000, '岗位要求');
  const dimensionText = boundedText(value.dimensionText, 480, '评估维度');
  const focus = boundedText(value.focus, 8000, '关注重点');
  const scoringGuidance = boundedText(value.scoringGuidance, 4000, '评分说明');
  const reportRequirements = boundedText(value.reportRequirements, 4000, '报告要求');
  const resumeText = boundedText(value.resumeText, 30000, '简历原文');
  if (!record(value.resumeReading)) throw new Error('简历阅读结果格式不正确。');
  exactKeys(value.resumeReading, resumeReadingFields, '简历阅读结果');
  const outlineVersion = value.outlineVersion;
  if (outlineVersion !== 1 && outlineVersion !== 2 && outlineVersion !== 3)
    throw new Error('面试提纲版本不正确。');
  const requestedFocus = normalizeRequestedFocus(value.requestedFocus);
  if (!Array.isArray(value.existingSupplements) || value.existingSupplements.length > 50)
    throw new Error('已有补充追问分组数量不正确。');
  const existingSupplements = value.existingSupplements.map((group) =>
    validateGroup(group, resumeText),
  );
  return {
    role,
    requirements,
    dimensionText,
    focus,
    scoringGuidance,
    reportRequirements,
    resumeText,
    resumeReading: value.resumeReading as ResumeReading,
    outlineVersion,
    requestedFocus,
    existingSupplements,
  };
}

export function validateFollowUpOutlineResult(
  value: unknown,
  input: FollowUpOutlineInput,
): FollowUpOutlineResult {
  const result = validateResultShape(
    value,
    input.resumeText,
    normalizeRequestedFocus(input.requestedFocus),
  );
  const existingTexts = new Set(
    collectExistingQuestionTexts(input).map(normalizedQuestionText),
  );
  const existingIds = new Set(collectExistingQuestionIds(input));
  if (
    result.questions.some(
      ({ question, id }) =>
        existingTexts.has(normalizedQuestionText(question)) || existingIds.has(id),
    )
  )
    throw new Error('补充问题不能与现有提纲或补充问题重复。');
  return result;
}

export function validateFollowUpOutlineGroups(
  value: unknown,
  resumeText?: string,
): FollowUpOutlineGroup[] {
  if (!Array.isArray(value) || value.length > 50)
    throw new Error('补充追问分组数量不正确。');
  const groups = value.map((group) => validateGroup(group, resumeText));
  if (new Set(groups.map(({ id }) => id)).size !== groups.length)
    throw new Error('补充追问分组编号不能重复。');
  if (new Set(groups.map(({ jobId }) => jobId)).size !== groups.length)
    throw new Error('补充追问任务编号不能重复。');
  const questions = groups.flatMap(({ questions: items }) => items);
  if (
    new Set(questions.map(({ id }) => id)).size !== questions.length ||
    new Set(
      questions.map(({ question }) => normalizedQuestionText(question)),
    ).size !== questions.length
  )
    throw new Error('补充追问问题不能重复。');
  return groups;
}

export const followUpOutlineInstructions =
  '你是校招面试准备助手。请围绕输入中的 requestedFocus，补充恰好两道不同角度的现场主问题，参考岗位要求、自由文本关注点、简历阅读结果、当前 V1/V2/V3 面试提纲和已有补充追问。重点了解候选人的校园、课程、社团、个人项目、实习或日常经历中的成长潜力、具体选择、本人行动和复盘，不把成熟工作年限当作能力前提。主问题必须使用自然、亲和、可以直接念出的表达，每题 12–30 个字符，只问一个核心问题；把背景和细节放入 goal、listenFor、riskSignals 与条件 probes。问题不得与现有主提纲或补充追问相同，也不要只改写措辞。resumeEvidence 只能逐字连续来自 resumeText；没有直接相关依据时必须为 null，不能编造简历事实或声称读到不存在的经历。每题提供 2–4 个观察点、1–3 个风险信号和 1–2 个条件追问，条件追问仅在回答缺少事实、行动或结果时使用。requestedFocus 必须原样返回，version 固定为 1。只返回符合给定 JSON Schema 的结果。';

export const followUpOutlineOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'requestedFocus', 'questions'],
  properties: {
    version: { type: 'integer', enum: [1] },
    requestedFocus: { type: 'string', minLength: 2, maxLength: 200 },
    questions: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'question',
          'goal',
          'resumeEvidence',
          'listenFor',
          'riskSignals',
          'probes',
        ],
        properties: {
          id: { type: 'string', minLength: 8, maxLength: 80 },
          question: { type: 'string', minLength: 12, maxLength: 30 },
          goal: { type: 'string', minLength: 2, maxLength: 300 },
          resumeEvidence: {
            anyOf: [
              { type: 'string', minLength: 1, maxLength: 300 },
              { type: 'null' },
            ],
          },
          listenFor: {
            type: 'array',
            minItems: 2,
            maxItems: 4,
            items: { type: 'string', minLength: 1, maxLength: 160 },
          },
          riskSignals: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: { type: 'string', minLength: 1, maxLength: 160 },
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
                condition: { type: 'string', minLength: 1, maxLength: 120 },
                question: { type: 'string', minLength: 2, maxLength: 80 },
              },
            },
          },
        },
      },
    },
  },
} as const;

export function applyFollowUpOutlineResult(
  current: readonly FollowUpOutlineGroup[],
  result: FollowUpOutlineResult,
  metadata: { id: string; jobId: string; createdAt: number },
): FollowUpOutlineGroup[] {
  const existing = current.map((group) => ({
    ...group,
    questions: group.questions.map((question) => ({
      ...question,
      listenFor: [...question.listenFor],
      riskSignals: [...question.riskSignals],
      probes: question.probes.map((probe) => ({ ...probe })),
    })) as [FollowUpOutlineQuestion, FollowUpOutlineQuestion],
  }));
  if (existing.some(({ jobId }) => jobId === metadata.jobId)) return existing;
  const id = boundedText(metadata.id, 100, '补充追问分组编号');
  const jobId = boundedText(metadata.jobId, 100, '补充追问任务编号');
  if (!Number.isSafeInteger(metadata.createdAt) || metadata.createdAt < 0)
    throw new Error('补充追问创建时间无效。');
  const questions = result.questions.map((question) => ({
    ...question,
    listenFor: [...question.listenFor],
    riskSignals: [...question.riskSignals],
    probes: question.probes.map((probe) => ({ ...probe })),
  })) as [FollowUpOutlineQuestion, FollowUpOutlineQuestion];
  return [...existing, { ...result, questions, id, jobId, createdAt: metadata.createdAt }];
}
