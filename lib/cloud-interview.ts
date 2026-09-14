import type { Report } from './interview.ts';
import type { ResumeReading } from './resume-reading.ts';
import type { WorkSampleAssessment } from './work-sample.ts';
import { interviewStatus, type InterviewStatus } from './interview-status.ts';

export const MAX_CLOUD_INTERVIEW_BYTES = 2 * 1024 * 1024;

export type CloudVersionReason =
  | 'resume-read'
  | 'outline-generated'
  | 'outline-regenerated'
  | 'transcript-imported'
  | 'work-sample-analyzed'
  | 'written-test-supplemented'
  | 'assessment-generated'
  | 'manually-confirmed'
  | 'periodic-edit'
  | 'restored';

export type CloudInterview = {
  id: string;
  groupId?: string | null;
  createdAt?: number;
  updatedAt: number;
  candidate: string;
  role: string;
  requirements: string;
  dimensionText: string;
  focus: string;
  resumeText: string;
  resumeName: string;
  /** Historical records only; current drafts no longer require verification. */
  resumeChecked?: boolean;
  resumeReading?: ResumeReading | null;
  transcript: string;
  transcriptName?: string;
  reviewed: boolean;
  report: Report | null;
  conclusion: string;
  confirmed: boolean;
  scoringGuidance?: string;
  reportRequirements?: string;
  sourceTemplateId?: string | null;
  templateModified?: boolean;
  outlineVersion?: 1 | 2 | 3;
  hasWrittenTest?: boolean;
  writtenTestConfirmed?: boolean;
  workSample?: WorkSampleAssessment | null;
  workSampleJobId?: string;
  writtenTestJobId?: string;
  outlineRegeneratedAt?: number;
  outlineRegenerationJobId?: string;
  outlineRevision?: string;
};

export type CloudInterviewSummary = {
  id: string;
  candidate: string;
  role: string;
  status: InterviewStatus;
  groupId: string | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

const allowedKeys = new Set<keyof CloudInterview>([
  'id',
  'groupId',
  'createdAt',
  'updatedAt',
  'candidate',
  'role',
  'requirements',
  'dimensionText',
  'focus',
  'resumeText',
  'resumeName',
  'resumeChecked',
  'resumeReading',
  'transcript',
  'transcriptName',
  'reviewed',
  'report',
  'conclusion',
  'confirmed',
  'scoringGuidance',
  'reportRequirements',
  'sourceTemplateId',
  'templateModified',
  'outlineVersion',
  'hasWrittenTest',
  'writtenTestConfirmed',
  'workSample',
  'workSampleJobId',
  'writtenTestJobId',
  'outlineRegeneratedAt',
  'outlineRegenerationJobId',
  'outlineRevision',
]);

const reasons = new Set<CloudVersionReason>([
  'resume-read',
  'outline-generated',
  'outline-regenerated',
  'transcript-imported',
  'work-sample-analyzed',
  'written-test-supplemented',
  'assessment-generated',
  'manually-confirmed',
  'periodic-edit',
  'restored',
]);

function string(value: unknown, maximum: number, label: string) {
  if (typeof value !== 'string' || value.length > maximum)
    throw new Error(`${label}格式无效。`);
}

function optionalString(value: unknown, maximum: number, label: string) {
  if (value !== undefined && value !== null) string(value, maximum, label);
}

function timestamp(value: unknown, optional = false) {
  if (optional && value === undefined) return;
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error('面试时间格式无效。');
}

function plainJson(value: unknown, depth = 0, seen = new Set<object>()): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return;
  if (depth > 32 || typeof value !== 'object')
    throw new Error('面试结构化内容格式无效。');
  if (seen.has(value)) throw new Error('面试结构化内容不能循环引用。');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
    throw new Error('面试结构化内容必须是普通 JSON。');
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > 10000) throw new Error('面试结构化内容数量超限。');
    for (const item of value) plainJson(item, depth + 1, seen);
  } else {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 1000) throw new Error('面试结构化内容字段超限。');
    for (const [, item] of entries) plainJson(item, depth + 1, seen);
  }
  seen.delete(value);
}

export function validateCloudVersionReason(value: unknown): CloudVersionReason {
  if (typeof value !== 'string' || !reasons.has(value as CloudVersionReason))
    throw new Error('面试版本原因无效。');
  return value as CloudVersionReason;
}

export function validateCloudInterview(value: unknown): CloudInterview {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('面试档案格式无效。');
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record))
    if (!allowedKeys.has(key as keyof CloudInterview))
      throw new Error(`面试档案包含不支持的字段：${key}。`);
  if (
    typeof record.id !== 'string' ||
    !/^[a-zA-Z0-9-]{8,100}$/.test(record.id)
  )
    throw new Error('面试编号格式无效。');
  timestamp(record.createdAt, true);
  timestamp(record.updatedAt);
  string(record.candidate, 80, '候选人信息');
  string(record.role, 200, '岗位');
  string(record.requirements, 10000, '岗位要求');
  string(record.dimensionText, 480, '评估维度');
  string(record.focus, 8000, '关注重点');
  string(record.resumeText, 30000, '简历正文');
  string(record.resumeName, 300, '简历文件名');
  string(record.transcript, 80000, '面试记录');
  optionalString(record.transcriptName, 300, '面试记录文件名');
  string(record.conclusion, 10000, '人工结论');
  optionalString(record.scoringGuidance, 4000, '评分说明');
  optionalString(record.reportRequirements, 4000, '报告要求');
  optionalString(record.sourceTemplateId, 100, '岗位模板');
  optionalString(record.workSampleJobId, 100, '作品任务');
  optionalString(record.writtenTestJobId, 100, '笔试任务');
  optionalString(record.outlineRegenerationJobId, 100, '提纲任务');
  optionalString(record.outlineRevision, 200, '提纲修订');
  if (record.groupId !== undefined && record.groupId !== null)
    string(record.groupId, 100, '分组');
  for (const key of [
    'resumeChecked',
    'reviewed',
    'confirmed',
    'templateModified',
    'hasWrittenTest',
    'writtenTestConfirmed',
  ])
    if (
      record[key] !== undefined &&
      typeof record[key] !== 'boolean'
    )
      throw new Error('面试状态格式无效。');
  if (typeof record.reviewed !== 'boolean' || typeof record.confirmed !== 'boolean')
    throw new Error('面试状态格式无效。');
  if (
    record.outlineVersion !== undefined &&
    ![1, 2, 3].includes(record.outlineVersion as number)
  )
    throw new Error('提纲版本格式无效。');
  if (record.outlineRegeneratedAt !== undefined)
    timestamp(record.outlineRegeneratedAt);
  for (const key of ['resumeReading', 'report', 'workSample'])
    if (record[key] !== undefined) plainJson(record[key]);
  plainJson(value);
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).length > MAX_CLOUD_INTERVIEW_BYTES)
    throw new Error('单份面试档案超过 2 MiB 限制。');
  return value as CloudInterview;
}

export function interviewSummary(
  value: CloudInterview,
  revision: number,
  deletedAt: number | null = null,
): CloudInterviewSummary {
  return {
    id: value.id,
    candidate: value.candidate,
    role: value.role,
    status: interviewStatus(value),
    groupId: value.groupId || null,
    revision,
    createdAt: value.createdAt ?? value.updatedAt,
    updatedAt: value.updatedAt,
    deletedAt,
  };
}
