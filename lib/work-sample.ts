import {
  interviewQuestionSchema,
  safeWorkSamplePath,
  validateQuestionItems,
  validateWorkSampleEvidence,
  type InterviewQuestion,
  type WorkSampleEvidence,
} from './interview-questions.ts';

export type { WorkSampleEvidence } from './interview-questions.ts';

export const MAX_WORK_SAMPLE_BYTES = 50 * 1024 * 1024;

export type WorkSampleReference = {
  id: string;
  deviceId: string;
  name: string;
  sha256: string;
  bytes: number;
  modifiedAt: number;
};

export type WorkSampleDimension = {
  name: string;
  score: number | null;
  assessment: string;
  evidence: WorkSampleEvidence[];
};

export type WorkSampleCoverage = {
  analyzed: string[];
  excluded: string[];
  unsupported: string[];
  truncated: boolean;
};

export type WorkSampleAssessment = {
  artifact: Omit<WorkSampleReference, 'deviceId'>;
  coverage: WorkSampleCoverage;
  summary: string;
  dimensions: WorkSampleDimension[];
  strengths: string[];
  risks: string[];
  questions: InterviewQuestion[];
};

function boundedText(value: unknown, max: number, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`${label}为空或超过长度限制。`);
  return value.trim();
}

function identifier(value: unknown, label: string) {
  const result = boundedText(value, 100, label);
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(result))
    throw new Error(`${label}格式不正确。`);
  return result;
}

function positiveInteger(value: unknown, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > maximum)
    throw new Error(`${label}超出限制。`);
  return Number(value);
}

export function validateWorkSampleReference(
  value: unknown,
): WorkSampleReference {
  if (!value || typeof value !== 'object')
    throw new Error('作品引用格式不正确。');
  const item = value as Record<string, unknown>;
  const name = boundedText(item.name, 200, '作品文件名');
  if (
    !/\.zip$/i.test(name) ||
    name.includes('/') ||
    name.includes('\\') ||
    /[\u0000-\u001f]/.test(name)
  )
    throw new Error('作品文件名格式不正确。');
  const sha256 = boundedText(item.sha256, 64, '作品哈希').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256))
    throw new Error('作品哈希格式不正确。');
  if (!Number.isSafeInteger(item.modifiedAt) || Number(item.modifiedAt) < 0)
    throw new Error('作品修改时间格式不正确。');
  return {
    id: identifier(item.id, '作品编号'),
    deviceId: identifier(item.deviceId, '设备编号'),
    name,
    sha256,
    bytes: positiveInteger(item.bytes, MAX_WORK_SAMPLE_BYTES, '作品大小'),
    modifiedAt: Number(item.modifiedAt),
  };
}

function textList(value: unknown, maximum: number, label: string) {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error(`${label}格式不正确。`);
  return value.map((item) => boundedText(item, 2000, label));
}

function pathList(value: unknown, maximum: number, label: string) {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error(`${label}格式不正确。`);
  return value.map((item) => {
    if (typeof item !== 'string' || !item.trim() || item.length > 500)
      throw new Error(`${label}格式不正确。`);
    const normalized = item.trim().replaceAll('\\', '/');
    const candidate = normalized.endsWith('/')
      ? normalized.slice(0, -1)
      : normalized;
    safeWorkSamplePath(candidate);
    return normalized;
  });
}

function sameArtifact(
  value: unknown,
  reference: WorkSampleReference,
): Omit<WorkSampleReference, 'deviceId'> {
  if (!value || typeof value !== 'object')
    throw new Error('作品信息格式不正确。');
  const artifact = value as Record<string, unknown>;
  const normalized = {
    id: identifier(artifact.id, '作品编号'),
    name: boundedText(artifact.name, 200, '作品文件名'),
    sha256: boundedText(artifact.sha256, 64, '作品哈希').toLowerCase(),
    bytes: positiveInteger(
      artifact.bytes,
      MAX_WORK_SAMPLE_BYTES,
      '作品大小',
    ),
    modifiedAt: Number(artifact.modifiedAt),
  };
  if (
    !Number.isSafeInteger(normalized.modifiedAt) ||
    normalized.modifiedAt < 0 ||
    normalized.id !== reference.id ||
    normalized.name !== reference.name ||
    normalized.sha256 !== reference.sha256 ||
    normalized.bytes !== reference.bytes ||
    normalized.modifiedAt !== reference.modifiedAt
  )
    throw new Error('作品信息与所选文件不一致。');
  return normalized;
}

export function validateWorkSampleAssessment(
  value: unknown,
  options: {
    reference: WorkSampleReference;
    dimensionText: string;
    questionCount: number;
    existingQuestions: InterviewQuestion[];
  },
): WorkSampleAssessment {
  if (!value || typeof value !== 'object')
    throw new Error('作品评估格式不正确。');
  const item = value as Record<string, unknown>;
  if (!item.coverage || typeof item.coverage !== 'object')
    throw new Error('作品读取范围格式不正确。');
  const coverage = item.coverage as Record<string, unknown>;
  const allowedDimensions = new Set(
    options.dimensionText
      .split(/[、,，\n]/)
      .map((name) => name.trim())
      .filter(Boolean),
  );
  if (
    !Array.isArray(item.dimensions) ||
    !item.dimensions.length ||
    item.dimensions.length > 8
  )
    throw new Error('作品评估维度不完整。');
  const seen = new Set<string>();
  const dimensions = item.dimensions.map((value) => {
    if (!value || typeof value !== 'object')
      throw new Error('作品评估维度格式不正确。');
    const dimension = value as Record<string, unknown>;
    const name = boundedText(dimension.name, 60, '作品评估维度');
    if (!allowedDimensions.has(name) || seen.has(name))
      throw new Error('作品评估包含未知或重复维度。');
    seen.add(name);
    const score = dimension.score;
    if (
      score !== null &&
      (!Number.isInteger(score) || Number(score) < 1 || Number(score) > 5)
    )
      throw new Error('作品评分必须是 1–5 或待核实。');
    if (!Array.isArray(dimension.evidence) || dimension.evidence.length > 6)
      throw new Error('作品维度证据格式不正确。');
    return {
      name,
      score: score as number | null,
      assessment: boundedText(dimension.assessment, 3000, '作品维度说明'),
      evidence: dimension.evidence.map(validateWorkSampleEvidence),
    };
  });
  const questions = validateQuestionItems(item.questions, {
    expectedCount: options.questionCount,
    allowedDimensions,
    allowedSources: new Set(['work-sample']),
    resumeText: '',
  });
  const existing = new Set(
    options.existingQuestions.map((question) => question.question.trim()),
  );
  if (questions.some((question) => existing.has(question.question)))
    throw new Error('作品复盘题不能与已有提纲重复。');
  return {
    artifact: sameArtifact(item.artifact, options.reference),
    coverage: {
      analyzed: pathList(coverage.analyzed, 3000, '已分析文件'),
      excluded: pathList(coverage.excluded, 3000, '排除文件'),
      unsupported: pathList(coverage.unsupported, 3000, '未支持文件'),
      truncated: coverage.truncated === true,
    },
    summary: boundedText(item.summary, 4000, '作品摘要'),
    dimensions,
    strengths: textList(item.strengths, 12, '作品亮点'),
    risks: textList(item.risks, 12, '作品风险'),
    questions,
  };
}

export async function validateWorkSampleEvidenceFiles(
  value: WorkSampleAssessment,
  readText: (path: string) => Promise<string | undefined>,
) {
  const evidence = [
    ...value.dimensions.flatMap((dimension) => dimension.evidence),
    ...value.questions.flatMap((question) =>
      question.workSampleEvidence ? [question.workSampleEvidence] : [],
    ),
  ];
  for (const item of evidence) {
    const source = await readText(safeWorkSamplePath(item.path));
    if (!source || !source.includes(item.excerpt))
      throw new Error('作品引用无法在本地文件中找到。');
  }
}

export const workSampleAssessmentSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'artifact',
    'coverage',
    'summary',
    'dimensions',
    'strengths',
    'risks',
    'questions',
  ],
  properties: {
    artifact: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'sha256', 'bytes', 'modifiedAt'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        sha256: { type: 'string' },
        bytes: { type: 'integer' },
        modifiedAt: { type: 'integer' },
      },
    },
    coverage: {
      type: 'object',
      additionalProperties: false,
      required: ['analyzed', 'excluded', 'unsupported', 'truncated'],
      properties: {
        analyzed: { type: 'array', items: { type: 'string' } },
        excluded: { type: 'array', items: { type: 'string' } },
        unsupported: { type: 'array', items: { type: 'string' } },
        truncated: { type: 'boolean' },
      },
    },
    summary: { type: 'string' },
    dimensions: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'score', 'assessment', 'evidence'],
        properties: {
          name: { type: 'string' },
          score: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
          assessment: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'excerpt'],
              properties: {
                path: { type: 'string' },
                excerpt: { type: 'string' },
              },
            },
          },
        },
      },
    },
    strengths: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    questions: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: interviewQuestionSchema,
    },
  },
} as const;
