import {
  validateResumeInput,
  validateResumeReading,
  type ResumeInput,
  type ResumeReading,
} from './resume-reading.ts';
import {
  validateAssessmentResult,
  validateInput,
  type AssessmentResult,
  type InterviewInput,
  type Report,
} from './interview.ts';
import {
  validateWrittenTestSupplement,
  validateWrittenTestSupplementInput,
  type WrittenTestSupplementInput,
  type WrittenTestSupplementResult,
} from './written-test-supplement.ts';
import {
  validateWorkSampleAnalysisResult,
  validateWorkSampleInput,
  validateWorkSampleReference,
  type WorkSampleAssessment,
  type WorkSampleAnalysisResult,
  type WorkSampleAnalysisV2,
  type WorkSampleAnalysisV3,
  type WorkSampleInput,
  type WorkSampleInputV1,
  type WorkSampleInputV2,
  type WorkSampleInputV3,
  type WorkSampleReference,
} from './work-sample.ts';
import {
  validateOutlineRegenerationInput,
  validateOutlineRegenerationResult,
  type OutlineRegenerationInput,
  type OutlineRegenerationResult,
} from './outline-regeneration.ts';
import {
  validateFollowUpOutlineResult,
  type FollowUpOutlineInput,
  type FollowUpOutlineResult,
} from './follow-up-outline.ts';
import {
  validateSecondRoundAssessmentInput,
  validateSecondRoundAssessmentResult,
  validateSecondRoundOutlineInput,
  validateSecondRoundOutlineResult,
  type SecondRoundAssessmentInput,
  type SecondRoundAssessmentResult,
  type SecondRoundOutlineInput,
  type SecondRoundOutlineResult,
} from './second-round.ts';
let account: string | null = null;
export function configureRemoteAccount(value: string) {
  account = value;
}
const pendingSubmissions = new Map<string, string>();
export class RemoteError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}
export type RemoteJob<T = Report> = {
  kind?:
    | 'interview'
    | 'resume'
    | 'initial-outline'
    | 'written-test'
    | 'work-sample'
    | 'outline'
    | 'follow-up-outline'
    | 'second-round-outline'
    | 'second-round-assessment';
  id: string;
  label: string;
  state: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  created: number;
  updated: number;
  queuedAt?: number;
  startedAt?: number | null;
  position?: number | null;
  report?: T | null;
  error?: string | null;
  artifactId?: string | null;
  targetDeviceName?: string | null;
  waitingForDevice?: boolean;
  requiredProtocol?: number;
  interviewId?: string | null;
  interviewRevision?: number | null;
  resultDisposition?: 'applied' | 'pending' | null;
};
export type RemoteTaskDependencies = {
  fetcher: typeof fetch;
  pollMs: number;
  scope?: string;
  interviewId?: string;
  interviewRevision?: number;
};
export type RemoteArtifact = WorkSampleReference & {
  deviceName: string;
  available: boolean;
  syncedAt: number;
};
export async function remoteRequest<T>(
  path: string,
  options: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (account) headers.set('X-Interview-Account', account);
  if (!headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  const response = await fetcher(path, {
    ...options,
    headers,
    signal: AbortSignal.any([
      AbortSignal.timeout(15000),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new RemoteError(
      response.status === 401
        ? '登录已过期，请刷新网页重新登录。'
        : data.error || '请求失败，请稍后重试。',
      response.status,
      data,
    );
  return data;
}
export function controlRemoteJob(
  id: string,
  action: 'pause' | 'resume' | 'stop',
  fetcher: typeof fetch = fetch,
) {
  return remoteRequest<RemoteJob>(
    '/api/jobs/' + encodeURIComponent(id) + '/action',
    { method: 'POST', body: JSON.stringify({ action }) },
    fetcher,
  );
}
async function submitRemoteTask<T>(
  input:
    | InterviewInput
    | ResumeInput
    | WrittenTestSupplementInput
    | WorkSampleInput
    | OutlineRegenerationInput
    | FollowUpOutlineInput
    | SecondRoundOutlineInput
    | SecondRoundAssessmentInput,
  kind:
    | 'interview'
    | 'resume'
    | 'initial-outline'
    | 'written-test'
    | 'work-sample'
    | 'outline'
    | 'follow-up-outline'
    | 'second-round-outline'
    | 'second-round-assessment',
  validateResult: (value: unknown) => T,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<T>) => void,
  dependencies: RemoteTaskDependencies = { fetcher: fetch, pollMs: 2000 },
): Promise<T> {
  const scope = dependencies.scope?.trim() || '';
  const payload = JSON.stringify({
    ...(kind === 'interview' ? {} : { kind }),
    label,
    input,
    ...(scope ? { scope } : {}),
    ...(dependencies.interviewId
      ? {
          interviewId: dependencies.interviewId,
          interviewRevision: dependencies.interviewRevision,
        }
      : {}),
  });
  const fingerprint = Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)),
    ),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('');
  const storageKey = `interview-pending-submit:${account || 'local'}:${fingerprint}`;
  let client = pendingSubmissions.get(storageKey);
  try {
    client ||= localStorage.getItem(storageKey) || undefined;
  } catch {
    /* Memory fallback if localStorage is unavailable. */
  }
  client ||= crypto.randomUUID();
  pendingSubmissions.set(storageKey, client);
  try {
    localStorage.setItem(storageKey, client);
  } catch {
    /* Same-tab retries still preserve their identifier. */
  }
  let job: RemoteJob<T>;
  try {
    job = await remoteRequest<RemoteJob<T>>(
      '/api/jobs',
      {
        method: 'POST',
        body: JSON.stringify({
          client,
          label,
          input,
          kind,
          ...(scope ? { scope } : {}),
          ...(dependencies.interviewId
            ? {
                interviewId: dependencies.interviewId,
                interviewRevision: dependencies.interviewRevision,
              }
            : {}),
        }),
        signal,
      },
      dependencies.fetcher,
    );
  } catch (e) {
    if (signal.aborted || e instanceof RemoteError) throw e;
    throw new Error(
      '提交结果尚未确认，请先在“评估任务”中查看。再次提交相同材料会沿用原任务标识，避免重复分析。',
    );
  }
  pendingSubmissions.delete(storageKey);
  try {
    localStorage.removeItem(storageKey);
  } catch {
    /* Optional retry persistence. */
  }
  while (true) {
    onProgress(job);
    signal.throwIfAborted();
    if (job.state === 'completed') {
      if (job.resultDisposition === 'pending')
        throw new Error(
          '分析已完成，但面试资料在执行期间发生变化。结果已保存在记录管理中，确认后再应用。',
        );
      return validateResult(job.report);
    }
    if (job.state === 'failed' || job.state === 'cancelled')
      throw new Error(job.error || '任务已取消。');
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, dependencies.pollMs);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    try {
      job = await remoteRequest<RemoteJob<T>>(
        '/api/jobs/' + encodeURIComponent(job.id),
        { signal },
        dependencies.fetcher,
      );
    } catch (e) {
      if (signal.aborted) throw e;
      throw new Error(
        '任务已提交，但暂时无法获取进度。请在“评估任务”中查看结果；无需重复提交。',
      );
    }
  }
}

export async function listRemoteArtifacts(
  fetcher: typeof fetch = fetch,
): Promise<RemoteArtifact[]> {
  const result = await remoteRequest<{ artifacts: unknown[] }>(
    '/api/artifacts',
    {},
    fetcher,
  );
  if (!Array.isArray(result.artifacts) || result.artifacts.length > 100)
    throw new Error('作品清单格式无效。');
  return result.artifacts.map((value) => {
    if (!value || typeof value !== 'object')
      throw new Error('作品清单格式无效。');
    const item = value as Record<string, unknown>;
    const allowed = new Set([
      'id',
      'deviceId',
      'name',
      'sha256',
      'bytes',
      'modifiedAt',
      'deviceName',
      'available',
      'syncedAt',
    ]);
    if (Object.keys(item).some((key) => !allowed.has(key)))
      throw new Error('作品清单格式无效。');
    const reference = validateWorkSampleReference(item);
    if (
      typeof item.deviceName !== 'string' ||
      !item.deviceName.trim() ||
      item.deviceName.length > 80 ||
      typeof item.available !== 'boolean' ||
      !Number.isSafeInteger(item.syncedAt) ||
      Number(item.syncedAt) < 0
    )
      throw new Error('作品清单格式无效。');
    return {
      ...reference,
      deviceName: item.deviceName.trim(),
      available: item.available,
      syncedAt: Number(item.syncedAt),
    };
  });
}

export function submitRemoteAnalysis(
  input: InterviewInput,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<AssessmentResult>) => void,
  dependencies: RemoteTaskDependencies = { fetcher: fetch, pollMs: 2000 },
): Promise<AssessmentResult> {
  return submitRemoteTask(
    validateInput(input),
    'interview',
    (value) => validateAssessmentResult(value, input),
    label,
    signal,
    onProgress,
    dependencies,
  );
}
export function submitRemoteResume(
  input: ResumeInput,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<ResumeReading>) => void,
  dependencies: RemoteTaskDependencies = { fetcher: fetch, pollMs: 2000 },
): Promise<ResumeReading> {
  const normalized = validateResumeInput(input);
  return submitRemoteTask(
    normalized,
    'resume',
    (value) =>
      validateResumeReading(value, normalized, { conciseQuestions: true }),
    label,
    signal,
    onProgress,
    dependencies,
  );
}

export function submitRemoteWrittenTest(
  input: WrittenTestSupplementInput,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<WrittenTestSupplementResult>) => void,
  dependencies: RemoteTaskDependencies = { fetcher: fetch, pollMs: 2000 },
): Promise<WrittenTestSupplementResult> {
  const normalized = validateWrittenTestSupplementInput(input);
  return submitRemoteTask(
    normalized,
    'written-test',
    (value) =>
      validateWrittenTestSupplement(value, normalized, {
        conciseQuestions: true,
      }),
    label,
    signal,
    onProgress,
    dependencies,
  );
}

export function submitRemoteWorkSample(
  input: WorkSampleInputV1,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<WorkSampleAssessment>) => void,
  dependencies?: RemoteTaskDependencies,
): Promise<WorkSampleAssessment>;
export function submitRemoteWorkSample(
  input: WorkSampleInputV2,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<WorkSampleAnalysisV2>) => void,
  dependencies?: RemoteTaskDependencies,
): Promise<WorkSampleAnalysisV2>;
export function submitRemoteWorkSample(
  input: WorkSampleInputV3,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<WorkSampleAnalysisV3>) => void,
  dependencies?: RemoteTaskDependencies,
): Promise<WorkSampleAnalysisV3>;
export function submitRemoteWorkSample(
  input: WorkSampleInput,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<WorkSampleAnalysisResult>) => void,
  dependencies?: RemoteTaskDependencies,
): Promise<WorkSampleAnalysisResult>;
export function submitRemoteWorkSample(
  input: WorkSampleInput,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<never>) => void,
  dependencies: RemoteTaskDependencies = { fetcher: fetch, pollMs: 2000 },
): Promise<WorkSampleAnalysisResult> {
  const normalized = validateWorkSampleInput(input);
  return submitRemoteTask(
    normalized,
    'work-sample',
    (value) =>
      validateWorkSampleAnalysisResult(value, normalized, {
        conciseQuestions: true,
      }),
    label,
    signal,
    onProgress as (job: RemoteJob<WorkSampleAnalysisResult>) => void,
    dependencies,
  );
}

export function submitRemoteOutline(
  input: OutlineRegenerationInput,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<OutlineRegenerationResult>) => void,
  dependencies: RemoteTaskDependencies = { fetcher: fetch, pollMs: 2000 },
): Promise<OutlineRegenerationResult> {
  const normalized = validateOutlineRegenerationInput(input);
  return submitRemoteTask(
    normalized,
    'outline',
    (value) => validateOutlineRegenerationResult(value, normalized),
    label,
    signal,
    onProgress,
    dependencies,
  );
}

export function submitRemoteFollowUpOutline(
  input: FollowUpOutlineInput,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<FollowUpOutlineResult>) => void,
  dependencies: RemoteTaskDependencies = { fetcher: fetch, pollMs: 2000 },
): Promise<FollowUpOutlineResult> {
  return submitRemoteTask(
    input,
    'follow-up-outline',
    (value) => validateFollowUpOutlineResult(value, input),
    `补充追问 · ${input.requestedFocus.slice(0, 40)}`,
    signal,
    onProgress,
    dependencies,
  );
}

export function submitRemoteSecondRoundOutline(
  input: SecondRoundOutlineInput,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<SecondRoundOutlineResult>) => void,
  dependencies: RemoteTaskDependencies,
): Promise<SecondRoundOutlineResult> {
  const normalized = validateSecondRoundOutlineInput(input);
  return submitRemoteTask(
    normalized,
    'second-round-outline',
    (value) => validateSecondRoundOutlineResult(value, normalized),
    label,
    signal,
    onProgress,
    dependencies,
  );
}

export function submitRemoteSecondRoundAssessment(
  input: SecondRoundAssessmentInput,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<SecondRoundAssessmentResult>) => void,
  dependencies: RemoteTaskDependencies,
): Promise<SecondRoundAssessmentResult> {
  const normalized = validateSecondRoundAssessmentInput(input);
  return submitRemoteTask(
    normalized,
    'second-round-assessment',
    (value) => validateSecondRoundAssessmentResult(value, normalized),
    label,
    signal,
    onProgress,
    dependencies,
  );
}
