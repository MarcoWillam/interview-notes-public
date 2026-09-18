export const interviewerReviewDimensions = [
  '岗位覆盖',
  '经历深挖',
  '问题表达',
  '证据核实',
] as const;

export type InterviewerReviewDimension =
  (typeof interviewerReviewDimensions)[number];
export type InterviewerReviewLevel = '表现较好' | '可以改进' | '优先改进';

export type AvailableInterviewerReview = {
  status: 'available';
  reason: null;
  summary: string;
  dimensions: Array<{
    name: InterviewerReviewDimension;
    level: InterviewerReviewLevel;
    assessment: string;
    evidence: string[];
  }>;
  strengths: string[];
  priorities: string[];
  rewrites: Array<{
    originalQuestion: string;
    issue: string;
    improvedQuestion: string;
    purpose: string;
  }>;
  missedFollowUps: Array<{
    candidateSignal: string;
    suggestedQuestion: string;
    purpose: string;
  }>;
};

export type UnavailableInterviewerReview = {
  status: 'unavailable';
  reason: 'speaker-labels-missing';
  summary: null;
  dimensions: [];
  strengths: [];
  priorities: [];
  rewrites: [];
  missedFollowUps: [];
};

export type InterviewerReview =
  | AvailableInterviewerReview
  | UnavailableInterviewerReview;

type SpeakerRole = 'interviewer' | 'candidate';
type SpeakerSegment = { role: SpeakerRole; raw: string; content: string };

const speakerLine =
  /^\s*(?:[-*•]\s*)?(?:\[[^\]\n]{1,30}\]\s*)?(面试官|候选人)\s*[：:]\s*(.*)$/;

function speakerSegments(transcript: string): SpeakerSegment[] {
  const result: SpeakerSegment[] = [];
  let current: SpeakerSegment | null = null;
  for (const line of transcript.split(/\r?\n/)) {
    const match = speakerLine.exec(line);
    if (match) {
      current = {
        role: match[1] === '面试官' ? 'interviewer' : 'candidate',
        raw: line.trim(),
        content: match[2].trim(),
      };
      result.push(current);
      continue;
    }
    if (!current || !line.trim()) continue;
    current.raw += `\n${line}`;
    current.content += `\n${line.trim()}`;
  }
  return result;
}

export function hasReviewableSpeakerLabels(transcript: string) {
  const roles = new Set(speakerSegments(transcript).map(({ role }) => role));
  return roles.has('interviewer') && roles.has('candidate');
}

function quoteBelongsTo(
  transcript: string,
  quote: string,
  role: SpeakerRole,
) {
  const expected = quote.trim();
  return speakerSegments(transcript).some(
    (segment) =>
      segment.role === role &&
      (segment.content.includes(expected) || segment.raw.includes(expected)),
  );
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
) {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error(`${label}字段不完整。`);
}

function object(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}格式无效。`);
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum: number, label: string) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Array.from(value.trim()).length > maximum
  )
    throw new Error(`${label}不能为空且长度须在限制内。`);
  return value.trim();
}

function textList(
  value: unknown,
  minimum: number,
  maximum: number,
  itemMaximum: number,
  label: string,
) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    throw new Error(`${label}数量不正确。`);
  return value.map((item) => text(item, itemMaximum, label));
}

function unavailableReview(): UnavailableInterviewerReview {
  return {
    status: 'unavailable',
    reason: 'speaker-labels-missing',
    summary: null,
    dimensions: [],
    strengths: [],
    priorities: [],
    rewrites: [],
    missedFollowUps: [],
  };
}

export function validateInterviewerReview(
  value: unknown,
  transcript: string,
): InterviewerReview {
  const review = object(value, '面试官复盘');
  exactKeys(
    review,
    [
      'status',
      'reason',
      'summary',
      'dimensions',
      'strengths',
      'priorities',
      'rewrites',
      'missedFollowUps',
    ],
    '面试官复盘',
  );
  const reviewable = hasReviewableSpeakerLabels(transcript);
  if (!reviewable) {
    const unavailable = unavailableReview();
    if (
      review.status !== unavailable.status ||
      review.reason !== unavailable.reason ||
      review.summary !== null ||
      !Array.isArray(review.dimensions) ||
      review.dimensions.length ||
      !Array.isArray(review.strengths) ||
      review.strengths.length ||
      !Array.isArray(review.priorities) ||
      review.priorities.length ||
      !Array.isArray(review.rewrites) ||
      review.rewrites.length ||
      !Array.isArray(review.missedFollowUps) ||
      review.missedFollowUps.length
    )
      throw new Error('面试记录缺少清晰的说话人标记，不能生成面试官复盘。');
    return unavailable;
  }
  if (review.status !== 'available' || review.reason !== null)
    throw new Error('面试记录说话人标记完整，面试官复盘必须可用。');
  const rawDimensions = review.dimensions;
  if (
    !Array.isArray(rawDimensions) ||
    rawDimensions.length !== interviewerReviewDimensions.length
  )
    throw new Error('面试官复盘维度不完整。');
  const dimensions = interviewerReviewDimensions.map((name) => {
    const matches = rawDimensions.filter(
      (item) =>
        !!item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        (item as Record<string, unknown>).name === name,
    );
    if (matches.length !== 1) throw new Error('面试官复盘维度不匹配。');
    const item = object(matches[0], '面试官复盘维度');
    exactKeys(
      item,
      ['name', 'level', 'assessment', 'evidence'],
      '面试官复盘维度',
    );
    if (!['表现较好', '可以改进', '优先改进'].includes(String(item.level)))
      throw new Error('面试官复盘等级无效。');
    const evidence = textList(item.evidence, 0, 6, 1000, '面试官引用');
    if (evidence.some((quote) => !quoteBelongsTo(transcript, quote, 'interviewer')))
      throw new Error('面试官引用无法在面试官发言中找到。');
    return {
      name,
      level: item.level as InterviewerReviewLevel,
      assessment: text(item.assessment, 1000, '面试官复盘维度说明'),
      evidence,
    };
  });
  const rewrites = Array.isArray(review.rewrites) ? review.rewrites : [];
  if (rewrites.length < 1 || rewrites.length > 3)
    throw new Error('问题改写数量不正确。');
  const validatedRewrites = rewrites.map((entry) => {
    const item = object(entry, '问题改写');
    exactKeys(
      item,
      ['originalQuestion', 'issue', 'improvedQuestion', 'purpose'],
      '问题改写',
    );
    const originalQuestion = text(item.originalQuestion, 1000, '面试官引用');
    if (!quoteBelongsTo(transcript, originalQuestion, 'interviewer'))
      throw new Error('面试官引用无法在面试官发言中找到。');
    return {
      originalQuestion,
      issue: text(item.issue, 500, '问题说明'),
      improvedQuestion: text(item.improvedQuestion, 120, '改写问题'),
      purpose: text(item.purpose, 500, '改写目的'),
    };
  });
  const missed = Array.isArray(review.missedFollowUps)
    ? review.missedFollowUps
    : [];
  if (missed.length > 5) throw new Error('遗漏追问数量不正确。');
  const missedFollowUps = missed.map((entry) => {
    const item = object(entry, '遗漏追问');
    exactKeys(
      item,
      ['candidateSignal', 'suggestedQuestion', 'purpose'],
      '遗漏追问',
    );
    const candidateSignal = text(item.candidateSignal, 1000, '候选人引用');
    if (!quoteBelongsTo(transcript, candidateSignal, 'candidate'))
      throw new Error('候选人引用无法在候选人发言中找到。');
    return {
      candidateSignal,
      suggestedQuestion: text(item.suggestedQuestion, 120, '建议追问'),
      purpose: text(item.purpose, 500, '追问目的'),
    };
  });
  return {
    status: 'available',
    reason: null,
    summary: text(review.summary, 1500, '面试官复盘摘要'),
    dimensions,
    strengths: textList(review.strengths, 2, 3, 500, '提问优势'),
    priorities: textList(review.priorities, 1, 3, 500, '优先改进'),
    rewrites: validatedRewrites,
    missedFollowUps,
  };
}

const dimensionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'level', 'assessment', 'evidence'],
  properties: {
    name: { type: 'string', enum: [...interviewerReviewDimensions] },
    level: {
      type: 'string',
      enum: ['表现较好', '可以改进', '优先改进'],
    },
    assessment: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
  },
};

export const interviewerReviewSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'status',
    'reason',
    'summary',
    'dimensions',
    'strengths',
    'priorities',
    'rewrites',
    'missedFollowUps',
  ],
  properties: {
    status: { type: 'string', enum: ['available', 'unavailable'] },
    reason: { type: ['string', 'null'], enum: ['speaker-labels-missing', null] },
    summary: { type: ['string', 'null'] },
    dimensions: { type: 'array', maxItems: 4, items: dimensionSchema },
    strengths: { type: 'array', maxItems: 3, items: { type: 'string' } },
    priorities: { type: 'array', maxItems: 3, items: { type: 'string' } },
    rewrites: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['originalQuestion', 'issue', 'improvedQuestion', 'purpose'],
        properties: {
          originalQuestion: { type: 'string' },
          issue: { type: 'string' },
          improvedQuestion: { type: 'string' },
          purpose: { type: 'string' },
        },
      },
    },
    missedFollowUps: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['candidateSignal', 'suggestedQuestion', 'purpose'],
        properties: {
          candidateSignal: { type: 'string' },
          suggestedQuestion: { type: 'string' },
          purpose: { type: 'string' },
        },
      },
    },
  },
} as const;

export const interviewerReviewInstructions =
  '同时复盘面试官在本轮 transcript 中的提问行为。只评价岗位覆盖、经历深挖、问题表达、证据核实，不对面试官人格、情绪或其他个人属性作判断，不把候选人的表现写成面试官表现。输入 speakerLabelsAvailable 由服务端确定：为 false 时，interviewerReview 必须返回 status=unavailable、reason=speaker-labels-missing、summary=null，其他数组全部为空；为 true 时必须返回 status=available、reason=null，四个 dimensions 与固定名称同名同数量，level 只能是“表现较好”“可以改进”“优先改进”，strengths 2–3 项、priorities 1–3 项、rewrites 1–3 项问题改写、missedFollowUps 0–5 项。dimension evidence 和 originalQuestion 只能逐字引用面试官发言；candidateSignal 只能逐字引用候选人发言。改写和补问保持亲和、直接、一个核心问点，并说明其岗位或通用素质验证目的。';
